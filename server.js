const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Connect to Local MongoDB (Fixed Code to avoid MongoParseError)
const MONGO_URI = 'mongodb+srv://vemuadmin:vemu123@vemuadmin.w4je3f4.mongodb.net/vemu_attendance?appName=vemuadmin';
mongoose.connect(MONGO_URI)
.then(async () => {
    console.log("🚀 BINGO! Successfully connected to MongoDB Cloud (Atlas)");
    // Task 2: Startup Self-Healing (Cleanup Duplicates)
    await cleanupDatabase();
}).catch(err => {
    console.log("❌ MongoDB Connection Error:", err);
});

// 2. Database Schemas

// Departments
const departmentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true }
});

departmentSchema.pre('save', function(next) {
    if (this.code) this.code = this.code.trim().toUpperCase();
    next();
});
const Department = mongoose.model('Department', departmentSchema);

// HODs
const hodSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, trim: true },
    userId: { type: String, required: true, unique: true, trim: true },
    password: { type: String, select: true, required: true },
    name: { type: String, required: true, trim: true },
    dept: { type: String, required: true, trim: true },
    email: { type: String, trim: true }
});

hodSchema.pre('save', function(next) {
    if (this.userId) this.userId = this.userId.trim().toUpperCase();
    next();
});
const HOD = mongoose.model('HOD', hodSchema);

// Teachers
const teacherSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, trim: true },
    userId: { type: String, required: true, unique: true, trim: true },
    password: { type: String, select: true, required: true },
    name: { type: String, required: true, trim: true },
    dept: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    subjects: [String],
    sections: [String]
});

teacherSchema.pre('save', function(next) {
    if (this.userId) this.userId = this.userId.trim().toUpperCase();
    next();
});
const Teacher = mongoose.model('Teacher', teacherSchema);

// Sections
const sectionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, trim: true },
    dept: { type: String, required: true, trim: true },
    year: { type: String, required: true, trim: true },
    semester: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    label: { type: String, required: true, unique: true, trim: true }
});

sectionSchema.pre('save', function(next) {
    if (this.label) this.label = this.label.trim().toUpperCase();
    if (this.section) this.section = this.section.trim().toUpperCase();
    next();
});
const Section = mongoose.model('Section', sectionSchema);

// Students
const studentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, trim: true },
    roll: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    dept: { type: String, required: true, trim: true },
    year: { type: String, required: true, trim: true },
    semester: { type: String, required: true, trim: true },
    section: { type: String, required: true, trim: true },
    phone: String,
    dob: String,
    email: { type: String, trim: true },
    studentType: { type: String, enum: ['Regular', 'LE'], default: 'Regular' }
});

studentSchema.pre('save', function(next) {
    if (this.roll) this.roll = this.roll.trim().toUpperCase();
    next();
});
const Student = mongoose.model('Student', studentSchema);

// Subjects
const subjectSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    dept: { type: String, required: true, trim: true },
    year: { type: String, required: true, trim: true },
    semester: { type: String, required: true, trim: true }
});

subjectSchema.pre('save', function(next) {
    if (this.code) this.code = this.code.trim().toUpperCase();
    next();
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

// --- 2.5 Startup De-duplication Script ---
async function cleanupDatabase() {
    console.log("🛠 Starting System Integrity Check & Cleanup...");
    const models = [
        { model: Department, key: 'code', label: 'Departments' },
        { model: HOD, key: 'userId', label: 'HODs' },
        { model: Teacher, key: 'userId', label: 'Teachers' },
        { model: Section, key: 'label', label: 'Sections' },
        { model: Student, key: 'roll', label: 'Students' },
        { model: Subject, key: 'id', label: 'Subjects' }
    ];

    for (const item of models) {
        try {
            const duplicates = await item.model.aggregate([
                { $group: { _id: { [item.key]: `$${item.key}` }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
                { $match: { count: { $gt: 1 } } }
            ]);

            for (const group of duplicates) {
                // Keep the most recent record (last one in the push array)
                const ids = group.ids;
                const keepId = ids.pop(); 
                
                const res = await item.model.deleteMany({ _id: { $in: ids } });
                console.log(`🧹 Cleaned ${res.deletedCount} duplicates from ${item.label} (${group._id[item.key]})`);
            }
            
            // Enforce Unique Indexes post-cleanup
            await item.model.syncIndexes();
        } catch (err) {
            console.error(`❌ Cleanup Error for ${item.label}:`, err);
        }
    }
    
    // Reset secondary artifacts
    await Lock.deleteMany({});
    console.log("✅ Database Integrity Verified. Unique Constraints Enforced.");
}

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
app.get('/api/departments', (req, res) => handleRequest(req, res, () => Department.find().lean()));
app.post('/api/departments', async (req, res) => {
    const { code } = req.body;
    const exists = await Department.findOne({ code: code?.trim().toUpperCase() });
    if (exists) return res.status(409).json({ success: false, error: "Duplicate Entity", field: "code", value: code });
    handleRequest(req, res, () => new Department(req.body).save());
});
app.put('/api/departments/:id', (req, res) => handleRequest(req, res, () => Department.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/departments/:id', (req, res) => handleRequest(req, res, () => Department.findOneAndDelete({ id: req.params.id })));

// HODs
app.get('/api/hods', (req, res) => handleRequest(req, res, () => HOD.find().lean()));
app.post('/api/hods', async (req, res) => {
    const { userId } = req.body;
    const exists = await HOD.findOne({ userId: userId?.trim().toUpperCase() });
    if (exists) return res.status(409).json({ success: false, error: "Duplicate Entity", field: "userId", value: userId });
    handleRequest(req, res, () => new HOD(req.body).save());
});
app.put('/api/hods/:id', (req, res) => handleRequest(req, res, () => HOD.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/hods/:id', (req, res) => handleRequest(req, res, () => HOD.findOneAndDelete({ id: req.params.id })));

// Teachers
app.get('/api/teachers', (req, res) => handleRequest(req, res, () => Teacher.find().lean()));
app.post('/api/teachers', async (req, res) => {
    const { userId } = req.body;
    const exists = await Teacher.findOne({ userId: userId?.trim().toUpperCase() });
    if (exists) return res.status(409).json({ success: false, error: "Duplicate Entity", field: "userId", value: userId });
    handleRequest(req, res, () => new Teacher(req.body).save());
});
app.put('/api/teachers/:id', (req, res) => handleRequest(req, res, () => Teacher.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })));
app.delete('/api/teachers/:id', (req, res) => handleRequest(req, res, () => Teacher.findOneAndDelete({ id: req.params.id })));

// Sections
app.get('/api/sections', (req, res) => handleRequest(req, res, () => Section.find().lean()));
app.post('/api/sections', async (req, res) => {
    const { label } = req.body;
    const exists = await Section.findOne({ label: label?.trim().toUpperCase() });
    if (exists) return res.status(409).json({ success: false, error: "Duplicate Entity", field: "label", value: label });
    handleRequest(req, res, () => new Section(req.body).save());
});
app.delete('/api/sections/:id', (req, res) => handleRequest(req, res, () => Section.findOneAndDelete({ id: req.params.id })));

// Students
app.get('/api/students', async (req, res) => {
  try {
    let students = await Student.find().lean();
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
app.post('/api/students', async (req, res) => {
    const { roll } = req.body;
    const exists = await Student.findOne({ roll: roll?.trim().toUpperCase() });
    if (exists) return res.status(409).json({ success: false, error: "Duplicate Entity", field: "roll", value: roll });
    handleRequest(req, res, () => new Student({ ...req.body, studentType: req.body.studentType || 'Regular' }).save());
});
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

    // 3. ATOMIC RESET: Delete/Reset Attendance & Locks (Optimized)
    if (sectionLabels.length > 0) {
      // Clear specific sections entirely (Faster & Atomic)
      await Attendance.updateMany(
        { section: { $in: sectionLabels } },
        { $set: { records: {}, lockedAt: null, lockedBy: null } }
      );
      
      // Also clear secondary locks
      await Lock.deleteMany({ lockKey: { $regex: new RegExp(`.*\\|.*\\|(${sectionLabels.join('|')})\\|.*`) } });
    } else if (studentIds.length > 0) {
      // If we only have specific students, unset their specific keys in all records
      const unsetObj = {};
      studentIds.forEach(sid => unsetObj[`records.${sid}`] = "");
      await Attendance.updateMany({}, { $unset: unsetObj });
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
app.get('/api/subjects', async (req, res) => res.json(await Subject.find().lean()));
app.post('/api/subjects', async (req, res) => {
    const { code, dept, year } = req.body;
    const exists = await Subject.findOne({ code: code?.trim().toUpperCase(), dept, year });
    if (exists) return res.status(409).json({ success: false, error: "Duplicate Entity", field: "code", value: code });
    res.json(await new Subject(req.body).save());
});
app.delete('/api/subjects/:id', async (req, res) => res.json(await Subject.findOneAndDelete({ id: req.params.id })));

// Attendance
app.get('/api/attendance', async (req, res) => {
  const all = await Attendance.find().lean();
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
  const locks = await Attendance.find({ lockedAt: { $ne: null } }).lean();
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
        // Check Maintenance
        const settings = await Settings.findOne().lean();
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

// --- Cloning Feature: Fetch previous period attendance ---
app.get('/api/attendance/previous', async (req, res) => {
    const { date, section, currentPeriod } = req.query;
    try {
        const prevPeriod = parseInt(currentPeriod) - 1;
        if (prevPeriod < 1) return res.status(400).json({ success: false, message: 'No previous period on the same day' });

        const prevAtt = await Attendance.findOne({ date, section, period: prevPeriod.toString() });
        if (!prevAtt) return res.status(404).json({ success: false, message: 'No previous period attendance found' });

        res.json({ success: true, records: prevAtt.records });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Task 1: The 'Smart-Map' Logic (Helper Function) - Refined for robustness
function calculateNextTerm(year, sem) {
  console.log(`Calculating promotion for Year: ${year}, Sem: ${sem}`);
  const y = parseInt(year);
  const s = sem ? sem.toString().trim() : "";
  
  // Handle both "1"/"2" and "Sem1"/"Sem2" formats
  if (s === 'Sem1' || s === '1') {
    return { nextYear: y.toString(), nextSem: '2' };
  }
  if (s === 'Sem2' || s === '2') {
    if (y >= 4) return { nextYear: 'Alumni', nextSem: 'Graduated' };
    return { nextYear: (y + 1).toString(), nextSem: '1' };
  }
  
  console.log(`No promotion mapping found for Sem: ${s}, returning current values.`);
  return { nextYear: year, nextSem: sem };
}

// Task 2: Robust Backend API (POST /api/students/bulk-promote)
app.post('/api/students/bulk-promote', async (req, res) => {
  const { studentIds } = req.body;
  console.log("Bulk Promotion triggered for IDs:", studentIds);
  
  if (!studentIds || !studentIds.length) {
    return res.status(400).json({ success: false, message: 'No student IDs provided' });
  }

  try {
    // Task 3: Concurrency & Lock Prevention
    await Settings.findOneAndUpdate({}, { isSystemMaintenance: true }, { upsert: true });

    let updatedCount = 0;
    for (const sid of studentIds) {
      const student = await Student.findOne({ id: sid });
      if (!student) {
        console.log(`Student NOT found: ${sid}`);
        continue;
      }

      const { nextYear, nextSem } = calculateNextTerm(student.year, student.semester);
      
      if (nextYear === student.year && nextSem === student.semester) {
        console.log(`No change for student ${student.roll}`);
        continue;
      }

      // Step A: Update student
      await Student.updateOne(
        { id: sid },
        { $set: { year: nextYear, semester: nextSem } }
      );

      // Step B: Robust Wipe - removing student's records from all attendance docs
      const unsetObj = {};
      unsetObj[`records.${sid}`] = "";
      await Attendance.updateMany({}, { $unset: unsetObj });
      
      updatedCount++;
      console.log(`Promoted Student ${student.roll}: ${student.year}/${student.semester} -> ${nextYear}/${nextSem}`);
    }

    // Restore system maintenance flag
    await Settings.findOneAndUpdate({}, { isSystemMaintenance: false });

    res.json({ 
      success: true, 
      message: `Bulk promotion completed. ${updatedCount} students updated.`,
      updatedCount 
    });
  } catch (err) {
    console.error("Critical Promotion Engine Failure:", err);
    // Try to unlock if failed
    await Settings.findOneAndUpdate({}, { isSystemMaintenance: false }).catch(() => {});
    res.status(500).json({ success: false, message: 'Promotion Engine Failure: ' + err.message });
  }
});

// --- High Performance Reports API (Student-Centric & Type-Agnostic) ---
app.get('/api/attendance/reports', async (req, res) => {
    let { dept, year, section, semester, from, to, refresh } = req.query;
    
    // Mission: 100% Data-Type Agnostic
    const normalizedYear = year ? String(year).trim() : null;
    const normalizedSem = semester ? String(semester).trim() : null;
    const normalizedDept = dept ? String(dept).trim() : null;

    try {
        console.log(`[Reports] Generating for Dept: ${normalizedDept}, Year: ${normalizedYear}, Sec: ${section}, Sem: ${normalizedSem} (${from} to ${to})`);

        // 1. Force Date Normalization (Interpret at 00:00:00 and 23:59:59)
        // Since we store as 'YYYY-MM-DD' strings, simple string comparison covers the full day.
        // We ensure the date strings are in correct format.
        const fromDate = from || '1970-01-01';
        const toDate = to || '2099-12-31';

        // 2. Identify Target Students (The Source of Truth)
        // We filter students first to ensure even those with 0 attendance appear.
        const studentQuery = {};
        if (normalizedDept) studentQuery.dept = normalizedDept;
        if (normalizedYear) studentQuery.year = normalizedYear;
        if (normalizedSem) studentQuery.semester = normalizedSem;
        if (section) {
            // Check if it's a section label (e.g. CSE-3A-S1) or just a section code ('A')
            if (section.includes('-')) {
                // Parse label like "DEPT-YEARSEC-SSEM"
                const parts = section.split('-');
                if (parts[1]) {
                    const secPart = parts[1].replace(/\d+/g, ''); // Extract 'A' from '3A'
                    studentQuery.section = secPart;
                }
            } else {
                studentQuery.section = section;
            }
        }

        const students = await Student.find(studentQuery).lean();
        if (!students.length) {
            return res.json({ success: true, data: [], message: 'No students found matching these criteria.' });
        }

        const studentIds = students.map(s => s.id);

        // 3. Self-Healing Aggregation Pipeline: Resolve Sections
        const secFilter = {};
        if (normalizedDept) secFilter.dept = normalizedDept;
        if (normalizedYear) secFilter.year = normalizedYear;
        if (normalizedSem) secFilter.semester = normalizedSem;

        const attQuery = {
            date: { $gte: fromDate, $lte: toDate }
        };

        if (section) {
            if (section.includes('-')) {
                // If the section is already a label, use it directly
                attQuery.section = section;
            } else {
                // If it's a letter (A, B, etc), find matching full labels
                secFilter.section = section;
                const matchingSecs = await Section.find(secFilter).lean();
                attQuery.section = { $in: matchingSecs.map(s => s.label) };
            }
        } else {
            // No section selected (All Sections)
            const matchingSecs = await Section.find(secFilter).lean();
            attQuery.section = { $in: matchingSecs.map(s => s.label) };
        }

        console.log(`[Reports] Resolved Attendance Sections:`, attQuery.section);

        const aggregated = await Attendance.aggregate([
            { $match: attQuery },
            { $project: { subjectId: 1, section: 1, date: 1, recArray: { $objectToArray: "$records" } } },
            { $unwind: "$recArray" },
            { $match: { "recArray.k": { $in: studentIds } } }, // Only relevant students
            { $group: {
                _id: { studentId: "$recArray.k", subjectId: "$subjectId" },
                present: { $sum: { $cond: [{ $eq: ["$recArray.v", "present"] }, 1, 0] } },
                absent: { $sum: { $cond: [{ $eq: ["$recArray.v", "absent"] }, 1, 0] } },
                total: { $sum: 1 }
            }}
        ]);

        // 4. Data-Link Integrity: Merge Student list with Aggregated Stats
        const subjectIds = [...new Set(aggregated.map(a => a._id.subjectId))];
        const subjects = await Subject.find({ id: { $in: subjectIds } }).lean();
        const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]));
        const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

        const results = [];
        const studentsProcessed = new Set();

        aggregated.forEach(a => {
            const s = studentMap[a._id.studentId];
            const sub = subjectMap[a._id.subjectId];
            if (s && sub) {
                results.push({
                    studentId: s.id,
                    subjectId: sub.id,
                    present: a.present,
                    absent: a.absent,
                    total: a.total,
                    pct: Math.round((a.present / a.total) * 100),
                    student: s,
                    subject: sub
                });
                studentsProcessed.add(s.id);
            }
        });

        // Add students with 0 records
        students.forEach(s => {
            if (!studentsProcessed.has(s.id)) {
                results.push({
                    studentId: s.id,
                    subjectId: 'none',
                    present: 0,
                    absent: 0,
                    total: 0,
                    pct: 0,
                    student: s,
                    subject: { name: 'No Records Found', code: 'N/A', semester: s.semester }
                });
            }
        });

        // 5. Final Alphanumeric Sort by Roll Number
        results.sort((a, b) => a.student.roll.localeCompare(b.student.roll, undefined, { numeric: true, sensitivity: 'base' }));

        res.json({ success: true, data: results });
    } catch (err) {
        console.error("Reports API Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});