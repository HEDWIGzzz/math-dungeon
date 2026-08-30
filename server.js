const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// ฐานข้อมูลนักเรียนจำลอง (เก็บชื่อ, รหัสผ่าน, คะแนน, และเวลาใช้งานล่าสุด)
let registeredStudents = {};

// 10 ฐานการเรียนรู้
const stages = [
    { id: 1, name: "ห้องแห่งสมการ", difficulty: "Normal", code: "24", xp: 120, gold: 60 },
    { id: 2, name: "ถ้ำพีชคณิต", difficulty: "Normal", code: "36", xp: 150, gold: 80 },
    { id: 3, name: "หอคอยเรขาคณิต", difficulty: "Hard", code: "25", xp: 190, gold: 100 },
    { id: 4, name: "วิหารตรีโกณมิติ", difficulty: "Hard", code: "45", xp: 230, gold: 120 },
    { id: 5, name: "ห้องทดลองแคลคูลัส", difficulty: "Expert", code: "12", xp: 280, gold: 150 },
    { id: 6, name: "ห้องสถิติ", difficulty: "Expert", code: "18", xp: 320, gold: 180 },
    { id: 7, name: "เขาวงกตเวกเตอร์", difficulty: "Expert", code: "30", xp: 360, gold: 200 },
    { id: 8, name: "ประตูแห่งฟังก์ชัน", difficulty: "Legendary", code: "64", xp: 420, gold: 240 },
    { id: 9, name: "หอคอยอนุพันธ์", difficulty: "Legendary", code: "21", xp: 460, gold: 280 },
    { id: 10, name: "ห้องบอส", difficulty: "Legendary", code: "42", xp: 600, gold: 500 }
];

let stationCodes = {};
stages.forEach(s => stationCodes[s.id] = s.code);

io.on('connection', (socket) => {
    socket.emit('initGame', { id: socket.id, stages, stationCodes });

    // ระบบสมัครสมาชิก / เข้าสู่ระบบ
    socket.on('authPlayer', data => {
        const { name, password, classId } = data;
        if (!name || !password) {
            socket.emit('authResult', { success: false, msg: 'กรุณากรอกชื่อและรหัสผ่านให้ครบถ้วน' });
            return;
        }

        if (registeredStudents[name]) {
            // เช็ครหัสผ่าน
            if (registeredStudents[name].password === password) {
                registeredStudents[name].lastActive = Date.now();
                registeredStudents[name].socketId = socket.id;
                socket.emit('authResult', { success: true, profile: registeredStudents[name] });
            } else {
                socket.emit('authResult', { success: false, msg: 'รหัสผ่านไม่ถูกต้อง!' });
            }
        } else {
            // สมัครบัญชีใหม่
            registeredStudents[name] = {
                name,
                password,
                classId: classId || 'mage',
                xp: 0,
                gold: 0,
                completed: [],
                lastActive: Date.now(),
                socketId: socket.id
            };
            socket.emit('authResult', { success: true, profile: registeredStudents[name] });
        }
    });

    // อัปเดตคะแนนเมื่อผ่านด่าน
    socket.on('updateProgress', data => {
        const { name, xp, gold, completed } = data;
        if (registeredStudents[name]) {
            registeredStudents[name].xp = xp;
            registeredStudents[name].gold = gold;
            registeredStudents[name].completed = completed;
            registeredStudents[name].lastActive = Date.now();
        }
    });

    // แอดมินดึงข้อมูลรายชื่อนักเรียนทั้งหมดพร้อมคำนวณวันออฟไลน์
    socket.on('adminGetStudents', () => {
        const now = Date.now();
        const studentList = Object.values(registeredStudents).map(s => {
            const diffTime = Math.abs(now - s.lastActive);
            const offlineDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            return {
                name: s.name,
                classId: s.classId,
                xp: s.xp,
                gold: s.gold,
                offlineDays: offlineDays
            };
        });
        socket.emit('adminStudentListData', studentList);
    });

    // แอดมินลบรายชื่อนักเรียน
    socket.on('adminDeleteStudent', studentName => {
        if (registeredStudents[studentName]) {
            delete registeredStudents[studentName];
            socket.emit('adminActionMsg', `ลบบัญชี ${studentName} เรียบร้อยแล้ว`);
            // ส่งข้อมูลอัปเดตกลับไป
            const now = Date.now();
            const studentList = Object.values(registeredStudents).map(s => ({
                name: s.name, classId: s.classId, xp: s.xp, gold: s.gold,
                offlineDays: Math.floor(Math.abs(now - s.lastActive) / (1000 * 60 * 60 * 24))
            }));
            socket.emit('adminStudentListData', studentList);
        }
    });

    socket.on('updateAdminCodes', newCodes => {
        stationCodes = newCodes;
        stages.forEach(s => { if (newCodes[s.id]) s.code = newCodes[s.id]; });
        io.emit('currentAdminCodes', stationCodes);
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Math Dungeon Online running on port ${PORT}`));
