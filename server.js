const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    pingInterval: 25000, 
    pingTimeout: 60000,
    cors: { origin: "*" }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.status(200).json({ ok: true, service: 'math-dungeon-online', activePlayers: players.size }));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'TEACHER-2026';
const MAX_PLAYERS = 80;

const stations = [
    { id: 1, name: 'ประตูแห่งสมการ', subtitle: 'หอคอยเริ่มต้น', x: 700, y: 700, code: 'MATH-101', reward: 100, color: '#65d9ff' },
    { id: 2, name: 'วิหารพีชคณิต', subtitle: 'Algebra Temple', x: 3300, y: 700, code: 'MATH-202', reward: 150, color: '#a78bfa' },
    { id: 3, name: 'หอคอยเรขาคณิต', subtitle: 'Geometry Tower', x: 700, y: 3300, code: 'MATH-303', reward: 200, color: '#34d399' },
    { id: 4, name: 'เขาวงกตฟังก์ชัน', subtitle: 'Function Maze', x: 3300, y: 3300, code: 'MATH-404', reward: 250, color: '#f59e0b' },
    { id: 5, name: 'บอสสุดท้าย', subtitle: 'THE FINAL TRIAL', x: 2000, y: 2000, code: 'MATH-505', reward: 500, color: '#fb7185' }
];

const world = { width: 4000, height: 4000 };
const players = new Map();
let nextTileId = 1;

// ระบบบันทึกข้อมูลผู้เล่น (เก็บนาน 3 วัน = 3 * 24 * 60 * 60 * 1000 ms)
const SAVE_FILE = path.join(__dirname, 'player_saves.json');
let savedPlayers = {};

function loadSaves() {
    try {
        if (fs.existsSync(SAVE_FILE)) {
            const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
            const now = Date.now();
            const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
            // กรองข้อมูลที่เก่าเกิน 3 วันทิ้ง
            for (let name in data) {
                if (now - data[name].lastActive < THREE_DAYS) {
                    savedPlayers[name] = data[name];
                }
            }
        }
    } catch(e) { savedPlayers = {}; }
}

function saveSaves() {
    try {
        const now = Date.now();
        const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
        const cleanData = {};
        for (let name in savedPlayers) {
            if (now - savedPlayers[name].lastActive < THREE_DAYS) {
                cleanData[name] = savedPlayers[name];
            }
        }
        fs.writeFileSync(SAVE_FILE, JSON.stringify(cleanData, null, 2));
    } catch(e) {}
}

loadSaves();

function sanitizeName(v) {
    return String(v || 'จอมเวทย์ฝึกหัด').replace(/[<>]/g, '').trim().slice(0, 18) || 'จอมเวทย์ฝึกหัด';
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function publicPlayer(p) {
    return { 
        id: p.id, name: p.name, x: p.x, y: p.y, 
        avatar: p.avatar, hat: p.hat, shirt: p.shirt, pants: p.pants, shoes: p.shoes,
        score: p.score, xp: p.xp, level: p.level, 
        isMoving: p.isMoving, completed: p.completed 
    };
}

function broadcastState() {
    const obj = {}; 
    for (const [id, p] of players) obj[id] = publicPlayer(p);
    io.emit('stateUpdate', obj);
    
    const list = [...players.values()]
        .sort((a, b) => b.score - a.score || b.xp - a.xp)
        .slice(0, 10)
        .map((p, i) => ({ rank: i + 1, ...publicPlayer(p) }));
    io.emit('leaderboard', list);
}

function randomTile() {
    const types = [
        { type: 'num', chars: ['0','1','2','3','4','5','6','7','8','9'] },
        { type: 'op', chars: ['+','−','×','÷'] },
        { type: 'eq', chars: ['='] }
    ];
    const t = types[Math.floor(Math.random() * types.length)];
    return { 
        id: nextTileId++, 
        x: 250 + Math.random() * 3500, 
        y: 250 + Math.random() * 3500, 
        type: t.type, 
        char: t.chars[Math.floor(Math.random() * t.chars.length)] 
    };
}

function spawnTiles(n = 120) {
    const a = []; 
    for (let i = 0; i < n; i++) a.push(randomTile()); 
    return a;
}
let tiles = spawnTiles();

function levelFromXp(xp) { return Math.floor(xp / 500) + 1; }
function normalizeCode(s) { return String(s || '').trim().toUpperCase(); }

io.on('connection', (socket) => {
    if (players.size >= MAX_PLAYERS) {
        socket.emit('serverFull', { max: MAX_PLAYERS });
        return socket.disconnect(true);
    }

    socket.emit('initGame', { 
        id: socket.id, 
        mapSize: world.width, 
        world, 
        stations: stations.map(s => ({ id: s.id, name: s.name, subtitle: s.subtitle, x: s.x, y: s.y, reward: s.reward, color: s.color })), 
        tiles 
    });

    socket.on('setupPlayer', (data = {}) => {
        const name = sanitizeName(data.name);
        
        // ตรวจสอบข้อมูลเก่าที่บันทึกไว้ภายใน 3 วัน
        let existing = savedPlayers[name];
        let p = {
            id: socket.id,
            name: name,
            avatar: ['hero', 'wizard', 'robot', 'rogue', 'cleric'].includes(data.avatar) ? data.avatar : 'hero',
            hat: ['none', 'wizard_hat', 'cap', 'crown', 'hood'].includes(data.hat) ? data.hat : 'none',
            shirt: ['shirt1', 'shirt2', 'shirt3', 'shirt4', 'shirt5'].includes(data.shirt) ? data.shirt : 'shirt1',
            pants: ['pants1', 'pants2', 'pants3', 'pants4', 'pants5'].includes(data.pants) ? data.pants : 'pants1',
            shoes: ['shoes1', 'shoes2', 'shoes3', 'shoes4', 'shoes5'].includes(data.shoes) ? data.shoes : 'shoes1',
            x: 2000 + Math.random() * 100 - 50, 
            y: 2400 + Math.random() * 100 - 50,
            score: existing ? existing.score : 0, 
            xp: existing ? existing.xp : 0, 
            level: existing ? existing.level : 1, 
            isMoving: false, 
            completed: existing ? existing.completed : 0, 
            lastMove: 0,
            unlocked: existing ? new Set(existing.unlocked) : new Set()
        };

        players.set(socket.id, p);
        
        // บันทึกสถานะปัจจุบัน
        savedPlayers[name] = {
            score: p.score, xp: p.xp, level: p.level, completed: p.completed,
            unlocked: [...p.unlocked], lastActive: Date.now()
        };
        saveSaves();

        socket.emit('playerReady', { player: publicPlayer(p) });
        broadcastState();
    });

    socket.on('move', (data = {}) => {
        const p = players.get(socket.id); 
        if (!p) return;
        
        const now = Date.now(); 
        if (now - p.lastMove < 25) return; 
        p.lastMove = now;

        const x = Number(data.x), y = Number(data.y); 
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        
        p.x = clamp(x, 80, world.width - 80); 
        p.y = clamp(y, 80, world.height - 80); 
        p.isMoving = !!data.isMoving;

        for (let i = tiles.length - 1; i >= 0; i--) {
            const t = tiles[i];
            if (Math.hypot(t.x - p.x, t.y - p.y) < 42) {
                tiles.splice(i, 1);
                socket.emit('tileCollected', t);
                io.emit('tileRemoved', t.id);

                const newT = randomTile();
                tiles.push(newT);
                io.emit('newTile', newT);
            }
        }
        broadcastState();
    });

    socket.on('submitEquation', (equation) => {
        const p = players.get(socket.id); 
        if (!p) return;
        
        const s = String(equation || '').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s/g, '');
        
        if (!/^[-+*/().0-9]+=[-+*/().0-9]+$/.test(s)) {
            return socket.emit('equationResult', { success: false, msg: 'คาถายังไม่สมบูรณ์ ต้องมีสมการซ้าย = ขวา' });
        }
        
        const [a, b] = s.split('=');
        try {
            const safe = (expr) => Function('"use strict"; return (' + expr + ')')();
            const av = safe(a), bv = safe(b);
            
            if (!Number.isFinite(av) || !Number.isFinite(bv)) throw new Error('bad');
            if (Math.abs(av - bv) > 1e-9) {
                return socket.emit('equationResult', { success: false, msg: 'สมการไม่สมดุล ลองตรวจคำตอบอีกครั้ง' });
            }
            
            p.score += 40; 
            p.xp += 50; 
            p.level = levelFromXp(p.xp);
            
            savedPlayers[p.name] = { score: p.score, xp: p.xp, level: p.level, completed: p.completed, unlocked: [...p.unlocked], lastActive: Date.now() };
            saveSaves();

            socket.emit('equationResult', { success: true, score: p.score, xp: p.xp, level: p.level });
            broadcastState();
        } catch (e) {
            socket.emit('equationResult', { success: false, msg: 'รูปแบบสมการไม่ถูกต้อง' });
        }
    });

    socket.on('requestStationUnlock', (data = {}) => {
        const p = players.get(socket.id); 
        if (!p) return;
        const station = stations.find(s => s.id === Number(data.stationId)); 
        if (!station) return;
        
        const dist = Math.hypot(p.x - station.x, p.y - station.y);
        if (dist > 180) return socket.emit('stationResult', { success: false, msg: 'เดินเข้าใกล้แท่นภารกิจก่อน', stationId: station.id });
        if (p.unlocked.has(station.id)) return socket.emit('stationResult', { success: true, already: true, stationId: station.id, unlocked: [...p.unlocked] });
        
        socket.emit('stationPrompt', { stationId: station.id, name: station.name, reward: station.reward });
    });

    socket.on('submitStationCode', (data = {}) => {
        const p = players.get(socket.id); 
        if (!p) return;
        const station = stations.find(s => s.id === Number(data.stationId)); 
        if (!station) return;
        
        const dist = Math.hypot(p.x - station.x, p.y - station.y);
        if (dist > 220) return socket.emit('stationResult', { success: false, msg: 'อยู่ไกลจากแท่นภารกิจเกินไป', stationId: station.id });
        if (p.unlocked.has(station.id)) return socket.emit('stationResult', { success: true, already: true, stationId: station.id, unlocked: [...p.unlocked] });
        if (normalizeCode(data.code) !== normalizeCode(station.code)) {
            return socket.emit('stationResult', { success: false, msg: 'รหัสผ่านไม่ถูกต้อง', stationId: station.id });
        }
        
        p.unlocked.add(station.id); 
        p.completed = p.unlocked.size;
        p.score += station.reward; 
        p.xp += station.reward * 2; 
        p.level = levelFromXp(p.xp);
        
        savedPlayers[p.name] = { score: p.score, xp: p.xp, level: p.level, completed: p.completed, unlocked: [...p.unlocked], lastActive: Date.now() };
        saveSaves();

        socket.emit('stationResult', { success: true, stationId: station.id, reward: station.reward, score: p.score, xp: p.xp, level: p.level, unlocked: [...p.unlocked] });
        io.emit('stationWorldUpdate', { stationId: station.id, playerId: p.id });
        broadcastState();
    });

    socket.on('disconnect', () => {
        players.delete(socket.id); 
        broadcastState();
    });
});

app.get('/api/admin/stations', (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    res.json(stations);
});

app.post('/api/admin/stations', (req, res) => {
    if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const id = Number(req.body.id), code = String(req.body.code || '').trim();
    const s = stations.find(x => x.id === id); 
    if (!s) return res.status(404).json({ error: 'Station not found' });
    if (code.length < 2 || code.length > 40) return res.status(400).json({ error: 'Invalid code' });
    
    s.code = code; 
    res.json({ ok: true, id: s.id, newCode: s.code });
});

const adminHtmlHandler = (req, res) => {
    res.send(`
    <!doctype html>
    <html lang="th">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Math Dungeon - Teacher Admin Panel</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Kanit:wght@400;600&display=swap');
            body { font-family: 'Kanit', sans-serif; background: #070914; color: #fff; padding: 30px; }
            .box { background: #121a30; padding: 25px; border-radius: 16px; max-width: 600px; margin: auto; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h2 { color: #f7c948; margin-top: 0; }
            .station-row { background: #080d1a; padding: 12px; margin-bottom: 10px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,255,255,0.05); }
            input { background: #1b2642; border: 1px solid #33405c; color: #fff; padding: 8px 12px; border-radius: 8px; font-family: 'Kanit'; outline: none; }
            button { background: #34d399; color: #111827; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
            button:hover { filter: brightness(1.1); }
            .key-box { background: #1b2642; padding: 12px; border-radius: 10px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; }
        </style>
    </head>
    <body>
        <div class="box">
            <h2>🛡️ แผงควบคุมคุณครู (Teacher Admin)</h2>
            <p>เปลี่ยนรหัสผ่านฐานทั้ง 5 ได้ทันทีโดยไม่ต้องรีสตาร์ทเซิร์ฟเวอร์</p>
            <div class="key-box">
                <label><b>Admin Key:</b></label>
                <input type="password" id="admKey" value="TEACHER-2026" style="width: 200px;">
            </div>
            <div id="stationsList">กำลังโหลดข้อมูล...</div>
        </div>
        <script>
            async function loadStations() {
                const key = document.getElementById('admKey').value;
                try {
                    const res = await fetch('/api/admin/stations?key=' + encodeURIComponent(key));
                    if(!res.ok) { 
                        document.getElementById('stationsList').innerHTML = '<p style="color:#fb7185">⚠️ Admin Key ไม่ถูกต้อง</p>'; 
                        return; 
                    }
                    const data = await res.json();
                    document.getElementById('stationsList').innerHTML = data.map(s => \`
                        <div class="station-row">
                            <div><b>ฐานที่ \${s.id}: \${s.name}</b><br><small style="color:#8a96b0">\${s.subtitle}</small></div>
                            <div>
                                <input type="text" id="code_\${s.id}" value="\${s.code}" style="width: 110px;">
                                <button onclick="updateCode(\${s.id})">บันทึก</button>
                            </div>
                        </div>
                    \`).join('');
                } catch(e) {
                    document.getElementById('stationsList').innerHTML = '<p style="color:#fb7185">เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว</p>';
                }
            }
            async function updateCode(id) {
                const key = document.getElementById('admKey').value;
                const code = document.getElementById('code_' + id).value;
                const res = await fetch('/api/admin/stations?key=' + encodeURIComponent(key), {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id, code})
                });
                const r = await res.json();
                if(r.ok) alert('อัปเดตรหัสฐานที่ ' + id + ' สำเร็จ!');
                else alert('เกิดข้อผิดพลาด: ' + r.error);
            }
            document.getElementById('admKey').addEventListener('input', loadStations);
            loadStations();
        </script>
    </body>
    </html>
    `);
};

app.get('/admin', adminHtmlHandler);
app.get('/admin.html', adminHtmlHandler);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`🚀 Math Dungeon Online Running!`);
    console.log(`🎮 Student Game: http://localhost:${PORT}`);
    console.log(`🛡️ Teacher Admin: http://localhost:${PORT}/admin`);
    console.log(`🔑 Admin Key: ${ADMIN_KEY}`);
    console.log(`========================================`);
});
