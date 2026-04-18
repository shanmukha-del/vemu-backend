const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 1. Database Connection Logic
const PORT = 5000; 

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

// 5. CRUD Standard Endpoints (No "next" callback conflicts)
const generateGenericRoutes = (path, model, uniqueKey) => {
    app.get(`/api/${path}`, async (req, res) => {
        try { res.json({ success: true, data: await model.find().lean() }); }
        catch (err) { res.status(500).json({ success: false, message: err.message }); }
    });
    app.post(`/api/${path}/add`, async (req, res) => {
        try { res.json({ success: true, data: await model.create(req.body) }); }
        catch (err) { res.status(err.code === 11000 ? 409 : 500).json({ success: false, message: err.message }); }
    });
    app.delete(`/api/${path}/:id`, async (req, res) => {
        try { await model.findOneAndDelete({ id: req.params.id }); res.json({ success: true }); }
        catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
        const result = await Attendance.findOneAndUpdate(
            { date, subjectId, period },
            { date, subjectId, section, period, records, lockedAt: new Date(), lockedBy: teacherId },
            { upsert: true, new: true }
        );
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/reports', async (req, res) => {
    try {
        const { dept, year, semester } = req.query;
        const students = await Student.find({ dept, year, semester }).lean();
        const studentIds = students.map(s => s.id);
        const attData = await Attendance.aggregate([
            { $project: { subjectId: 1, records: { $objectToArray: "$records" } } },
            { $unwind: "$records" },
            { $match: { "records.k": { $in: studentIds } } },
            { $group: { _id: { sid: "$records.k", sub: "$subjectId" }, p: { $sum: { $cond: [{ $eq: ["$records.v", "present"] }, 1, 0] } }, t: { $sum: 1 } } }
        ]);
        res.json({ success: true, data: { students, attData } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});