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
    email: String   // ADDED
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

// Departments
app.get('/api/departments', async (req, res) => res.json(await Department.find()));
app.post('/api/departments', async (req, res) => res.json(await new Department(req.body).save()));
app.put('/api/departments/:id', async (req, res) => res.json(await Department.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/departments/:id', async (req, res) => res.json(await Department.findOneAndDelete({ id: req.params.id })));

// HODs
app.get('/api/hods', async (req, res) => res.json(await HOD.find()));
app.post('/api/hods', async (req, res) => res.json(await new HOD(req.body).save()));
app.put('/api/hods/:id', async (req, res) => res.json(await HOD.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/hods/:id', async (req, res) => res.json(await HOD.findOneAndDelete({ id: req.params.id })));

// Teachers
app.get('/api/teachers', async (req, res) => res.json(await Teacher.find()));
app.post('/api/teachers', async (req, res) => res.json(await new Teacher(req.body).save()));
app.put('/api/teachers/:id', async (req, res) => res.json(await Teacher.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/teachers/:id', async (req, res) => res.json(await Teacher.findOneAndDelete({ id: req.params.id })));

// Sections
app.get('/api/sections', async (req, res) => res.json(await Section.find()));
app.post('/api/sections', async (req, res) => res.json(await new Section(req.body).save()));
app.delete('/api/sections/:id', async (req, res) => res.json(await Section.findOneAndDelete({ id: req.params.id })));

// Students
app.get('/api/students', async (req, res) => {
  let students = await Student.find();
  // Natural Sort: 21B1 before 21B10
  students.sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true, sensitivity: 'base' }));
  res.json(students);
});
app.post('/api/students', async (req, res) => res.json(await new Student(req.body).save()));
app.put('/api/students/:id', async (req, res) => res.json(await Student.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/students/:id', async (req, res) => res.json(await Student.findOneAndDelete({ id: req.params.id })));

// --- Admin Logic: Promote & Clear ---
app.post('/api/admin/promote', async (req, res) => {
  try {
    const students = await Student.find();
    const promotedIds = [];
    
    for (let s of students) {
      let sem = parseInt(s.semester);
      let year = parseInt(s.year);
      
      if (sem === 1 || sem === 3 || sem === 5) {
        // Odd -> Even
        s.semester = (sem + 1).toString();
      } else if (sem === 2 || sem === 4 || sem === 6) {
        // Even -> Sem 1 & Increment Year
        s.semester = "1";
        s.year = (year + 1).toString();
      }
      
      await s.save();
      promotedIds.push(s.id);
    }
    
    // Cleanup: Wipe attendance for promoted students
    // The requirement says "delete all existing attendance records for those specific students"
    // Since records is Mixed { studentId: status }, we need to remove keys or just wipe the whole record if it's term-based.
    // Given the phrasing "start a fresh term", wiping the records for those students in existing attendance documents:
    const allAtt = await Attendance.find();
    for (let att of allAtt) {
      let changed = false;
      promotedIds.forEach(id => {
        if (att.records && att.records[id]) {
          delete att.records[id];
          changed = true;
        }
      });
      if (changed) {
        att.markModified('records');
        await att.save();
      }
    }
    
    res.json({ success: true, message: 'Students promoted and attendance cleared.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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

// 4. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});