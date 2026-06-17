const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
let sseClients = [];
// 0. Middleware & CORS (Top Priority)
app.use(cors({
    origin: function (origin, callback) {
        callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

// Serve static frontend files (HTML, CSS, JS) to prevent file:/// CORS issues
app.use(express.static(__dirname));

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

const cameraSchema = new mongoose.Schema({ ipAddress: { type: String, unique: true }, section: String, roomNumber: String, branch: String, year: String, semester: String });
const Camera = mongoose.model('Camera', cameraSchema);

const timetableSchema = new mongoose.Schema({ section: String, day: String, period: String, subjectId: String, subjectName: String });
timetableSchema.index({ section: 1, day: 1, period: 1 }, { unique: true });
const Timetable = mongoose.model('Timetable', timetableSchema);

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

// --- Server-Sent Events (SSE) Endpoint for Real-time Updates ---
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish the connection immediately

    sseClients.push(res);
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

app.post('/api/attendance/save', async (req, res) => {
    try {
        const { date, subjectId, section, period, records, teacherId } = req.body;
        
        // 1. Strict Lock Check: Verify if attendance for this specific session already exists
        const existing = await Attendance.findOne({ date, subjectId, section, period });
        if (existing) {
            return res.status(403).json({ 
                success: false, 
                message: `Attendance for ${section} ${period} is already locked. Contact your HOD for modifications.` 
            });
        }

        // 2. Create new session
        const result = new Attendance({ date, subjectId, section, period, records, lockedAt: new Date(), lockedBy: teacherId });
        await result.save();

        // Broadcast real-time update to all connected clients
        sseClients.forEach(client => {
            try {
                client.write(`data: ${JSON.stringify({ event: 'attendance_updated', period })}\n\n`);
            } catch(e) {}
        });

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
        const query = {};
        if (dept) query.dept = dept;
        if (year) query.year = year;
        if (semester) query.semester = semester;

        const sections = await Section.find(query);
        const labels = sections.map(s => s.label);
        
        // Wipe both records and transient locks
        await Attendance.deleteMany({ section: { $in: labels } });
        
        // If it's a full dept wipe, we might want to clear locks too
        const lockPattern = labels.length ? new RegExp(`(${labels.join('|')})`) : null;
        if (lockPattern) {
           // Locks are handled dynamically in app.js via the attendance records themselves now, 
           // but we keep this for legacy lock support if needed.
        }

        res.json({ success: true, count: labels.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5.1 Specialized Attendance Reports (With 30-day default)
app.get('/api/attendance/previous', async (req, res) => {
    try {
        const { date, section, currentPeriod } = req.query;
        const currentPeriodNum = parseInt(currentPeriod.replace('Period ', ''));
        const prevPeriod = `Period ${currentPeriodNum - 1}`;
        const record = await Attendance.findOne({ date, section, period: prevPeriod }).lean();
        if (record) res.json({ success: true, records: record.records });
        else res.json({ success: false });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/attendance/reports', async (req, res) => {
    try {
        let { dept, year, semester, section, from, to } = req.query;
        
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
        if (section) query.section = section;

        const students = await Student.find(query).lean();
        const studentIds = students.map(s => s.id);

        const attData = await Attendance.aggregate([
            { $match: { date: { $gte: from, $lte: to } } },
            { $project: { subjectId: 1, records: { $objectToArray: "$records" } } },
            { $unwind: "$records" },
            { $match: { "records.k": { $in: studentIds } } },
            { $group: { 
                _id: { sid: "$records.k", sub: "$subjectId" }, 
                p: { $sum: { $cond: [{ $eq: [{ $toLower: "$records.v" }, "present"] }, 1, 0] } }, 
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


// --- Timetable API ---
app.get('/api/timetable', async (req, res) => {
    try {
        const { section, day } = req.query;
        const query = {};
        if (section) query.section = section;
        if (day) query.day = day;
        const data = await Timetable.find(query);
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
app.post('/api/timetable', async (req, res) => {
    try {
        const { section, day, period, subjectId, subjectName } = req.body;
        const result = await Timetable.findOneAndUpdate(
            { section, day, period },
            { subjectId, subjectName },
            { upsert: true, new: true }
        );
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

const { exec } = require('child_process');
const onvif = require('node-onvif');

function pingHost(host) {
    return new Promise((resolve) => {
        // Parse host if it's an RTSP or HTTP url
        let target = host;
        const match = host.match(/(?:rtsp|http|https):\/\/(?:[^:]+:[^@]+@)?([a-zA-Z0-9.-]+)/);
        if (match) target = match[1];
        
        // ping -n 1 -w 2000 (Windows ping: 1 packet, 2000ms timeout)
        exec(`ping -n 1 -w 2000 ${target}`, (error, stdout, stderr) => {
            if (error || stdout.includes('Destination host unreachable') || stdout.includes('could not find host') || stdout.includes('Request timed out')) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

// --- Camera Mapping API ---
app.get('/api/cameras', async (req, res) => {
    try {
        const data = await Camera.find({});
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
app.post('/api/cameras', async (req, res) => {
    try {
        const { ipAddress, section, roomNumber, branch, year, semester } = req.body;
        
        // Very basic network verification
        const isReachable = await pingHost(ipAddress);
        if (!isReachable) {
            return res.status(400).json({ success: false, message: "Camera unreachable! Please check the IP Address/RTSP Link and ensure the camera is powered on and connected to the network." });
        }
        
        const result = await Camera.findOneAndUpdate(
            { ipAddress },
            { section, roomNumber, branch, year, semester },
            { upsert: true, new: true }
        );
        res.json({ success: true, data: result });
        
        // Physical PTZ Rotation Acknowledgment
        (async () => {
            try {
                let host = ipAddress;
                let user = 'admin';
                let pass = '';
                
                const match = ipAddress.match(/(?:rtsp|http|https):\/\/([^:]+):([^@]+)@([a-zA-Z0-9.-]+)/);
                if (match) {
                    user = match[1];
                    pass = match[2];
                    host = match[3];
                } else {
                    const ipMatch = ipAddress.match(/(?:rtsp|http|https):\/\/([a-zA-Z0-9.-]+)/);
                    if (ipMatch) host = ipMatch[1];
                }
                
                const ports = [80, 8899, 5000, 10080, 8080];
                let connectedDevice = null;
                
                for (let port of ports) {
                    let device = new onvif.OnvifDevice({
                        xaddr: `http://${host}:${port}/onvif/device_service`,
                        user: user,
                        pass: pass
                    });
                    try {
                        await device.init();
                        connectedDevice = device;
                        console.log(`[ONVIF] Successfully connected to ${host} on port ${port}`);
                        break;
                    } catch (e) {
                        // Silently try next port
                    }
                }
                
                if (connectedDevice && connectedDevice.services.ptz) {
                    console.log(`[ONVIF] Rotating Camera ${host} to acknowledge connection!`);
                    await connectedDevice.ptzMove({ 'speed': { x: 1.0, y: 0.0, z: 0.0 }, 'timeout': 1 });
                    setTimeout(async () => {
                        await connectedDevice.ptzMove({ 'speed': { x: -1.0, y: 0.0, z: 0.0 }, 'timeout': 1 }).catch(()=>{});
                    }, 1000);
                } else {
                    console.log(`[ONVIF] Camera ${host} does not support ONVIF, has wrong credentials, or PTZ is disabled.`);
                }
                
            } catch(e) {
                console.log("ONVIF Wrapper Error:", e.message);
            }
        })();
        
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
app.delete('/api/cameras/:ip', async (req, res) => {
    try {
        await Camera.findOneAndDelete({ ipAddress: req.params.ip });
        res.json({ success: true });
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