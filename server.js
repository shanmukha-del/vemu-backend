const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// 0. Middleware & CORS (Top Priority)
app.use(cors({
    origin: [
        'https://vemuams.netlify.app',
        'http://localhost:5000',
        'http://127.0.0.1:5503',
        'http://127.0.0.1:5500',
        'http://localhost:3000',
        'http://localhost:5173'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

// 0.2 Request Logger (For Debugging & Demo)
app.use((req, res, next) => {
    console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// 0.1 Health Check (For Monitoring & Wakeup)
app.get('/api/health', (req, res) => {
    res.json({ status: "online", timestamp: new Date().toISOString() });
});


// 1. Database Connection Logic
const PORT = process.env.PORT || 3000; 

const MONGO_URI = 'mongodb://vemuadmin:vemu123@ac-tp832eg-shard-00-00.w4je3f4.mongodb.net:27017,ac-tp832eg-shard-00-01.w4je3f4.mongodb.net:27017,ac-tp832eg-shard-00-02.w4je3f4.mongodb.net:27017/vemu_attendance?ssl=true&replicaSet=atlas-zbds82-shard-0&authSource=admin&retryWrites=true&w=majority';

async function connectToDatabase() {
    try {
        console.log("⏳ Connecting to MongoDB Atlas...");
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            family: 4
        });
        console.log("🚀 BINGO! Connected to MongoDB: vemu_attendance");
        await cleanupDatabase();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server is running on port ${PORT}`);
        });
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        process.exit(1); 
    }
}

connectToDatabase();

// 2. Database Schemas
const departmentSchema = new mongoose.Schema({ id: String, code: { type: String, unique: true }, name: String });
const Department = mongoose.model('Department', departmentSchema);

const hodSchema = new mongoose.Schema({ id: String, userId: { type: String, unique: true }, password: { type: String, select: true }, name: String, dept: String, email: String });
const HOD = mongoose.model('HOD', hodSchema);

const teacherSchema = new mongoose.Schema({ id: String, userId: { type: String, unique: true }, password: { type: String, select: true }, name: String, dept: String, email: String, subjects: [String], sections: [String] });
const Teacher = mongoose.model('Teacher', teacherSchema);

const sectionSchema = new mongoose.Schema({ id: String, dept: String, year: String, semester: String, section: String, label: { type: String, unique: true } });
const Section = mongoose.model('Section', sectionSchema);

const studentSchema = new mongoose.Schema({ id: String, roll: { type: String, unique: true }, name: String, dept: String, year: String, semester: String, section: String, phone: String, dob: String, email: String, studentType: { type: String, default: 'Regular' } });
const Student = mongoose.model('Student', studentSchema);

const subjectSchema = new mongoose.Schema({ id: String, code: String, name: String, dept: String, year: String, semester: String });
const Subject = mongoose.model('Subject', subjectSchema);

const attendanceSchema = new mongoose.Schema({ date: String, subjectId: String, section: String, period: String, records: { type: Map, of: String }, lockedAt: Date, lockedBy: String });
const Attendance = mongoose.model('Attendance', attendanceSchema);

const lockSchema = new mongoose.Schema({ lockKey: { type: String, unique: true }, lockedAt: { type: Date, default: Date.now }, userId: String });
const Lock = mongoose.model('Lock', lockSchema);

// 3. Cleanup
async function cleanupDatabase() {
    console.log("🛠 Starting System Integrity Check & Cleanup...");
    const cleanupMap = [
        { model: Department, label: 'Departments', key: 'code' },
        { model: Section, label: 'Sections', key: 'label' },
        { model: Student, label: 'Students', key: 'roll' },
        { model: Subject, label: 'Subjects', key: 'code' }
    ];
    for (const item of cleanupMap) {
        try {
            const duplicates = await item.model.aggregate([
                { $group: { _id: { [item.key]: `$${item.key}` }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
                { $match: { count: { $gt: 1 } } }
            ]);
            for (const group of duplicates) {
                const ids = group.ids;
                ids.pop();
                await item.model.deleteMany({ _id: { $in: ids } });
            }
            await item.model.syncIndexes();
        } catch (err) {}
    }
    await Lock.deleteMany({});
    console.log("✅ Database Integrity Verified.");
}

// 4. Auth
app.post('/api/auth/login', async (req, res) => {
    let { role, userId, password } = req.body;
    try {
        userId = userId.trim(); password = password.trim();
        if (role === 'admin') {
            if (userId.toLowerCase() === 'vemuadmin' && password === 'vemu@2008') {
                return res.json({ success: true, user: { id: 'ADM001', name: 'Administrator', userId: 'vemuadmin', role: 'admin' } });
            }
        } else if (role === 'hods') {
            const h = await HOD.findOne({ userId: new RegExp(`^${userId}$`, 'i'), password });
            if (h) return res.json({ success: true, user: { ...h.toObject(), role: 'hod' } });
        } else if (role === 'teachers') {
            const t = await Teacher.findOne({ userId: new RegExp(`^${userId}$`, 'i'), password });
            if (t) return res.json({ success: true, user: { ...t.toObject(), role: 'teacher' } });
        } else if (role === 'students') {
            const sanitizedId = userId.toUpperCase();
            const s = await Student.findOne({ roll: sanitizedId });
            if (s && password.toUpperCase() === sanitizedId) {
                return res.json({ success: true, user: { ...s.toObject(), role: 'student' } });
            }
        }
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) { res.status(500).json({ success: false, message: 'Auth error' }); }
});

// 5. CRUD Standard Endpoints (RESTful Pattern)
const generateGenericRoutes = (path, model, uniqueKey) => {
    // List All
    app.get(`/api/${path}`, async (req, res) => {
        try { res.json({ success: true, data: await model.find().lean() }); }
        catch (err) { res.status(500).json({ success: false, message: `Failed to fetch ${path}: ${err.message}` }); }
    });

    // Create (Add)
    app.post(`/api/${path}`, async (req, res) => {
        try { res.json({ success: true, data: await model.create(req.body) }); }
        catch (err) { res.status(err.code === 11000 ? 409 : 500).json({ success: false, message: `Failed to create ${path}: ${err.message}` }); }
    });

    // Update
    app.put(`/api/${path}/:id`, async (req, res) => {
        try {
            const result = await model.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
            if (!result) return res.status(404).json({ success: false, message: `${path} not found` });
            res.json({ success: true, data: result });
        } catch (err) { res.status(500).json({ success: false, message: `Failed to update ${path}: ${err.message}` }); }
    });

    // Delete
    app.delete(`/api/${path}/:id`, async (req, res) => {
        try {
            const result = await model.findOneAndDelete({ id: req.params.id });
            if (!result) return res.status(404).json({ success: false, message: `${path} not found` });
            res.json({ success: true });
        } catch (err) { res.status(500).json({ success: false, message: `Failed to delete ${path}: ${err.message}` }); }
    });
};

generateGenericRoutes('departments', Department, 'code');
generateGenericRoutes('hods', HOD, 'userId');
generateGenericRoutes('teachers', Teacher, 'userId');
generateGenericRoutes('sections', Section, 'label');
generateGenericRoutes('students', Student, 'roll');
generateGenericRoutes('subjects', Subject, 'code');

app.get('/api/attendance', async (req, res) => {
    try {
        const all = await Attendance.find().lean();
        const formatted = {};
        all.forEach(a => {
            if (!formatted[a.date]) formatted[a.date] = {};
            if (!formatted[a.date][a.subjectId]) formatted[a.date][a.subjectId] = {};
            formatted[a.date][a.subjectId][a.period || "1"] = a.records;
        });
        res.json({ success: true, data: formatted });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/attendance/save', async (req, res) => {
    try {
        const { date, subjectId, section, period, records, teacherId } = req.body;
        
        // 1. Strict Lock Check: Verify if attendance for this session already exists
        const existing = await Attendance.findOne({ date, subjectId, period });
        if (existing) {
            return res.status(403).json({ 
                success: false, 
                message: "Attendance is already locked for this period. Contact your HOD for modifications." 
            });
        }

        // 2. Create new session
        const result = new Attendance({ date, subjectId, section, period, records, lockedAt: new Date(), lockedBy: teacherId });
        await result.save();
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


app.get('/api/attendance-locks', async (req, res) => {
    try { res.json({ success: true, data: await Lock.find().lean() }); }
    catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/admin/clear-attendance', async (req, res) => {
    try {
        const { year, semester, dept } = req.body;
        const sections = await Section.find({ year, semester, dept });
        const labels = sections.map(s => s.label);
        await Attendance.deleteMany({ section: { $in: labels } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5.1 Specialized Attendance Reports (With 30-day default)
app.get('/api/attendance/reports', async (req, res) => {
    try {
        let { dept, year, semester, from, to } = req.query;
        
        // Default to last 30 days if no date range is provided
        if (!from || !to) {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 30);
            from = from || start.toISOString().split('T')[0];
            to = to || end.toISOString().split('T')[0];
        }

        const query = { dept };
        if (year) query.year = year;
        if (semester) query.semester = semester;

        const students = await Student.find(query).lean();
        const studentIds = students.map(s => s.id);

        const attData = await Attendance.aggregate([
            { $match: { date: { $gte: from, $lte: to } } },
            { $project: { subjectId: 1, records: { $objectToArray: "$records" } } },
            { $unwind: "$records" },
            { $match: { "records.k": { $in: studentIds } } },
            { $group: { 
                _id: { sid: "$records.k", sub: "$subjectId" }, 
                p: { $sum: { $cond: [{ $eq: ["$records.v", "present"] }, 1, 0] } }, 
                t: { $sum: 1 } 
            } }
        ]);
        res.json({ success: true, from, to, count: students.length, data: { students, attData } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 5.2 Attendance Modification (PUT)
app.put('/api/attendance/update', async (req, res) => {
    try {
        const { date, subjectId, section, period, records } = req.body;
        const query = { date, period };
        if (subjectId) query.subjectId = subjectId;
        if (section) query.section = section;

        const result = await Attendance.findOneAndUpdate(
            query,
            { $set: { records } },
            { new: true }
        );
        if (!result) return res.status(404).json({ success: false, message: "Attendance record not found for the given session" });
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// 5.3 Student Bulk Promotion Engine
app.post('/api/students/bulk-promote', async (req, res) => {
    try {
        const { studentIds, targetYear, targetSemester } = req.body;
        if (!studentIds || !Array.isArray(studentIds)) return res.status(400).json({ success: false, message: "Invalid student IDs" });
        
        const result = await Student.updateMany(
            { id: { $in: studentIds } },
            { $set: { year: targetYear, semester: targetSemester } }
        );
        res.json({ success: true, message: `Promoted ${result.modifiedCount} students`, data: result });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// 6. Global 404 JSON Guard (Prevents SyntaxError: Unexpected token <)
app.use((req, res) => {
    console.warn(`🛑 404 Attempted: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
        success: false, 
        message: `Route ${req.originalUrl} not found. Check API synchronization.`,
        hint: "Ensure your frontend endpoint matches the backend RESTful route."
    });
});