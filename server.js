const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Connect to Local MongoDB (Fixed Code to avoid MongoParseError)
const MONGO_URI = 'mongodb+srv://vemuadmin:vemu123@vemuadmin.w4je3f4.mongodb.net/vemu_attendance?appName=vemuadmin';
mongoose.connect(MONGO_URI)
.then(() => {
    console.log("🚀 BINGO! Successfully connected to MongoDB Cloud (Atlas)");
}).catch(err => {
    console.log("❌ MongoDB Connection Error:", err);
});

// 2. Database Schemas

// Departments
const departmentSchema = new mongoose.Schema({
    id: String,
    code: String,
    name: String
});
const Department = mongoose.model('Department', departmentSchema);

// HODs
const hodSchema = new mongoose.Schema({
    id: String,
    userId: String,
    password: { type: String, select: true },
    name: String,
    dept: String,
    email: String
});
const HOD = mongoose.model('HOD', hodSchema);

// Teachers
const teacherSchema = new mongoose.Schema({
    id: String,
    userId: String,
    password: { type: String, select: true },
    name: String,
    dept: String,
    email: String,
    subjects: [String], // Array of subject names or IDs
    sections: [String]  // Array of section labels (e.g. CSE-2B-S2)
});
const Teacher = mongoose.model('Teacher', teacherSchema);

// Sections
const sectionSchema = new mongoose.Schema({
    id: String,
    dept: String,
    year: String,
    semester: String,
    section: String, // MISSING FIELD - ADDED
    label: String
});
const Section = mongoose.model('Section', sectionSchema);

// Students
const studentSchema = new mongoose.Schema({
    id: String,
    roll: String,
    name: String,
    dept: String,
    year: String,
    semester: String,
    section: String,
    phone: String,
    dob: String,    // ADDED
    email: String,   // ADDED
    studentType: { type: String, enum: ['Regular', 'LE'], default: 'Regular' }
});
const Student = mongoose.model('Student', studentSchema);

// Subjects
const subjectSchema = new mongoose.Schema({
    id: String,
    code: String,
    name: String,
    dept: String,
    year: String,
    semester: String
});
const Subject = mongoose.model('Subject', subjectSchema);

// Attendance Records
const attendanceSchema = new mongoose.Schema({
    date: String, // 'YYYY-MM-DD'
    subjectId: String,
    section: String,
    period: { type: String, default: "1" }, // NEW FIELD
    records: mongoose.Schema.Types.Mixed, // { studentId: 'present'|'absent' }
    lockedAt: { type: Date, default: null },
    lockedBy: String
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

// Attendance Locks (Keep tracking of locks)
const lockSchema = new mongoose.Schema({
    lockKey: String, // "date|subjectId|section"
    lockedAt: Date,
    lockedBy: String
});
const Lock = mongoose.model('Lock', lockSchema);

// Settings (System Mantainance / Global Flags)
const settingsSchema = new mongoose.Schema({
    isSystemMaintenance: { type: Boolean, default: false },
    maintenanceMsg: String,
    lastUpdated: { type: Date, default: Date.now }
});
const Settings = mongoose.model('Settings', settingsSchema);

// 3. API Routes

// --- Authentication (Generic) ---
app.post('/api/auth/login', async (req, res) => {
    const { role, userId, password } = req.body;
    try {
        if (role === 'admin') {
            if (userId === 'vemuadmin' && password === 'vemu@2008') {
                return res.json({ success: true, user: { id: 'ADM001', name: 'Administrator', userId: 'vemuadmin', role: 'admin' } });
            }
        } else if (role === 'hods') {
            const h = await HOD.findOne({ userId: new RegExp(`^${userId}$`, 'i'), password });
            if (h) return res.json({ success: true, user: { ...h.toObject(), role: 'hod' } });
        } else if (role === 'teachers') {
            const t = await Teacher.findOne({ userId: new RegExp(`^${userId}$`, 'i'), password });
            if (t) return res.json({ success: true, user: { ...t.toObject(), role: 'teacher' } });
        } else if (role === 'students') {
            const s = await Student.findOne({ roll: new RegExp(`^${userId}$`, 'i') });
            if (s && password.toUpperCase() === s.roll.toUpperCase()) {
                return res.json({ success: true, user: { ...s.toObject(), role: 'student' } });
            }
        }
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Auth error' });
    }
});

// --- Entities CRUD ---

async function handleRequest(req, res, fn) {
  try {
    const result = await fn();
    res.json(result);
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Departments
app.get('/api/departments', (req, res) => handleRequest(req, res, () => Department.find()));
app.post('/api/departments', (req, res) => handleRequest(req, res, () => new Department(req.body).save()));
app.put('/api/departments/:id', (req, res) => handleRequest(req, res, () => Department.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/departments/:id', (req, res) => handleRequest(req, res, () => Department.findOneAndDelete({ id: req.params.id })));

// HODs
app.get('/api/hods', (req, res) => handleRequest(req, res, () => HOD.find()));
app.post('/api/hods', (req, res) => handleRequest(req, res, () => new HOD(req.body).save()));
app.put('/api/hods/:id', (req, res) => handleRequest(req, res, () => HOD.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/hods/:id', (req, res) => handleRequest(req, res, () => HOD.findOneAndDelete({ id: req.params.id })));

// Teachers
app.get('/api/teachers', (req, res) => handleRequest(req, res, () => Teacher.find()));
app.post('/api/teachers', (req, res) => handleRequest(req, res, () => new Teacher(req.body).save()));
app.put('/api/teachers/:id', (req, res) => handleRequest(req, res, () => Teacher.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/teachers/:id', (req, res) => handleRequest(req, res, () => Teacher.findOneAndDelete({ id: req.params.id })));

// Sections
app.get('/api/sections', (req, res) => handleRequest(req, res, () => Section.find()));
app.post('/api/sections', (req, res) => handleRequest(req, res, () => new Section(req.body).save()));
app.delete('/api/sections/:id', (req, res) => handleRequest(req, res, () => Section.findOneAndDelete({ id: req.params.id })));

// Students
app.get('/api/students', async (req, res) => {
  try {
    let students = await Student.find();
    students.sort((a, b) => {
      const rA = a.roll.toUpperCase();
      const rB = b.roll.toUpperCase();
      const endA = rA.slice(-2), endB = rB.slice(-2);
      const isNumA = /^\d{2}$/.test(endA), isNumB = /^\d{2}$/.test(endB);
      if (isNumA && !isNumB) return -1;
      if (!isNumA && isNumB) return 1;
      const yearA = rA.substring(0, 2), yearB = rB.substring(0, 2);
      if (yearA !== yearB) return yearA.localeCompare(yearB);
      return rA.localeCompare(rB, undefined, { numeric: true });
    });
    res.json(students);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
app.post('/api/students', (req, res) => handleRequest(req, res, () => new Student({ ...req.body, studentType: req.body.studentType || 'Regular' }).save()));
app.put('/api/students/:id', (req, res) => handleRequest(req, res, () => Student.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/students/:id', (req, res) => handleRequest(req, res, () => Student.findOneAndDelete({ id: req.params.id })));



app.post('/api/admin/clear-attendance', async (req, res) => {
  const { year, semester, dept } = req.body;
  try {
    // 1. Resolve matching sections for the filters
    const sectionFilter = {};
    if (year) sectionFilter.year = year;
    if (semester) sectionFilter.semester = semester;
    if (dept) sectionFilter.dept = dept;
    
    const targetSections = await Section.find(sectionFilter);
    const sectionLabels = targetSections.map(s => s.label);

    // 2. Clear Students matching filters (to refine records wiping)
    const studentFilter = { ...sectionFilter };
    const students = await Student.find(studentFilter);
    const studentIds = students.map(s => s.id);

    // 3. ATOMIC RESET: Delete/Reset Attendance & Locks
    // If we have specific students, we wipe their marks. 
    // If the filter targets a whole section/year/sem, we MUST also unlock.
    
    const allAtt = await Attendance.find();
    for (let att of allAtt) {
      let changed = false;
      
      // Wipe specific student records
      studentIds.forEach(id => {
        if (att.records && att.records[id]) {
          delete att.records[id];
          changed = true;
        }
      });
      
      // If the attendance document belongs to a target section, UNLOCK it
      if (sectionLabels.includes(att.section)) {
        att.lockedAt = null;
        att.lockedBy = null;
        changed = true;
      }

      if (changed) {
        att.markModified('records');
        await att.save();
      }
    }
    
    // Also clear the secondary Lock collection if any exist for these sections
    // Lock key format: date|subjectId|section|period
    const allLocks = await Lock.find();
    for (let lock of allLocks) {
      const parts = lock.lockKey.split('|');
      const lockSection = parts[2];
      if (sectionLabels.includes(lockSection)) {
        await Lock.findByIdAndDelete(lock._id);
      }
    }

    res.json({ success: true, message: 'Attendance records and locks cleared successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- HOD Logic: Modify Attendance ---
app.put('/api/attendance/update', async (req, res) => {
  const { date, section, period, records } = req.body;
  try {
    // HOD can override locks/existing records
    const att = await Attendance.findOneAndUpdate(
      { date, section, period },
      { $set: { records } },
      { new: true }
    );
    if (!att) return res.status(404).json({ success: false, message: 'No attendance record found for this period to modify.' });
    res.json({ success: true, data: att });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Subjects
app.get('/api/subjects', async (req, res) => res.json(await Subject.find()));
app.post('/api/subjects', async (req, res) => res.json(await new Subject(req.body).save()));
app.delete('/api/subjects/:id', async (req, res) => res.json(await Subject.findOneAndDelete({ id: req.params.id })));

// Attendance
app.get('/api/attendance', async (req, res) => {
  const all = await Attendance.find();
  const formatted = {};
  all.forEach(a => {
    if(!formatted[a.date]) formatted[a.date] = {};
    if(!formatted[a.date][a.subjectId]) formatted[a.date][a.subjectId] = {};
    // Store records by period
    formatted[a.date][a.subjectId][a.period || "1"] = a.records;
  });
  res.json(formatted);
});

app.get('/api/attendance-locks', async (req, res) => {
  const locks = await Attendance.find({ lockedAt: { $ne: null } });
  const formatted = {};
  locks.forEach(l => {
    const key = `${l.date}|${l.subjectId}|${l.section}|${l.period || "1"}`;
    formatted[key] = { lockedAt: l.lockedAt, lockedBy: l.lockedBy };
  });
  res.json(formatted);
});

app.post('/api/attendance/save', async (req, res) => {
    const { date, subjectId, records, section, lockedBy, period = "1" } = req.body;
    try {
        // Task 3: Concurrency & Lock Prevention
        const settings = await Settings.findOne();
        if (settings && settings.isSystemMaintenance) {
            return res.status(503).json({ success: false, message: 'System is under maintenance for term promotion. Please try again in a few minutes.' });
        }

        // Check if locked for this specific class/section/period (Requirement: preventing multiple staff)
        const existing = await Attendance.findOne({ date, section, period, lockedAt: { $ne: null } });
        if (existing) return res.status(403).json({ success: false, reason: 'locked' });

        await Attendance.findOneAndUpdate(
            { date, subjectId, section, period },
            { date, subjectId, section, period, records, lockedAt: new Date(), lockedBy },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error saving attendance' });
    }
});

// --- BULK PROMOTION LOGIC ---

// Task 1: The 'Smart-Map' Logic (Helper Function)
function calculateNextTerm(year, sem) {
  const y = parseInt(year);
  if (sem === 'Sem1') return { nextYear: y.toString(), nextSem: 'Sem2' };
  if (sem === 'Sem2') {
    if (y >= 4) return { nextYear: 'Alumni', nextSem: 'Graduated' };
    return { nextYear: (y + 1).toString(), nextSem: 'Sem1' };
  }
  return { nextYear: year, nextSem: sem };
}

// Task 2: Robust Backend API (POST /api/students/bulk-promote)
app.post('/api/students/bulk-promote', async (req, res) => {
  const { studentIds } = req.body;
  if (!studentIds || !studentIds.length) return res.status(400).json({ success: false, message: 'No student IDs provided' });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Task 3: Concurrency & Lock Prevention
      await Settings.findOneAndUpdate({}, { isSystemMaintenance: true }, { upsert: true, session });

      // Process students in batches or individually if they have different targets
      // For this system, we calculate next term per student
      for (const sid of studentIds) {
        const student = await Student.findOne({ id: sid }).session(session);
        if (!student) continue;

        const { nextYear, nextSem } = calculateNextTerm(student.year, student.semester);

        // Step A: Update student (Using student._id as requested for ACID safety/best practice if possible, but sid is our primary key)
        await Student.updateOne(
          { id: sid },
          { $set: { year: nextYear, semester: nextSem } },
          { session }
        );

        // Step B: Robust Wipe - ensuring fresh start
        // Instead of deleteMany (which would kill the doc), we unset the student's record from all attendance docs
        const unsetObj = {};
        unsetObj[`records.${sid}`] = "";
        await Attendance.updateMany({}, { $unset: unsetObj }, { session });
      }

      // Restore system maintenance flag
      await Settings.findOneAndUpdate({}, { isSystemMaintenance: false }, { session });
    });

    res.json({ success: true, message: 'Bulk promotion completed successfully.' });
  } catch (err) {
    // Step C: auto-aborted by withTransaction if exception thrown
    console.error("Critical Promotion Engine Failure:", err);
    res.status(500).json({ success: false, message: 'Promotion Engine Failure: ' + err.message });
  } finally {
    session.endSession();
  }
});

// 4. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});