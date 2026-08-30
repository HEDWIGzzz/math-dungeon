const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.status(200).send('OK'));

const world = { width: 4000, height: 4000 };

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

const players = {};
let matchmakingQueue = [];
let activeBattles = {};
let battleIdCounter = 0;

io.on('connection', (socket) => {
    socket.emit('initGame', { id: socket.id, stages, stationCodes });

    socket.emit('currentAdminCodes', stationCodes);

    socket.setupPlayer = (data) => {
        players[socket.id] = {
            id: socket.id,
            name: data.name,
            classId: data.classId || 'mage',
            x: 2000, y: 2000,
            score: 0,
            inBattle: false
        };
        io.emit('stateUpdate', players);
    };

    socket.on('setupPlayer', data => socket.setupPlayer(data));

    socket.on('move', data => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
        }
    });

    // Admin Codes Update
    socket.on('updateAdminCodes', newCodes => {
        stationCodes = newCodes;
        stages.forEach(s => {
            if (newCodes[s.id]) s.code = newCodes[s.id];
        });
        io.emit('currentAdminCodes', stationCodes);
        console.log('Teacher updated station codes:', stationCodes);
    });

    // PvP Matchmaking
    socket.on('findPvpMatch', () => {
        const p = players[socket.id];
        if (!p || p.inBattle) return;

        if (!matchmakingQueue.includes(socket.id)) {
            matchmakingQueue.push(socket.id);
            socket.emit('pvpStatus', { msg: 'SEARCHING FOR RIVAL...' });

            if (matchmakingQueue.length >= 2) {
                const p1Id = matchmakingQueue.shift();
                const p2Id = matchmakingQueue.shift();

                const battleId = 'BATTLE_' + (++battleIdCounter);
                activeBattles[battleId] = {
                    id: battleId,
                    p1: { id: p1Id, hp: 100, combo: 0 },
                    p2: { id: p2Id, hp: 100, combo: 0 }
                };

                players[p1Id].inBattle = true;
                players[p2Id].inBattle = true;

                io.to(p1Id).emit('pvpStart', { matchId: battleId, opponent: players[p2Id], role: 'p1' });
                io.to(p2Id).emit('pvpStart', { matchId: battleId, opponent: players[p1Id], role: 'p2' });
            }
        }
    });

    socket.on('submitPvpAction', data => {
        const { matchId, damage, isCorrect } = data;
        const battle = activeBattles[matchId];
        if (!battle) return;

        const isP1 = battle.p1.id === socket.id;
        const attacker = isP1 ? battle.p1 : battle.p2;
        const defender = isP1 ? battle.p2 : battle.p1;
        const oppSocketId = defender.id;

        if (isCorrect) {
            attacker.combo++;
            let finalDmg = damage + Math.min(30, (attacker.combo - 1) * 5);
            defender.hp = Math.max(0, defender.hp - finalDmg);

            io.to(socket.id).emit('pvpResult', { success: true, damage: finalDmg, myHp: attacker.hp, oppHp: defender.hp });
            io.to(oppSocketId).emit('pvpResult', { success: false, damage: finalDmg, myHp: defender.hp, oppHp: attacker.hp });

            if (defender.hp <= 0) {
                io.to(socket.id).emit('pvpEnd', { win: true });
                io.to(oppSocketId).emit('pvpEnd', { win: false });
                players[socket.id].inBattle = false;
                players[oppSocketId].inBattle = false;
                delete activeBattles[matchId];
            }
        } else {
            attacker.combo = 0;
            io.to(socket.id).emit('pvpResult', { success: false, damage: 0, myHp: attacker.hp, oppHp: defender.hp });
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        delete players[socket.id];
        io.emit('stateUpdate', players);
    });
});

setInterval(() => { io.emit('stateUpdate', players); }, 40);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Math Dungeon Online running on port ${PORT}`));
