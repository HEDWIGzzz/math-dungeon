const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (req, res) => res.status(200).send('OK'));

const world = { width: 4000, height: 4000 };
const stations = [ /* โค้ดฐานเดิม */ ];
let stationCodes = { 1: '1234', 2: '5678', 3: '9999', 4: '0000', 5: 'math' };

const players = {};
let matchmakingQueue = [];
let activeBattles = {};
let battleIdCounter = 0;

// ฟังก์ชันสุ่มโจทย์คณิตศาสตร์
function generateMathQuestion() {
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let num1, num2, answer;
    if (op === '+') { num1 = Math.floor(Math.random()*50)+10; num2 = Math.floor(Math.random()*50)+10; answer = num1 + num2; }
    else if (op === '-') { num1 = Math.floor(Math.random()*50)+20; num2 = Math.floor(Math.random()*20)+1; answer = num1 - num2; }
    else { num1 = Math.floor(Math.random()*9)+2; num2 = Math.floor(Math.random()*9)+2; answer = num1 * num2; }
    return { text: `${num1} ${op} ${num2} = ?`, answer: answer.toString(), difficulty: 'Normal' };
}

io.on('connection', (socket) => {
    socket.emit('initGame', { id: socket.id, world, stations, tiles: [] });

    socket.on('setupPlayer', data => {
        players[socket.id] = {
            id: socket.id, name: data.name, avatar: data.avatar,
            x: 2000, y: 2000, isMoving: false, level: 1, xp: 0, score: 0, completed: 0,
            inBattle: false
        };
        socket.emit('playerReady', { player: players[socket.id] });
    });

    socket.on('move', data => {
        if (players[socket.id] && !players[socket.id].inBattle) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].isMoving = data.isMoving;
        }
    });

    // ==========================================
    // PVP SYSTEM
    // ==========================================
    socket.on('findMatch', () => {
        const p = players[socket.id];
        if (!p || p.inBattle) return;
        
        if (!matchmakingQueue.includes(socket.id)) {
            matchmakingQueue.push(socket.id);
            socket.emit('matchStatus', { msg: 'SEARCHING FOR OPPONENT...' });
            
            if (matchmakingQueue.length >= 2) {
                const p1Id = matchmakingQueue.shift();
                const p2Id = matchmakingQueue.shift();
                
                const battleId = 'BATTLE_' + (++battleIdCounter);
                const firstQuestion = generateMathQuestion();
                
                activeBattles[battleId] = {
                    id: battleId,
                    p1: { id: p1Id, hp: 100, maxHp: 100, energy: 0, combo: 0 },
                    p2: { id: p2Id, hp: 100, maxHp: 100, energy: 0, combo: 0 },
                    question: firstQuestion
                };

                players[p1Id].inBattle = true;
                players[p2Id].inBattle = true;

                io.to(p1Id).emit('battleStart', { match: activeBattles[battleId], opponent: players[p2Id], me: 'p1' });
                io.to(p2Id).emit('battleStart', { match: activeBattles[battleId], opponent: players[p1Id], me: 'p2' });
            }
        }
    });

    socket.on('submitBattleAnswer', ans => {
        const pId = socket.id;
        const player = players[pId];
        if (!player || !player.inBattle) return;

        // หาห้อง Battle ที่ผู้เล่นอยู่
        let battle = null, myRole = null, oppRole = null;
        for (let bId in activeBattles) {
            if (activeBattles[bId].p1.id === pId) { battle = activeBattles[bId]; myRole = 'p1'; oppRole = 'p2'; break; }
            if (activeBattles[bId].p2.id === pId) { battle = activeBattles[bId]; myRole = 'p2'; oppRole = 'p1'; break; }
        }
        if (!battle) return;

        const isCorrect = (ans === battle.question.answer);
        const me = battle[myRole];
        const opp = battle[oppRole];

        if (isCorrect) {
            me.combo += 1;
            me.energy = Math.min(100, me.energy + 20);
            
            // Base Damage + Combo Bonus
            let dmg = 15 + (me.combo * 2);
            opp.hp -= dmg;
            
            io.to(battle.p1.id).emit('battleUpdate', { 
                action: 'HIT', attacker: myRole, damage: dmg, combo: me.combo, match: battle 
            });
            io.to(battle.p2.id).emit('battleUpdate', { 
                action: 'HIT', attacker: myRole, damage: dmg, combo: me.combo, match: battle 
            });

            // เช็คผลแพ้ชนะ
            if (opp.hp <= 0) {
                players[battle[myRole].id].score += 500; // รางวัลผู้ชนะ
                players[battle[myRole].id].inBattle = false;
                players[battle[oppRole].id].inBattle = false;
                io.to(battle[myRole].id).emit('battleEnd', { result: 'VICTORY' });
                io.to(battle[oppRole].id).emit('battleEnd', { result: 'DEFEAT' });
                delete activeBattles[battle.id];
                return;
            }

            // เปลี่ยนโจทย์เมื่อมีคนตอบถูก
            battle.question = generateMathQuestion();
            setTimeout(() => {
                if(activeBattles[battle.id]) {
                    io.to(battle.p1.id).emit('nextQuestion', battle.question);
                    io.to(battle.p2.id).emit('nextQuestion', battle.question);
                }
            }, 1000);

        } else {
            me.combo = 0; // Combo Break
            io.to(pId).emit('battleUpdate', { action: 'MISS', match: battle });
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        delete players[socket.id];
        // หากหลุดขณะต่อสู้ ปรับแพ้ทันที (ยังไม่ได้เขียนดักใน MVP นี้)
    });
});

setInterval(() => { io.emit('stateUpdate', players); }, 40);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Math Dungeon + PvP Online port ${PORT}`));
