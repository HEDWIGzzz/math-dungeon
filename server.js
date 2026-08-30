const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// ข้อมูลจำลองใน Open World
let players = {};
let tokens = [
    { id: 1, val: '3', x: 300, y: 250 },
    { id: 2, val: 'x', x: 700, y: 350 },
    { id: 3, val: '+', x: 450, y: 550 },
    { id: 4, val: '5', x: 900, y: 200 },
    { id: 5, val: '=', x: 600, y: 650 },
    { id: 6, val: '8', x: 250, y: 450 },
    { id: 7, val: '2', x: 850, y: 400 }
];

let gates = [
    { id: 1, name: "Base 01: สมการเชิงเส้น", x: 500, y: 150, targetEquation: ['3', '+', 'x', '=', '8'], solved: false },
    { id: 2, name: "Base 02: พีชคณิตขั้นสูง", x: 1000, y: 500, targetEquation: ['2', 'x', '=', '6'], solved: false }
];

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    players[socket.id] = {
        id: socket.id,
        name: 'Guest',
        x: 500,
        y: 400,
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
        emoji: '🧙',
        xp: 0,
        gold: 0
    };

    // ส่งข้อมูลโลกเริ่มต้นให้ผู้เล่นใหม่
    socket.emit('initWorld', { id: socket.id, tokens, gates, players });
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // รับข้อมูลการตั้งชื่อ
    socket.on('joinGame', (data) => {
        if (players[socket.id]) {
            players[socket.id].name = data.name || 'นักเรียน';
        }
        io.emit('updatePlayers', players);
    });

    // รับตำแหน่งการเคลื่อนไหว (Real-time movement)
    socket.on('playerMove', (pos) => {
        if (players[socket.id]) {
            players[socket.id].x = pos.x;
            players[socket.id].y = pos.y;
            socket.broadcast.emit('updatePlayers', players);
        }
    });

    // เก็บเบี้ยสัญลักษณ์บนแมพ
    socket.on('collectToken', (tokenId) => {
        const index = tokens.findIndex(t => t.id === tokenId);
        if (index !== -1) {
            const token = tokens.splice(index, 1)[0];
            io.emit('tokenCollected', { tokenId, tokenVal: token.val, playerId: socket.id });

            // สุ่มเกิดใหม่หลังจาก 15 วินาที
            setTimeout(() => {
                const newToken = {
                    id: Date.now() + Math.random(),
                    val: token.val,
                    x: Math.floor(Math.random() * 1000) + 100,
                    y: Math.floor(Math.random() * 600) + 100
                };
                tokens.push(newToken);
                io.emit('spawnToken', newToken);
            }, 15000);
        }
    });

    // ตรวจสอบสมการผ่านเกต
    socket.on('solveGate', ({ gateId, success }) => {
        const gate = gates.find(g => g.id === gateId);
        if (gate && success) {
            gate.solved = true;
            if (players[socket.id]) {
                players[socket.id].xp += 150;
                players[socket.id].gold += 80;
            }
            io.emit('gateSolved', { gateId, players });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('updatePlayers', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Math Dungeon Open World Server running on port ${PORT}`);
});
