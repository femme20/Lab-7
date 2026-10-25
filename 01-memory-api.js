// Extended from the professor's 06-student-api/01-memory-api.js.
// All four collections live in memory. Restarting the server clears them.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
function createApp() {
  const data = { students: [], teachers: [], attendance: [], marks: [] };
  const nextId = { students: 1, teachers: 1, attendance: 1, marks: 1 };
  const send = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(value === undefined ? undefined : JSON.stringify(value));
  };
  function validate(type, value) {
    const text = (key) => {
      if (typeof value[key] !== 'string' || !value[key].trim()) throw Error(`${key} is required`);
      return value[key].trim();
    };
    if (type === 'students') return { name: text('name'), rollNo: text('rollNo'), department: text('department') };
    if (type === 'teachers') return { name: text('name'), subject: text('subject') };
    if (!Number.isInteger(value.studentId) || !data.students.some(s => s.id === value.studentId)) {
      throw Error('studentId must refer to an existing student');
    }
    if (type === 'attendance') {
      const date = text('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw Error('Use a valid date: YYYY-MM-DD');
      if (!['Present', 'Absent', 'Leave'].includes(value.status)) throw Error('status must be Present, Absent or Leave');
      return { studentId: value.studentId, date, status: value.status };
    }
    const subject = text('subject');
    if (!Number.isFinite(value.totalMarks) || value.totalMarks <= 0 || !Number.isFinite(value.obtainedMarks) || value.obtainedMarks < 0 || value.obtainedMarks > value.totalMarks) {
      throw Error('Marks must be numeric: 0 <= obtainedMarks <= totalMarks, with totalMarks > 0');
    }
    return { studentId: value.studentId, subject, obtainedMarks: value.obtainedMarks, totalMarks: value.totalMarks };
  }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await fs.readFile(path.join(__dirname, 'index.html')));
      }
      const match = /^\/(students|teachers|attendance|marks)(?:\/([1-9]\d*))?$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: 'Route not found' });
      const [, type, rawId] = match;
      const items = data[type];
      const id = rawId ? Number(rawId) : null;
      const record = items.find(item => item.id === id);
      if (id !== null && !record) return send(res, 404, { error: 'Record not found' });
      if (req.method === 'GET') return send(res, 200, id === null ? items : record);
      if (req.method === 'DELETE' && id !== null) {
        items.splice(items.indexOf(record), 1);
        // Remove a deleted student's dependent records as well.
        if (type === 'students') {
          data.attendance = data.attendance.filter(a => a.studentId !== id);
          data.marks = data.marks.filter(m => m.studentId !== id);
        }
        return send(res, 204);
      }
      if ((req.method === 'POST' && id === null) || (['PUT', 'PATCH'].includes(req.method) && id !== null)) {
        if (!String(req.headers['content-type']).includes('application/json')) return send(res, 415, { error: 'Use application/json' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) return send(res, 413, { error: 'Body too large' });
          chunks.push(chunk);
        }
        let value;
        try {
          value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Send a JSON object');
          value = validate(type, req.method === 'PATCH' ? { ...record, ...value } : value);
          if (type === 'students' && items.some(s => s.rollNo === value.rollNo && s.id !== id)) throw Error('rollNo already exists');
          if (type === 'attendance' && items.some(a => a.studentId === value.studentId && a.date === value.date && a.id !== id)) throw Error('Attendance already exists for this student and date');
        } catch (error) { return send(res, 400, { error: error.message }); }
        if (id === null) {
          const created = { id: nextId[type]++, ...value };
          items.push(created);
          return send(res, 201, created);
        }
        Object.keys(record).forEach(key => { if (key !== 'id') delete record[key]; });
        Object.assign(record, value);
        return send(res, 200, record);
      }
      return send(res, 405, { error: 'Method not allowed' });
    } catch (error) { console.error(error); send(res, 500, { error: 'Server error' }); }
  });
}
if (require.main === module) createApp().listen(3004, '127.0.0.1', () => console.log('Student management: http://localhost:3004'));
module.exports = { createApp };
