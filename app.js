/* ============================================================
   VEMU INSTITUTE OF TECHNOLOGY — Attendance System
   app.js  |  Core Logic · Auth · Data (MongoDB Backend)
   ============================================================ */
'use strict';
/* =============================================================
   SERVICE WORKER CLEANUP (Fixes No-op fetch warning)
   ============================================================ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
}

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000/api'
  : 'https://vemu-backend.onrender.com/api';

const API_BASE = API_BASE_URL.replace(/\/$/, ""); // Ensure no trailing slash

// ── Generic Fetch Wrapper with Resilience ──────────────────────
async function apiCall(endpoint, method = 'GET', body = null) {
  let wakeupTimeout;
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store'
    };
    if (body) options.body = JSON.stringify(body);

    // Show wakeup overlay if backend takes too long (Cold Start)
    wakeupTimeout = setTimeout(() => {
        UI.showWakeUp();
    }, 4000); // 4 seconds threshold for wakeup

    const res = await fetch(`${API_BASE}${endpoint}`, options);
    clearTimeout(wakeupTimeout);
    UI.hideWakeUp();

    // Check content type to prevent "Unexpected token <" (HTML error pages)
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error(`[CRITICAL] Non-JSON Response from ${endpoint}:`, text.substring(0, 200));
        throw new Error(`Server returned HTML instead of JSON. Check if the backend route is defined correctly.`);
    }

    const data = await res.json();
    
    if (!res.ok) {
        const errorMsg = data.message || `API Error: ${res.status}`;
        console.error(`[apiCall Error] ${endpoint}:`, errorMsg);
        UI.toast(errorMsg, 'error');
        return null;
    }
    return data;
  } catch (err) {
    clearTimeout(wakeupTimeout);
    UI.hideWakeUp();
    console.error(`Fetch error [${endpoint}]:`, err);

    
    // Check if it's a network error (possibly server down or cold starting)
    if (String(err).includes('Failed to fetch') || String(err).includes('NetworkError')) {
        UI.showWakeUp(true); // Forced wake up message
        return null;
    }

    UI.toast('Connection Error: ' + err.message, 'error');
    return null;
  }
}

// ── Storage (Session only now) ────────────────────────────────
const DB = {
  get(k) { 
    const store = (k === 'session') ? sessionStorage : localStorage;
    try { return JSON.parse(store.getItem('vemu_' + k)); } catch { return null; } 
  },
  set(k, v) { 
    const store = (k === 'session') ? sessionStorage : localStorage;
    store.setItem('vemu_' + k, JSON.stringify(v)); 
  },
  del(k) { 
    sessionStorage.removeItem('vemu_' + k);
    localStorage.removeItem('vemu_' + k); 
  }
};

// ── THEME ENGINE ──────────────────────────────────────────────
const THEME = {
  init() {
    const saved = localStorage.getItem('vemu_theme') || 'dark';
    this.set(saved);
  },
  toggle() {
    const curr = document.body.classList.contains('light-mode') ? 'dark' : 'light';
    this.set(curr);
  },
  set(mode) {
    if (mode === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    localStorage.setItem('vemu_theme', mode);
    // Update toggle icons if any
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = mode === 'light' ? '🌙' : '☀️';
  }
};

// ── AUTH ──────────────────────────────────────────────────────
const AUTH = {
  async login(role, userId, password) {
    if (!userId || !password) return { success: false, message: 'Missing credentials' };
    
    // Normalize ID: Trim and UpperCase for all roles to ensure consistency
    const sanitizedId = userId.trim().toUpperCase();
    
    // Double-Click Prevention & Loading State
    const btn = document.querySelector('.btn-login');
    const originalText = btn ? btn.innerText : 'Login';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Verifying...';
    }

    try {
        const res = await apiCall('/auth/login', 'POST', { 
            role, 
            userId: sanitizedId, 
            password: password.trim() 
        });

        if (res && res.success) {
            return { success: true, user: res.user };
        }
        return { success: false, message: res ? res.message : 'Invalid Credentials or Server Offline' };
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }
  },
  setSession(u) { DB.set('session', u); },
  getSession() { return DB.get('session'); },
  clearSession() { DB.del('session'); },
  redirectByRole(role) {
    const map = { admin: 'admin.html', hod: 'hod.html', teacher: 'teacher.html', student: 'student.html' };
    window.location.href = map[role] || 'index.html';
  }
};

// ── DATA LAYER (ASYNCHRONOUS) ─────────────────────────────────
const DATA = {
  // We keep a local cache for performance, refreshed on load or update
  _cache: {
    departments: [],
    hods: [],
    teachers: [],
    sections: [],
    students: [],
    subjects: [],
    attendance: {},
    locks: {}
  },
  _isRefreshing: false,
  _lastReport: null,

  async refreshCache() {
    if (this._isRefreshing) return;
    this._isRefreshing = true;
    try {
      const results = await Promise.all([
        apiCall('/departments'),
        apiCall('/hods'),
        apiCall('/teachers'),
        apiCall('/sections'),
        apiCall('/students'),
        apiCall('/subjects'),
        apiCall('/attendance'),
        apiCall('/attendance-locks')
      ]);
      
      if (results[0]?.success) this._cache.departments = results[0].data;
      if (results[1]?.success) this._cache.hods = results[1].data;
      if (results[2]?.success) this._cache.teachers = results[2].data;
      if (results[3]?.success) this._cache.sections = results[3].data;
      if (results[4]?.success) this._cache.students = results[4].data;
      if (results[5]?.success) this._cache.subjects = results[5].data;
      if (results[6]?.success) this._cache.attendance = results[6].data;
      if (results[7]?.success) this._cache.locks = results[7].data;
      
      window.dispatchEvent(new CustomEvent('vemu_data_changed'));
    } catch (err) {
      console.error("Cache Refresh Failed:", err);
    } finally {
      this._isRefreshing = false;
    }
  },

  // Departments
  getDepts() { return this._cache.departments; },
  async addDept(d) { 
    const res = await apiCall('/departments', 'POST', d); 
    if (res?.success) {
      this._cache.departments.push(res.data);
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async updateDept(id, d) { 
    const res = await apiCall(`/departments/${id}`, 'PUT', d); 
    if (res?.success) {
      this._cache.departments = this._cache.departments.map(x => x.id === id ? { ...x, ...res.data } : x); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async deleteDept(id) { 
    const res = await apiCall(`/departments/${id}`, 'DELETE'); 
    if (res?.success) {
      this._cache.departments = this._cache.departments.filter(x => x.id !== id); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },

  // HODs
  getHODs() { return this._cache.hods; },
  async addHOD(h) { 
    const res = await apiCall('/hods', 'POST', h); 
    if (res?.success) {
      this._cache.hods.push(res.data);
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async updateHOD(id, h) { 
    const res = await apiCall(`/hods/${id}`, 'PUT', h); 
    if (res?.success) {
      this._cache.hods = this._cache.hods.map(x => x.id === id ? { ...x, ...res.data } : x); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async deleteHOD(id) { 
    const res = await apiCall(`/hods/${id}`, 'DELETE'); 
    if (res?.success) {
      this._cache.hods = this._cache.hods.filter(x => x.id !== id); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },

  // Teachers
  getTeachers(dept) {
    let l = this._cache.teachers;
    if (dept) l = l.filter(t => t.dept === dept);
    return l;
  },
  async addTeacher(t) { 
    const res = await apiCall('/teachers', 'POST', t); 
    if (res?.success) {
      this._cache.teachers.push(res.data);
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async updateTeacher(id, t) { 
    const res = await apiCall(`/teachers/${id}`, 'PUT', t); 
    if (res?.success) {
      this._cache.teachers = this._cache.teachers.map(x => x.id === id ? { ...x, ...res.data } : x); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async deleteTeacher(id) { 
    const res = await apiCall(`/teachers/${id}`, 'DELETE'); 
    if (res?.success) {
      this._cache.teachers = this._cache.teachers.filter(x => x.id !== id); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },

  // Sections
  getSections(dept, year, semester) {
    let l = this._cache.sections;
    const sNorm = s => String(s).replace(/\D/g, '');
    if (dept) l = l.filter(s => s.dept && s.dept.toLowerCase() === dept.toLowerCase());
    if (year) l = l.filter(s => sNorm(s.year) == sNorm(year));
    if (semester) l = l.filter(s => sNorm(s.semester) == sNorm(semester));
    return l;
  },
  async addSection(s) { 
    const res = await apiCall('/sections', 'POST', s); 
    if (res?.success) {
      this._cache.sections.push(res.data); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async deleteSection(id) { 
    const res = await apiCall(`/sections/${id}`, 'DELETE'); 
    if (res?.success) {
      this._cache.sections = this._cache.sections.filter(x => x.id !== id); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },

  // Students
  getStudents(f = {}) {
    let l = [...this._cache.students];
    
    // Sort logic (Match backend)
    l.sort((a, b) => {
      const rA = a.roll.toUpperCase();
      const rB = b.roll.toUpperCase();
      const endA = rA.slice(-2), endB = rB.slice(-2);
      const isNumA = /^\d{2}$/.test(endA), isNumB = /^\d{2}$/.test(endB);
      if (isNumA && !isNumB) return -1;
      if (!isNumA && isNumB) return 1;
      const yA = rA.substring(0, 2), yB = rB.substring(0, 2);
      if (yA !== yB) return yA.localeCompare(yB);
      return rA.localeCompare(rB, undefined, { numeric: true });
    });

    const sNorm = s => String(s).replace(/\D/g, '');
    if (f.dept) l = l.filter(s => s.dept && s.dept.toLowerCase() === f.dept.toLowerCase());
    if (f.year) l = l.filter(s => sNorm(s.year) == sNorm(f.year));
    if (f.semester) l = l.filter(s => sNorm(s.semester) == sNorm(f.semester));
    if (f.section) l = l.filter(s => s.section === f.section);
    if (f.search) { const q = f.search.toLowerCase(); l = l.filter(s => s.name.toLowerCase().includes(q) || s.roll.toLowerCase().includes(q)); }
    return l;
  },
  async addStudent(s) { 
    const res = await apiCall('/students', 'POST', s); 
    if (res?.success) {
      const stu = res.data;
      this._cache.students.push({ ...stu, studentType: stu.studentType || 'Regular' }); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async updateStudent(id, s) { 
    const res = await apiCall(`/students/${id}`, 'PUT', s); 
    if (res?.success) {
      const stu = res.data;
      this._cache.students = this._cache.students.map(x => x.id === id ? { ...stu, studentType: stu.studentType || 'Regular' } : x); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async deleteStudent(id) { 
    const res = await apiCall(`/students/${id}`, 'DELETE'); 
    if (res?.success) {
      this._cache.students = this._cache.students.filter(x => x.id !== id); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },

  // Subjects
  getSubjects(dept, year, semester) {
    let l = this._cache.subjects;
    const sNorm = s => String(s).replace(/\D/g, '');
    if (dept) l = l.filter(s => s.dept && s.dept.toLowerCase() === dept.toLowerCase());
    if (year) l = l.filter(s => sNorm(s.year) == sNorm(year));
    if (semester) l = l.filter(s => sNorm(s.semester) == sNorm(semester));
    return l;
  },
  async addSubject(s) { 
    const res = await apiCall('/subjects', 'POST', s); 
    if (res?.success) {
      this._cache.subjects.push(res.data);
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },
  async deleteSubject(id) { 
    const res = await apiCall(`/subjects/${id}`, 'DELETE'); 
    if (res?.success) {
      this._cache.subjects = this._cache.subjects.filter(x => x.id !== id); 
      window.dispatchEvent(new Event('vemu_data_changed'));
      return true;
    }
    return false;
  },

  // Attendance
  getAttendance() { return this._cache.attendance; },

  getSessionAtt(date, subId, period = "1") {
    const a = this.getAttendance();
    return (a[date] && a[date][subId] && a[date][subId][period]) ? a[date][subId][period] : {};
  },

  isLocked(date, subId, section, period = "1") {
    const a = this.getAttendance();
    // A period is locked if a record exists for this unique combination
    return !!(a[date] && a[date][subId] && a[date][subId][period]);
  },

  getLockInfo(date, subId, section, period = "1") {
    const a = this.getAttendance();
    const record = (a[date] && a[date][subId] && a[date][subId][period]);
    if (record) {
      // Find the metadata if it's stored differently or just return a default
      // In server.js, Attendance model has lockedBy and lockedAt
      // Our local cache currently just points to the records map.
      // We might need to ensure the cache includes metadata.
      // For now, we'll return a placeholder until we verify cache structure.
      return { lockedBy: "Faculty" }; 
    }
    return null;
  },

  async saveSessionAtt(date, subId, records, section, lockedBy, period = "1") {
    const res = await apiCall('/attendance/save', 'POST', { date, subjectId: subId, records, section, lockedBy, period });
    if (res && res.success) {
      await this.refreshCache();
      return { success: true };
    }
    return { success: false, reason: res ? res.message : 'Unknown error' };
  },


  // Per-student stats (aggregator for ALL periods)
  getStudentStats(studentId, semester = null) {
    try {
      const all = this.getAttendance();
      const student = this._cache.students.find(s => s.id === studentId);
      let present = 0, absent = 0, total = 0;
      
      Object.entries(all).forEach(([date, dayData]) => {
        Object.entries(dayData).forEach(([subId, subPeriods]) => {
          // Filter by semester if provided
          if (semester) {
            const sub = this._cache.subjects.find(x => x.id === subId);
            if (sub && sub.semester != semester) return;
          }
          
          Object.values(subPeriods).forEach(records => {
            if (records && typeof records === 'object' && records[studentId] !== undefined) {
              total++;
              if (records[studentId] === 'present') present++;
              else absent++;
            }
          });
        });
      });
      
      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
      return { present, absent, total, pct };
    } catch (err) {
      console.error("Error in getStudentStats:", err);
      return { present: 0, absent: 0, total: 0, pct: 0 };
    }
  },


  async clearAttendance(filters) {
    const res = await apiCall('/admin/clear-attendance', 'POST', filters);
    if (res && res.success) {
      await this.refreshCache();
      return true;
    }
    return false;
  },

  async updateAttendance(date, section, period, records) {
    const res = await apiCall('/attendance/update', 'PUT', { date, section, period, records });
    if (res && res.success) {
      await this.refreshCache();
      return true;
    }
    return false;
  },

  async bulkPromote(studentIds, targetYear, targetSemester) {
    const res = await apiCall('/students/bulk-promote', 'POST', { studentIds, targetYear, targetSemester });
    if (res && res.success) {
      await this.refreshCache();
      return true;
    }
    return false;
  },


  async getPreviousAtt(date, section, currentPeriod) {
    const res = await apiCall(`/attendance/previous?date=${date}&section=${section}&currentPeriod=${currentPeriod}`);
    return (res && res.success) ? res.records : null;
  },

  getStudentMonthlyStats(studentId, year, month) {
    const all = this.getAttendance();
    let p = 0, ab = 0, total = 0;
    Object.entries(all).forEach(([date, dayData]) => {
      const d = new Date(date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        Object.values(dayData).forEach(sub => {
          Object.values(sub).forEach(records => {
            if (records && typeof records === 'object' && records[studentId] !== undefined) {
              total++;
              if (records[studentId] === 'present') p++;
            }
          });
        });
      }
    });
    return { present: p, absent: ab, total, pct: total ? Math.round(p / total * 100) : 0 };
  },

  // Per-student, per-subject stats (aggregator for ALL periods)
  getStudentSubjectStats(studentId, subjectId) {
    try {
      const all = this.getAttendance();
      let present = 0, absent = 0, total = 0;
      Object.values(all).forEach(day => {
        if (day && day[subjectId]) {
          Object.values(day[subjectId]).forEach(records => {
            if (records && typeof records === 'object' && records[studentId] !== undefined) {
              total++;
              if (records[studentId] === 'present') present++;
              else absent++;
            }
          });
        }
      });
      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
      return { present, absent, total, pct };
    } catch (err) {
      console.error("Error in getStudentSubjectStats:", err);
      return { present: 0, absent: 0, total: 0, pct: 0 };
    }
  },

  // Attendance filtered by date range + dept + year + section (Server-Side Refactored)
  async getFilteredAttendance(filters = {}, deepRefresh = false) {
    try {
      if (deepRefresh) {
        console.log("🔄 Deep Refresh triggered: Synchronizing local cache...");
        await this.refreshCache();
      }

      const q = new URLSearchParams();
      if (filters.dept) q.append('dept', filters.dept);
      if (filters.year) q.append('year', filters.year);
      if (filters.section) q.append('section', filters.section);
      if (filters.semester) q.append('semester', filters.semester);
      if (filters.from) q.append('from', filters.from);
      if (filters.to) q.append('to', filters.to);
      if (deepRefresh) q.append('refresh', 'true');

      const url = `/attendance/reports?${q.toString()}`;
      console.log(`📡 Fetching Report: ${API_BASE}${url}`);
      
      const res = await apiCall(url);
      if (res && res.success) {
          this._lastReport = res.data;
          return res.data;
      }
      return [];
    } catch (err) {
      console.error("Failed to fetch filtered attendance:", err);
      return [];
    }
  },

  // Weekly trend (Now supports student-specific and multi-period data)
  getWeeklyTrend(studentId = null, semester = null, dept = null) {
    const all = this.getAttendance();
    const subjects = this._cache.subjects;
    const students = this._cache.students;
    const days = []; 
    const today = new Date();

    // Optimization: Pre-filter student IDs if filtering by department
    let allowedStudentIds = null;
    if (dept) {
      allowedStudentIds = new Set(students.filter(s => s.dept === dept).map(s => s.id));
    }
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      // Skip weekends
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      
      const ds = d.toISOString().split('T')[0];
      const dayData = all[ds] || {};
      let p = 0, t = 0;
      
      Object.entries(dayData).forEach(([subId, periods]) => {
        // Filter by semester if requested
        if (semester) {
          const sub = subjects.find(x => x.id === subId);
          if (sub && sub.semester != semester) return;
        }
        
        // Iterate through all periods for this subject on this day
        Object.values(periods).forEach(records => {
          Object.entries(records).forEach(([sid, status]) => {
            // Apply Filters
            if (studentId && sid !== studentId) return;
            if (allowedStudentIds && !allowedStudentIds.has(sid)) return;

            t++;
            if (status === 'present') p++;
          });
        });
      });
      
      days.push({ 
        label: d.toLocaleDateString('en', { weekday: 'short' }), 
        present: p,
        absent: t - p,
        value: t ? Math.round((p / t) * 100) : 0 
      });
    }
    return days;
  },

  getDashStats() {
    const students = this._cache.students;
    const today = new Date().toISOString().split('T')[0];
    const todayAtt = (this.getAttendance()[today]) || {};
    let todayP = 0, todayT = 0;
    Object.values(todayAtt).forEach(sub => { 
        Object.values(sub).forEach(records => {
          if (records && typeof records === 'object') {
            Object.values(records).forEach(v => { 
              todayT++; if (v === 'present') todayP++; 
            }); 
          }
        });
    });
    let sumPct = 0, sumMPct = 0;
    const now = new Date();
    students.forEach(s => { 
      sumPct += this.getStudentStats(s.id).pct; 
      sumMPct += this.getStudentMonthlyStats(s.id, now.getFullYear(), now.getMonth()).pct;
    });
    const avgAtt = students.length ? Math.round(sumPct / students.length) : 0;
    const avgMAtt = students.length ? Math.round(sumMPct / students.length) : 0;
    const lowAtt = students.filter(s => this.getStudentStats(s.id).pct < 75).length;
    return {
      totalStudents: students.length,
      totalTeachers: this._cache.teachers.length,
      totalHODs: this._cache.hods.length,
      totalDepts: this._cache.departments.length,
      todayPresent: todayP, todayTotal: todayT, avgAtt, avgMAtt, lowAtt,
      monthName: now.toLocaleString('en-IN', { month: 'long' })
    };
  },

  newId(pfx) { return pfx + Date.now() + Math.floor(Math.random() * 1000); },

  // Migration helper: LocalStorage -> MongoDB
  async migrateFromLocal() {
    const s = k => JSON.parse(localStorage.getItem('vemu_' + k));
    const depts = s('departments') || [];
    const hods = s('hods') || [];
    const teachers = s('teachers') || [];
    const sections = s('sections') || [];
    const students = s('students') || [];
    const subjects = s('subjects') || [];

    UI.toast('Migrating local data to MongoDB...', 'info');

    for (let d of depts) await apiCall('/departments', 'POST', d);
    for (let h of hods) await apiCall('/hods', 'POST', h);
    for (let t of teachers) await apiCall('/teachers', 'POST', t);
    for (let sec of sections) await apiCall('/sections', 'POST', sec);
    for (let stu of students) await apiCall('/students', 'POST', stu);
    for (let sub of subjects) await apiCall('/subjects', 'POST', sub);

    // Attendance is complex due to structure, maybe skip for now or fix
    UI.toast('Migration complete!', 'success');
    await this.refreshCache();
  }
};

// ── UI HELPERS ────────────────────────────────────────────────
const UI = {
  showWakeUp(isForced = false) {
    let el = document.getElementById('vemu-wakeup');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vemu-wakeup';
      el.className = 'wakeup-overlay';
      document.body.appendChild(el);
    }
    const msg = isForced ? 'Connection Lost. Server is waking up...' : 'Waking up server from sleep mode...';
    el.innerHTML = `
      <div class="wakeup-content">
        <div class="wakeup-spinner"></div>
        <h3>${msg}</h3>
        <p>This usually takes 15-30 seconds on free tier backends. Please wait...</p>
      </div>
    `;
    el.classList.add('active');
  },

  hideWakeUp() {
    document.getElementById('vemu-wakeup')?.classList.remove('active');
  },

  toast(msg, type = 'success', dur = 3500) {
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
    const icons = { success: '✓', error: '✗', warning: '!', info: 'i' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${icons[type] || 'i'}</span><span style="flex:1">${msg}</span><span class="toast-close" onclick="this.parentElement.remove()">×</span>`;
    c.appendChild(el);
    setTimeout(() => { if (el.parentElement) el.remove(); }, dur);
  },

  confirm(msg, title = 'Confirm') {
    return new Promise(resolve => {
      const ex = document.getElementById('_cm'); if (ex) ex.remove();
      const d = document.createElement('div');
      d.id = '_cm'; d.className = 'modal-backdrop open';
      d.innerHTML = `<div class="modal modal-sm"><div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="document.getElementById('_cm').remove();window._cr(false)">×</button></div><div class="modal-body"><p style="color:#94a3b8;font-size:13px">${msg}</p></div><div class="modal-footer"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('_cm').remove();window._cr(false)">Cancel</button><button class="btn btn-danger btn-sm" onclick="document.getElementById('_cm').remove();window._cr(true)">Confirm</button></div></div>`;
      window._cr = resolve;
      document.body.appendChild(d);
    });
  },

  openModal(id) { document.getElementById(id)?.classList.add('open'); },
  closeModal(id) { document.getElementById(id)?.classList.remove('open'); },

  initials(name) { if (!name) return '?'; return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(); },

  avaColor(str) { const c = ['av-blue', 'av-purple', 'av-amber', 'av-green', 'av-slate']; let h = 0; for (const ch of (str || '')) h = (h * 31 + ch.charCodeAt(0)) & 0xff; return c[h % c.length]; },

  pctClass(p) { return p >= 85 ? 'pct-high' : p >= 75 ? 'pct-mid' : 'pct-low'; },
  pctPill(p) { return p >= 85 ? 'pill-green' : p >= 75 ? 'pill-yellow' : 'pill-red'; },
  pctColor(p) { return p >= 85 ? '#10b981' : p >= 75 ? '#f59e0b' : '#ef4444'; },

  fmtDate(ds) { if (!ds) return ''; const d = new Date(ds + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); },

  requireAuth(role) {
    const s = AUTH.getSession();
    if (!s) { window.location.href = 'index.html'; return null; }
    if (role && s.role !== role) { window.location.href = 'index.html'; return null; }
    return s;
  },

  drawBarChart(id, data) {
    const el = document.getElementById(id); if (!el || !data.length) return;
    const max = Math.max(...data.map(d => d.value), 1);
    el.innerHTML = data.map(d => `<div class="bar-col" title="${d.label}: ${d.value}%"><div class="bar-block" style="height:${Math.max(3, (d.value / max) * 60)}px;background:${UI.pctColor(d.value)}"></div><div class="bar-lbl">${d.label}</div></div>`).join('');
  },

  drawLineChart(id, data) {
    const el = document.getElementById(id); if (!el || !data.length) return;
    // Switch to block display for SVG sizing
    el.style.display = 'block';
    const w = el.clientWidth || 300;
    const h = 100; // Fixed height for consistency
    const px = 20, py = 15;
    
    const stepX = (w - 2 * px) / (data.length - 1 || 1);
    const maxVal = Math.max(...data.map(d => Math.max(d.present, d.absent)), 1);
    const scaleY = (h - 2 * py) / maxVal;

    const getPath = (key) => {
      return data.map((d, i) => {
        const x = px + i * stepX;
        const y = h - py - (d[key] * scaleY);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      }).join(' ');
    };

    el.innerHTML = `
      <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="overflow:visible">
        <defs>
          <linearGradient id="gradP" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10b981" stop-opacity="0.2"/><stop offset="100%" stop-color="#10b981" stop-opacity="0"/></linearGradient>
          <linearGradient id="gradA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ef4444" stop-opacity="0.2"/><stop offset="100%" stop-color="#ef4444" stop-opacity="0"/></linearGradient>
        </defs>
        <!-- Gradients -->
        <path d="${getPath('present')} L ${px + (data.length-1)*stepX} ${h-py} L ${px} ${h-py} Z" fill="url(#gradP)" />
        <path d="${getPath('absent')} L ${px + (data.length-1)*stepX} ${h-py} L ${px} ${h-py} Z" fill="url(#gradA)" />
        <!-- Lines -->
        <path d="${getPath('present')}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <path d="${getPath('absent')}" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <!-- Points & Labels -->
        ${data.map((d, i) => {
          const x = px + i * stepX;
          return `
            <circle cx="${x}" cy="${h - py - (d.present * scaleY)}" r="3" fill="#10b981" />
            <circle cx="${x}" cy="${h - py - (d.absent * scaleY)}" r="3" fill="#ef4444" />
            <text x="${x}" y="${h - 2}" font-size="9" fill="#64748b" text-anchor="middle" font-weight="600">${d.label}</text>
          `;
        }).join('')}
      </svg>
      <div style="display:flex; justify-content:center; gap:15px; margin-top:10px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px">
        <span style="display:flex; align-items:center; gap:5px; color:#10b981"><span style="width:8px; height:8px; border-radius:50%; background:#10b981"></span> Present</span>
        <span style="display:flex; align-items:center; gap:5px; color:#ef4444"><span style="width:8px; height:8px; border-radius:50%; background:#ef4444"></span> Absent</span>
      </div>
    `;
  },

  drawDonut(container, pct, color) {
    const r = 32, cx = 50, cy = 50, circ = 2 * Math.PI * r, fill = circ * (pct / 100);
    container.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 100 100" width="90" height="90"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#334155" stroke-width="10"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-dasharray="${fill} ${circ}" stroke-linecap="round"/></svg><div class="donut-center"><span class="d-val">${pct}%</span><span class="d-lbl">Att.</span></div></div>`;
  },

  // ── Modals / Toasts ──
  populateDeptSelect(ids, placeholder = 'All Departments') {
    const depts = DATA.getDepts();
    const opts = `<option value="">${placeholder}</option>` + depts.map(d => `<option value="${d.code}">${d.code} – ${d.name}</option>`).join('');
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
  },
  populateSectionLetterSelect(ids, placeholder = 'All Sections', dept = null) {
    const list = DATA.getSections(dept);
    const letters = [...new Set(list.map(s => s.section))].sort();
    const opts = `<option value="">${placeholder}</option>` + letters.map(l => `<option value="${l}">${l}</option>`).join('');
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
  },

  animateValue(id, start, end, duration) {
    const obj = typeof id === 'string' ? document.getElementById(id) : id;
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const val = Math.floor(progress * (end - start) + start);
      obj.innerHTML = val + (obj.dataset.suffix || '');
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  },
  romanYear(n) {
    const map = { 1: "I", 2: "II", 3: "III", 4: "IV" };
    return map[n] || n;
  },
  revealSequential(selector, baseDelay = 100) {
    document.querySelectorAll(selector).forEach((el, i) => {
      el.style.opacity = '0';
      el.classList.remove('slide-up');
      setTimeout(() => {
        el.classList.add('slide-up');
        el.style.opacity = '1';
      }, i * baseDelay);
    });
  }
};


// ── EXPORT HELPERS (Refactored for Professional Academic Reports) ────────────────────────
const EXPORT = {
  // Scraper Fallback if global data is missing
  scrapeTable() {
    const rows = [];
    const tbody = document.getElementById('rep-tbody');
    if (!tbody) return rows;
    tbody.querySelectorAll('tr').forEach(tr => {
      if (tr.classList.contains('empty-row') || tr.classList.contains('table-group-header')) return;
      const cells = [...tr.querySelectorAll('td')].map(td => td.innerText.trim());
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  },

  // Centralized data engine for student reports
  generateReportData(studentId, semester = null) {
    const student = DATA.getStudents().find(s => s.id === studentId);
    if (!student) return null;

    const allAtt = DATA.getAttendance();
    const allSubjects = DATA.getSubjects();
    
    // Group records by Subject
    const statsMap = {};

    Object.entries(allAtt).forEach(([date, dayData]) => {
      Object.entries(dayData).forEach(([subId, periods]) => {
        const sub = allSubjects.find(x => x.id === subId);
        if (!sub) return;
        
        // Filter by semester if provided (Skip filter if semester is null or empty string)
        if (semester && semester !== "" && sub.semester != semester) return;
        
        Object.values(periods).forEach(records => {
          if (records[studentId] !== undefined) {
             if (!statsMap[subId]) {
               statsMap[subId] = { 
                 p: 0, a: 0, t: 0, 
                 name: sub.name, 
                 code: sub.code, 
                 sem: sub.semester 
               };
             }
             statsMap[subId].t++;
             if (records[studentId] === 'present') statsMap[subId].p++;
             else statsMap[subId].a++;
          }
        });
      });
    });

    const subjectRows = Object.values(statsMap).map(st => {
      const pctNum = st.t > 0 ? (st.p / st.t * 100) : 0;
      return {
        name: st.name,
        code: st.code,
        sem: `Sem ${st.sem}`,
        present: st.p,
        absent: st.a,
        total: st.t,
        pct: pctNum.toFixed(2) + "%",
        pctNum: pctNum,
        status: pctNum >= 75 ? "ELIGIBLE" : "SHORTAGE"
      };
    });

    // Final Overall Aggregation
    let oP = 0, oA = 0, oT = 0;
    subjectRows.forEach(r => { oP += r.present; oA += r.absent; oT += r.total; });
    const oPct = oT > 0 ? (oP / oT * 100) : 0;

    return {
      meta: {
        name: student.name,
        roll: student.roll,
        dept: student.dept,
        year: UI.romanYear(student.year),
        semester: UI.romanYear(semester || student.semester),
        section: student.section,
        isBatch: false
      },
      subjects: subjectRows,
      overall: {
        present: oP,
        absent: oA,
        total: oT,
        pct: oPct.toFixed(2) + "%",
        pctNum: oPct,
        status: oPct >= 75 ? "ELIGIBLE" : "SHORTAGE"
      },
      generatedAt: {
        date: new Date().toLocaleDateString('en-IN'),
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
      }
    };
  },

  _tableHTML(headers, rows, title, meta = null, orientation = 'portrait') {
    const isWide = headers.length > 8 || orientation === 'landscape';
    const now = meta?.generatedAt || { date: new Date().toLocaleDateString('en-IN'), time: new Date().toLocaleTimeString('en-IN') };
    
    return `<html><head><meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        @page { size: ${isWide ? 'landscape' : 'portrait'}; margin: 0.5in; }
        body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; padding: 20px; background-color: #FFFFFF; color: #0F172A; line-height: 1.4; }
        
        /* Institutional Branding Header */
        .brand-container { text-align: center; margin-bottom: 30px; border-bottom: 3px double #003366; padding-bottom: 10px; }
        .college-name { font-family: 'Montserrat', sans-serif; font-size: 24pt; font-weight: 800; text-transform: uppercase; color: #003366; margin: 0; letter-spacing: -1px; }
        .record-label { font-size: 11pt; color: #64748b; margin-top: 5px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }

        .report-header { display: flex; justify-content: space-between; margin-bottom: 25px; padding: 15px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
        .header-left, .header-right { font-size: 10pt; line-height: 1.8; }
        .meta-label { color: #64748b; font-weight: 600; width: 100px; display: inline-block; }
        .meta-val { color: #0f172a; font-weight: 700; text-transform: uppercase; }
        
        .table-container { width: 100%; margin-top: 10px; }
        table { border-collapse: collapse; width: 100%; border: 1px solid #cbd5e1; table-layout: auto; }
        th { background: #1e293b; color: #f8fafc; padding: 8px 6px; text-align: center; font-size: 8.5pt; border: 1px solid #334155; text-transform: uppercase; letter-spacing: 0.5px; word-wrap: break-word; }
        td { padding: 6px; border: 1px solid #e2e8f0; font-size: 9pt; color: #334155; vertical-align: middle; text-align: center; }
        tr:nth-child(even) { background-color: #f8fafc; }
        
        /* Conditional Formatting */
        .pct-high { color: #059669 !important; font-weight: 800; }
        .pct-mid { color: #d97706 !important; font-weight: 800; }
        .pct-low { color: #dc2626 !important; font-weight: 800; }
        
        .status-pill { padding: 1px 4px; border-radius: 3px; font-size: 7.5pt; font-weight: 800; text-transform: uppercase; }
        .status-eligible { background: #dcfce7; color: #166534; }
        .status-shortage { background: #fee2e2; color: #991b1b; }
        
        /* Bold Percentage Header */
        .header-pct { font-weight: 900 !important; color: #38bdf8 !important; background: #0f172a !important; }

        .row-total { background-color: #f1f5f9 !important; font-weight: 800; }
        .row-total td { border-top: 2px solid #1e293b; color: #0f172a; }

        .footer-note { margin-top: 20px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 5px; }
      </style></head><body>
      <div class="brand-container">
        <h1 class="college-name">VEMU INSTITUTE OF TECHNOLOGY</h1>
        <div class="record-label">OFFICIAL ACADEMIC ATTENDANCE RECORD</div>
      </div>

      <div class="report-header">
        <div class="header-left">
          ${meta && meta.isBatch ? `
            <div><span class="meta-label">HOD/Faculty:</span> <span class="meta-val">${meta.facultyName || meta.hodName}</span></div>
            ${meta.subjectName ? `<div><span class="meta-label">Subject:</span> <span class="meta-val">${meta.subjectName}</span></div>` : ''}
            <div><span class="meta-label">Year/Sem:</span> <span class="meta-val">${meta.year} / ${meta.semester}</span></div>
            <div><span class="meta-label">Section:</span> <span class="meta-val">${meta.section || 'All My Sections'}</span></div>
            ${meta.dateRange ? `<div><span class="meta-label">Date Range:</span> <span class="meta-val">${meta.dateRange}</span></div>` : ''}
          ` : meta ? `
            <div><span class="meta-label">Student:</span> <span class="meta-val">${meta.name}</span></div>
            <div><span class="meta-label">Roll No:</span> <span class="meta-val">${meta.roll}</span></div>
            <div><span class="meta-label">Year/Sem:</span> <span class="meta-val">${meta.year} / ${meta.semester}</span></div>
            <div><span class="meta-label">Section:</span> <span class="meta-val">${meta.section}</span></div>
          ` : `<div><span class="meta-label">Type:</span> <span class="meta-val">${title}</span></div>`}
        </div>
        <div class="header-right" style="text-align: right;">
          <div style="margin-bottom:12px; display:inline-block; border: 3px solid #003366; color: #003366; padding: 4px 12px; font-weight: 900; font-size: 14pt; transform: rotate(-5deg); border-radius: 4px; opacity: 0.8; font-family: 'Montserrat', sans-serif">DIGITALLY<br>AUTHORIZED</div>
          <div style="margin-top:5px; font-size:9pt; color:#64748b">Date: <span class="meta-val">${now.date}</span></div>
          <div style="font-size:9pt; color:#64748b">Time: <span class="meta-val">${now.time}</span></div>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead><tr>${headers.map((h, i) => `<th class="${i === headers.length - 1 ? 'header-pct' : ''}">${h}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r, rowIndex) => {
              const isTotal = String(r[0]).toUpperCase() === 'OVERALL';
              return `<tr class="${isTotal ? 'row-total' : ''}">${r.map((c, i) => {
                let cls = '';
                const valStr = String(c);
                const isLast = (i === headers.length - 1);
                
                if (valStr.includes('%')) {
                  const num = parseFloat(valStr);
                  if (!isNaN(num)) {
                    if (num >= 85) cls = 'pct-high';
                    else if (num < 75) cls = 'pct-low';
                    else cls = 'pct-mid';
                  }
                  if(isLast) cls += ' header-pct'; // Apply bold focus to final percentage
                } else if (valStr === 'ELIGIBLE') {
                  cls = 'status-pill status-eligible';
                } else if (valStr === 'SHORTAGE') {
                  cls = 'status-pill status-shortage';
                }
                
                return `<td><span class="${cls}">${c}</span></td>`;
              }).join('')}</tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="footer-note">
        This is a computer-generated report for academic purposes. Digital time-stamp: ${now.date} ${now.time}
      </div>
      </body></html>`;
  },

  toWord(headers, rows, filename, title, meta = null) {
    const isWide = headers.length > 8;
    const html = this._tableHTML(headers, rows, title, meta, isWide ? 'landscape' : 'portrait');
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + '.doc';
    a.click();
  },

  toCSV(headers, rows, filename, meta = null) {
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    let lines = [];
    if (meta) {
      lines.push(`${esc('COLLEGE NAME: VEMU INSTITUTE OF TECHNOLOGY')},,,,`);
      lines.push(`${esc('OFFICIAL ATTENDANCE RECORD')},,,,`);
      lines.push(`${esc('Name: ' + (meta.name||'—'))},${esc('Roll: ' + (meta.roll||'—'))},,,`);
      lines.push(`${esc('Year/Sem: ' + (meta.year||'—') + ' / ' + (meta.semester||'—'))},${esc('Section: ' + (meta.section||'—'))},,,`);
      lines.push(`${esc('Generated: ' + (meta.generatedAt?.date + ' ' + meta.generatedAt?.time))},,,,`);
      lines.push(``); 
    }
    lines.push(headers.map(esc).join(','));
    rows.forEach(r => lines.push(r.map(esc).join(',')));
    
    // Fix: Using UTF-8 BOM (\ufeff) to solve Excel character glitches
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + '.csv';
    a.click();
  },

  studentAttendance(studentId, format = 'word') {
    try {
      const semFilter = document.getElementById('s-filter-sem')?.value || 
                        document.getElementById('sub-filter-sem')?.value || null;
      
      const payload = this.generateReportData(studentId, semFilter);
      if (!payload) throw new Error('Failed to generate report data');

      const headers = ['Subject Code', 'Subject Name', 'Semester', 'Present', 'Absent', 'Total', '%', 'Status'];
      const rows = payload.subjects.map(s => [
        s.code, s.name, s.sem, s.present, s.absent, s.total, s.pct, s.status
      ]);

      // Add OVERALL row at the very bottom
      rows.push(['TOTAL', 'OVERALL SUMMARY', '—', payload.overall.present, payload.overall.absent, payload.overall.total, payload.overall.pct, payload.overall.status]);

      const title = `Attendance Report: ${payload.meta.name}`;
      const fname = `Attendance_${payload.meta.roll}_${payload.meta.semester}`;
      
      const metaForExport = { ...payload.meta, generatedAt: payload.generatedAt };
      
      if (format === 'word') this.toWord(headers, rows, fname, title, metaForExport);
      else this.toCSV(headers, rows, fname, metaForExport);
      
      UI.toast(`Academic report generated successfully`, 'success');
    } catch (e) { 
      console.error("[Export Error]", e);
      UI.toast(e.message, 'error'); 
    }
  },
  async filteredReport(filters, format = 'word') {
    try {
      let data = await DATA.getFilteredAttendance(filters);
      
      // Table-Scraping Fallback
      if (!data || (Array.isArray(data) && !data.length)) {
          const scraped = this.scrapeTable();
          if (scraped && scraped.length) {
              const headers = ['Roll No', 'Name', 'Dept', 'Year/Sec', 'Subject', 'P', 'A', 'Total', '%', 'Status'];
              const title = "Attendance Report (Table Sync)";
              // Ensure scraped data is also sorted if possible (usually it's already sorted by UI)
              if (format === 'word') return this.toWord(headers, scraped, "sync_report", title);
              else return this.toCSV(headers, scraped, "sync_report");
          }
          throw new Error('Please Apply Filter First to view results before downloading.');
      }

      const sess = AUTH.getSession();
      const uniqueStudentIds = [...new Set(data.map(r => r.student.id))];
      const isBatch = uniqueStudentIds.length > 1;
      const sample = data[0].student;

      let headers, rows;
      if (isBatch) {
        // Aggregate by student for Batch Summary
        headers = ['Roll No', 'Student Name', 'Total Classes', 'Present', 'Attendance %', 'Status'];
        const studentAgg = {};
        data.forEach(r => {
          if (!studentAgg[r.student.id]) {
            studentAgg[r.student.id] = { roll: r.student.roll, name: r.student.name, p: 0, t: 0 };
          }
          studentAgg[r.student.id].p += r.present;
          studentAgg[r.student.id].t += r.total;
        });
        rows = Object.values(studentAgg).map(s => {
          const pctNum = s.t > 0 ? (s.p / s.t * 100) : 0;
          return [s.roll, s.name, s.t, s.p, pctNum.toFixed(2) + '%', pctNum >= 75 ? 'ELIGIBLE' : 'SHORTAGE'];
        });
        // Task 1: Harden Export Sorting
        rows.sort((a,b) => a[0].localeCompare(b[0], undefined, {numeric: true, sensitivity: 'base'}));
      } else {
        // Individual Subject Breakdown
        headers = ['Subject', 'Subject Code', 'Sem', 'Present', 'Absent', 'Total', 'Attendance %', 'Status'];
        rows = data.map(r => [
          r.subject.name, r.subject.code, r.student.semester,
          r.present, r.absent, r.total, r.pct + '%',
          r.pct >= 75 ? 'ELIGIBLE' : 'SHORTAGE'
        ]);
      }

      const meta = {
        isBatch: isBatch,
        hodName: (sess && sess.role === 'hod') ? sess.name : 'VEMU Admin',
        facultyName: (sess && sess.role === 'teacher') ? sess.name : null,
        subjectName: filters.subjectName || null,
        name: sample.name,
        roll: sample.roll,
        year: UI.romanYear(filters.year || sample.year),
        semester: UI.romanYear(filters.semester || sample.semester),
        section: filters.section || sample.section
      };

      const title = isBatch ? `Batch Attendance Report` : `Attendance Report — ${sample.name}`;
      const fname = isBatch ? `batch_report_${meta.section || 'all'}` : `attendance_${sample.roll}`;
      
      if (format === 'word') this.toWord(headers, rows, fname, title, meta);
      else this.toCSV(headers, rows, fname, meta);
    } catch (e) { UI.toast(e.message, 'error'); }
  },
  detailedReport(filters, format = 'word') {
    try {
      const all = DATA.getAttendance();
      const students = DATA.getStudents({ dept: filters.dept, year: filters.year, semester: filters.semester, section: filters.section });
      const records = [];
      const dates = Object.keys(all).sort((a,b) => b.localeCompare(a));
      
      dates.forEach(date => {
        if (filters.from && date < filters.from) return;
        if (filters.to && date > filters.to) return;
        const dayName = new Date(date).toLocaleDateString('en-IN', { weekday: 'long' });
        const dayData = all[date];
        Object.entries(dayData).forEach(([subId, periods]) => {
          const sub = DATA._cache.subjects.find(x => x.id === subId);
          if (filters.semester && sub && sub.semester != filters.semester) return;
          Object.entries(periods).sort((a,b) => a[0].localeCompare(b[0])).forEach(([period, att]) => {
            students.forEach(s => {
              if (att[s.id] !== undefined) {
                records.push([UI.fmtDate(date), dayName, 'P' + period, s.roll, s.name, sub ? sub.name : 'Unknown', sub ? sub.code : '—', att[s.id].toUpperCase()]);
              }
            });
          });
        });
      });
  
      if (!records.length) throw new Error('No detailed logs found for filters');
  
      const headers = ['Date', 'Day', 'Period', 'Roll No', 'Student Name', 'Subject', 'Subject Code', 'Status'];
      const title = `Detailed Attendance Log | ${filters.dept || 'All'}`;
      const fname = `detailed_attendance_${filters.dept || 'all'}`;
  
      // For detailed reports, meta info is generic unless it's a single student's log
      if (format === 'word') this.toWord(headers, records, fname, title);
      else this.toCSV(headers, records, fname);
    } catch (e) { UI.toast(e.message, 'error'); }
  },

  subjectSummaryReport(filters, format = 'word') {
    try {
      const sess = AUTH.getSession();
      const headers = ['Roll No', 'Student Name', 'Present Days', 'Total Classes', 'Percentage (%)', 'Status'];
      let rows = [];
      let subObj = null;

      // Use cached report data if available (Strict sync)
      let reportData = DATA._lastReport;
      
      if (reportData && reportData.attData && reportData.students) {
        console.log("📊 Exporting using cached API data...");
        const students = reportData.students;
        const attData = reportData.attData;
        const subId = filters.subjectId;
        
        // Find the subject from cache for metadata
        subObj = DATA._cache.subjects.find(x => x.id === subId);

        rows = students.map(s => {
          const stats = attData.find(a => a._id.sid === s.id && (subId ? a._id.sub === subId : true)) || { p: 0, t: 0 };
          const pct = stats.t > 0 ? (stats.p / stats.t * 100) : 0;
          return [s.roll, s.name, stats.p, stats.t, pct.toFixed(2) + '%', pct >= 75 ? 'ELIGIBLE' : 'SHORTAGE'];
        });
        // Task 1: Harden Export Sorting
        rows.sort((a,b) => a[0].localeCompare(b[0], undefined, {numeric: true, sensitivity: 'base'}));
      } else {
        console.warn("⚠️ No cached data. Using table-scraping fallback...");
        const scraped = this.scrapeTable();
        if (scraped.length) {
            if (format === 'word') return this.toWord(headers, scraped, "summary_sync", "Subject Summary (Sync)");
            else return this.toCSV(headers, scraped, "summary_sync");
        }
        throw new Error("Please Apply Filter First to generate the report.");
      }

      if (!subObj && filters.subjectId) {
          subObj = DATA._cache.subjects.find(x => x.id === filters.subjectId);
      }

      const meta = {
        isBatch: true,
        facultyName: (sess && (sess.role === 'teacher' || sess.role==='hod')) ? sess.name : 'VEMU Institute',
        subjectName: subObj ? `${subObj.name} (${subObj.code})` : (filters.subjectName || 'Unknown Subject'),
        year: UI.romanYear(filters.year || '—'),
        semester: UI.romanYear(filters.semester || '—'),
        section: filters.section || 'All',
        dateRange: filters.from ? `${UI.fmtDate(filters.from)} to ${UI.fmtDate(filters.to)}` : 'Full History',
        generatedAt: {
          date: new Date().toLocaleDateString('en-IN'),
          time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
        }
      };

      const title = `Subject Summary Report: ${meta.subjectName}`;
      const fname = `Summary_Report_${subObj ? subObj.code : 'SUB'}_${meta.section}`;

      if (format === 'word') this.toWord(headers, rows, fname, title, meta);
      else if (format === 'csv') this.toCSV(headers, rows, fname, meta);
      else if (format === 'pdf') {
         const html = this._tableHTML(headers, rows, title, meta);
         const win = window.open('', '_blank');
         win.document.write(html);
         win.document.close();
         setTimeout(() => { win.print(); }, 500);
      }

      UI.toast("Academic Summary Report generated", "success");
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  }
};



function logout() { AUTH.clearSession(); window.location.href = 'index.html'; }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) e.target.classList.remove('open');
});

function _toggleSidebar() {
  const isMobile = window.innerWidth <= 1024;
  if (isMobile) {
    const s = document.getElementById('sidebar');
    const o = document.getElementById('sidebar-overlay');
    s?.classList.toggle('open');
    o?.classList.toggle('open');
  } else {
    document.body.classList.toggle('sidebar-closed');
  }
}

// ── INITIALIZATION ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // First, fetch everything from the server
  await DATA.refreshCache();

  // If server is empty, check if we should migrate from LocalStorage
  if (DATA.getDepts().length === 0 && localStorage.getItem('vemu_departments')) {
    if (confirm("New MongoDB backend detected. Do you want to migrate your local data to the server?")) {
      await DATA.migrateFromLocal();
    }
  }

  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) overlay.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
    overlay.classList.remove('open');
  });

  // Custom event to signify data is ready
  THEME.init();
  window.dispatchEvent(new Event('app_ready'));
});

// Advanced 3D Parallax & UI Interactions
document.addEventListener('DOMContentLoaded', () => {
  const flare = document.createElement('div');
  flare.className = 'cursor-flare';
  document.body.appendChild(flare);

  document.addEventListener('mousemove', (e) => {
    const x = (window.innerWidth / 2 - e.pageX) / 80;
    const y = (window.innerHeight / 2 - e.pageY) / 80;

    // Background parallax
    const bg = document.querySelector('.dash-wrapper');
    if (bg) {
      bg.style.backgroundPosition = `calc(50% + ${x}px) calc(50% + ${y}px)`;
    }

    // Cursor Flare
    flare.style.left = e.pageX + 'px';
    flare.style.top = e.pageY + 'px';
  });
});

// Sidebar Hover Glow
 document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.boxShadow = `0 0 20px var(--primary-glow)`;
      btn.style.borderColor = `var(--primary)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.boxShadow = 'none';
      if (!btn.classList.contains('active')) {
        btn.style.borderColor = 'transparent';
      }
    });
  });
});
