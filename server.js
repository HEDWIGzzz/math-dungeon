const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const DB_FILE = path.join(__dirname, 'database.json');

// โหลดฐานข้อมูลจากไฟล์ หรือสร้างใหม่ถ้ายังไม่มี
function loadDatabase() {
    if (fs.existsSync(DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch (e) {
            console.error('Error reading database file, initializing empty.', e);
        }
    }
    return { students: {}, codes: {} };
}

function saveDatabase(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let db = loadDatabase();

// ฟังก์ชันเข้ารหัสรหัสผ่านด้วย Salt
function hashPassword(password, salt = null) {
    const currentSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, currentSalt, 1000, 64, 'sha512').toString('hex');
    return { hash, salt: currentSalt };
}

function verifyPassword(password, hash, salt) {
    const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return testHash === hash;
}

// 10 ฐานการเรียนรู้มาตรฐาน
const defaultStages = [
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

// ตั้งค่าโค้ดเริ่มต้นหากยังไม่มีใน DB
defaultStages.forEach(s => {
    if (!db.codes[s.id]) db.codes[s.id] = s.code;
});
saveDatabase(db);

io.on('connection', (socket) => {
    socket.emit('initGame', { id: socket.id, stages: defaultStages, stationCodes: db.codes });

    // ระบบ Authentication ที่ปลอดภัยขึ้น
    socket.on('authPlayer', data => {
        const { name, password, classId } = data;
        if (!name || !password) {
            socket.emit('authResult', { success: false, msg: 'กรุณากรอกชื่อและรหัสผ่านให้ครบถ้วน' });
            return;
        }

        const trimmedName = name.trim();

        if (db.students[trimmedName]) {
            const student = db.students[trimmedName];
            if (verifyPassword(password, student.hash, student.salt)) {
                student.lastActive = Date.now();
                saveDatabase(db);
                socket.emit('authResult', { 
                    success: true, 
                    profile: { name: student.name, classId: student.classId, xp: student.xp, gold: student.gold, completed: student.completed } 
                });
            } else {
                socket.emit('authResult', { success: false, msg: 'รหัสผ่านไม่ถูกต้อง!' });
            }
        } else {
            const { hash, salt } = hashPassword(password);
            db.students[trimmedName] = {
                name: trimmedName,
                hash,
                salt,
                classId: classId || 'mage',
                xp: 0,
                gold: 0,
                completed: [],
                lastActive: Date.now()
            };
            saveDatabase(db);
            socket.emit('authResult', { 
                success: true, 
                profile: { name: trimmedName, classId: classId || 'mage', xp: 0, gold: 0, completed: [] } 
            });
        }
    });

    // อัปเดตคะแนนและบันทึกลงไฟล์ทันที
    socket.on('updateProgress', data => {
        const { name, xp, gold, completed } = data;
        if (db.students[name]) {
            db.students[name].xp = xp;
            db.students[name].gold = gold;
            db.students[name].completed = completed;
            db.students[name].lastActive = Date.now();
            saveDatabase(db);
        }
    });

    // ดึงรายชื่อนักเรียนทั้งหมดสำหรับแดชบอร์ดคุณครู
    socket.on('adminGetStudents', () => {
        const now = Date.now();
        const studentList = Object.values(db.students).map(s => {
            const diffTime = Math.abs(now - (s.lastActive || now));
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

    // ลบรายชื่อนักเรียน
    socket.on('adminDeleteStudent', studentName => {
        if (db.students[studentName]) {
            delete db.students[studentName];
            saveDatabase(db);
            socket.emit('adminActionMsg', `ลบบัญชี ${studentName} เรียบร้อยแล้ว`);
            
            const now = Date.now();
            const studentList = Object.values(db.students).map(s => ({
                name: s.name, classId: s.classId, xp: s.xp, gold: s.gold,
                offlineDays: Math.floor(Math.abs(now - (s.lastActive || now)) / (1000 * 60 * 60 * 24))
            }));
            socket.emit('adminStudentListData', studentList);
        }
    });

    // อัปเดตโค้ดฐานจากครู
    socket.on('updateAdminCodes', newCodes => {
        db.codes = newCodes;
        saveDatabase(db);
        io.emit('currentAdminCodes', db.codes);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Secure Math Dungeon Server running on port ${PORT}`));
