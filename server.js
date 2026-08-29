const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// ให้บริการไฟล์ Static (HTML, CSS, JS) จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// Route สำหรับเข้าหน้า Admin (คุณครู)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==========================================
// GAME STATE & CONFIGURATION
// ==========================================
const world = { width: 4000, height: 4000 };

// ตำแหน่งฐานทั้ง 5 รอบๆ ปราสาทตรงกลาง (2000, 2000)
const stations = [
    { id: 1, name: 'ประตูแห่งสมการ', x: 2000, y: 1400, color: '#38bdf8' },
    { id: 2, name: 'วงกตแห่งตัวเลข', x: 2600, y: 2000, color: '#a855f7' },
    { id: 3, name: 'หอคอยตรรกะ', x: 2000, y: 2600, color: '#f43f5e' },
    { id: 4, name: 'ถ้ำเรขาคณิต', x: 1400, y: 2000, color: '#fbbf24' },
    { id: 5, name: 'วิหารคณิตศาสตร์', x: 2420, y: 1580, color: '#10b981' }
];

// รหัสผ่านเริ่มต้นของแต่ละฐาน (แอดมินแก้ไขได้)
let stationCodes = {
    1: '1234',
    2: '5678',
    3: '9999',
    4: '0000',
    5: 'math'
};

const players = {};
const tiles = [];
let tileIdCounter = 0;

// สุ่มไอเทมสมการ (Runes) กระจายบนแผนที่
function spawnInitialTiles(count) {
    const chars = ['+', '-', '*', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (let i = 0; i < count; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        tiles.push({
            id: ++tileIdCounter,
            char: char,
            type: isNaN(char) ? 'op' : 'num',
            x: 200 + Math.random() * (world.width - 400),
            y: 200 + Math.random() * (world.height - 400)
        });
    }
}
spawnInitialTiles(100); // เริ่มต้นมี 100 ชิ้นบนแผนที่

// อัปเดตตารางอันดับ
function updateLeaderboard() {
    const list = Object.values(players)
        .sort((a, b) => b.score - a.score)
        .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }))
        .slice(0, 10); // ส่งแค่ Top 10
    io.emit('leaderboard', list);
}

// ==========================================
// SOCKET.IO EVENTS
// ==========================================
io.on('connection', (socket) => {
    // 1. ส่งข้อมูลแผนที่เบื้องต้นให้ผู้เล่นที่เพิ่งเชื่อมต่อ
    socket.emit('initGame', { id: socket.id, world, stations, tiles });

    // 2. สร้างตัวละครใหม่
    socket.on('setupPlayer', data => {
        players[socket.id] = {
            id: socket.id,
            name: data.name || 'นักผจญภัย',
            avatar: data.avatar,
            hat: data.hat,
            shirt: data.shirt,
            pants: data.pants,
            shoes: data.shoes,
            // สุ่มเกิดใกล้ๆ ปราสาทตรงกลาง
            x: 2000 + (Math.random() * 200 - 100),
            y: 2000 + (Math.random() * 200 - 100),
            isMoving: false,
            level: 1,
            xp: 0,
            score: 0,
            completed: 0
        };
        socket.emit('playerReady', { player: players[socket.id] });
        updateLeaderboard();
    });

    // 3. รับข้อมูลการเดิน
    socket.on('move', data => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].isMoving = data.isMoving;
        }
    });

    // 4. ตรวจสอบการเปิดฐาน
    socket.on('requestStationUnlock', data => {
        const st = stations.find(s => s.id === data.stationId);
        if (st) socket.emit('stationPrompt', { stationId: st.id, name: st.name });
    });

    socket.on('submitStationCode', data => {
        const { stationId, code } = data;
        const p = players[socket.id];
        if (!p) return;

        if (p.completed >= stationId) {
            socket.emit('stationResult', { success: true, already: true });
            return;
        }

        // ตรวจสอบว่ารหัสตรงกับที่ครูตั้งไว้ใน Admin หรือไม่
        if (code === stationCodes[stationId]) {
            p.completed = stationId;
            p.score += 200;
            p.xp += 300;
            if (p.xp >= p.level * 500) p.level++; // ระบบเลเวลอัป
            
            socket.emit('stationResult', { success: true, reward: 200 });
            io.emit('stationWorldUpdate', { stationId }); // ส่ง Effect ให้ทุกคนเห็น
            updateLeaderboard();
        } else {
            socket.emit('stationResult', { success: false, msg: 'รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบกับคุณครูอีกครั้ง' });
        }
    });

    // 5. ตรวจสอบสมการคณิตศาสตร์ (Spell Forge)
    socket.on('submitEquation', eqStr => {
        const p = players[socket.id];
        if (!p) return;
        
        // ป้องกันการแทรกโค้ดอันตราย (อนุญาตเฉพาะตัวเลขและเครื่องหมาย + - *)
        if (!/^[0-9+\-*/]+$/.test(eqStr)) {
            return socket.emit('equationResult', { success: false, msg: 'สมการมีตัวอักษรที่ไม่ถูกต้อง' });
        }
        
        try {
            // คำนวณผลลัพธ์ของสมการ
            const result = new Function(`return ${eqStr}`)();
            
            // ถ้ารูปแบบสมการถูกต้องและคำนวณเป็นตัวเลขได้
            if (Number.isFinite(result)) {
                p.score += 50;
                p.xp += 80;
                if (p.xp >= p.level * 500) p.level++;
                
                socket.emit('equationResult', { success: true });
                updateLeaderboard();
            } else {
                socket.emit('equationResult', { success: false, msg: 'สมการไม่สามารถคำนวณได้' });
            }
        } catch(e) {
            socket.emit('equationResult', { success: false, msg: 'รูปแบบสมการผิดพลาด (ระวังเครื่องหมายซ้อนกัน)' });
        }
    });

    // 6. ระบบ Admin (ครู)
    socket.on('requestAdminCodes', () => {
        socket.emit('currentAdminCodes', stationCodes);
    });
    socket.on('updateAdminCodes', newCodes => {
        stationCodes = newCodes;
        console.log('Admin updated station codes');
    });

    // 7. ผู้เล่นออกจากการเชื่อมต่อ
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            updateLeaderboard();
        }
    });
});

// ==========================================
// SERVER GAME LOOP (Throttled Tick Rate)
// ==========================================
// ทำงานทุกๆ 40ms (ประมาณ 25 Frame per second) ลดภาระเซิร์ฟเวอร์
setInterval(() => {
    // 1. กระจายพิกัดตัวละครให้ทุกคนทราบพร้อมกัน
    io.emit('stateUpdate', players);

    // 2. คำนวณการชน (Collision) เพื่อเก็บเหรียญ Rune
    for (let pid in players) {
        let p = players[pid];
        for (let i = tiles.length - 1; i >= 0; i--) {
            let t = tiles[i];
            
            // หาระยะห่างระหว่างผู้เล่นกับเหรียญ
            let dist = Math.hypot(p.x - t.x, p.y - t.y);
            if (dist < 40) { // ถ้าระยะน้อยกว่า 40 แปลว่าชน (เก็บได้)
                io.to(pid).emit('tileCollected', t);
                tiles.splice(i, 1);
                io.emit('tileRemoved', t.id);
                
                // สร้างเหรียญใหม่ขึ้นมาทดแทนหลังผ่านไป 2 วินาที
                setTimeout(() => {
                    const chars = ['+', '-', '*', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
                    const char = chars[Math.floor(Math.random() * chars.length)];
                    const newTile = {
                        id: ++tileIdCounter,
                        char: char,
                        type: isNaN(char) ? 'op' : 'num',
                        x: 200 + Math.random() * (world.width - 400),
                        y: 200 + Math.random() * (world.height - 400)
                    };
                    tiles.push(newTile);
                    io.emit('newTile', newTile);
                }, 2000);
            }
        }
    }
}, 40);

// เริ่มรันเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 เกม Math Dungeon เริ่มทำงานแล้วที่พอร์ต ${PORT}`);
});
