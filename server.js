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

// ฟังก์ชันสร้างโจทย์ 5 ระดับความยาก
function generateBattleQuestion() {
    const r = Math.random();
    let num1, num2, num3, ans, text;
    let diff, baseDmg;

    if (r < 0.3) {
        // Easy
        num1 = Math.floor(Math.random() * 20) + 1; num2 = Math.floor(Math.random() * 20) + 1;
        text = `${num1} + ${num2} = ?`; ans = num1 + num2; diff = '⭐ Easy'; baseDmg = 10;
    } else if (r < 0.6) {
        // Normal
        num1 = Math.floor(Math.random() * 12) + 2; num2 = Math.floor(Math.random() * 12) + 2;
        text = `${num1} × ${num2} = ?`; ans = num1 * num2; diff = '⭐⭐ Normal'; baseDmg = 20;
    } else if (r < 0.85) {
        // Hard
        num1 = Math.floor(Math.random() * 10) + 5; num2 = Math.floor(Math.random() * 10) + 2; num3 = Math.floor(Math.random() * 30) + 10;
        text = `(${num1} × ${num2}) + ${num3} = ?`; ans = (num1 * num2) + num3; diff = '⭐⭐⭐ Hard'; baseDmg = 35;
    } else if (r < 0.95) {
        // Expert
        num1 = Math.floor(Math.random() * 15) + 10; num2 = Math.floor(Math.random() * 15) + 10; num3 = Math.floor(Math.random() * 50) + 20;
        text = `(${num1} × ${num2}) - ${num3} = ?`; ans = (num1 * num2) - num3; diff = '⭐⭐⭐⭐ Expert'; baseDmg = 50;
    } else {
        // Legendary
        num1 = Math.floor(Math.random() * 9) + 2; num2 = Math.floor(Math.random() * 9) + 2; num3 = Math.floor(Math.random() * 9) + 2;
        text = `${num1} × ${num2} × ${num3} = ?`; ans = num1 * num2 * num3; diff = '⭐⭐⭐⭐⭐ Legendary'; baseDmg = 80;
    }

    return { text, answer: ans.toString(), diff, baseDmg, startTime: Date.now() };
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
            players[socket.id].x = data.x; players[socket.id].y = data.y; players[socket.id].isMoving = data.isMoving;
        }
    });

    // ==========================================
    // PVP MATCHMAKING & COMBAT ENGINE
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
                const firstQuestion = generateBattleQuestion();
                
                // Set Max HP based on Class
                const getHp = (avatar) => avatar === 'robot' ? 150 : (avatar === 'hero' ? 120 : 100);

                activeBattles[battleId] = {
                    id: battleId,
                    p1: { id: p1Id, avatar: players[p1Id].avatar, hp: getHp(players[p1Id].avatar), maxHp: getHp(players[p1Id].avatar), energy: 0, combo: 0 },
                    p2: { id: p2Id, avatar: players[p2Id].avatar, hp: getHp(players[p2Id].avatar), maxHp: getHp(players[p2Id].avatar), energy: 0, combo: 0 },
                    question: firstQuestion
                };

                players[p1Id].inBattle = true; players[p2Id].inBattle = true;

                io.to(p1Id).emit('battleStart', { match: activeBattles[battleId], opponent: players[p2Id], me: 'p1' });
                io.to(p2Id).emit('battleStart', { match: activeBattles[battleId], opponent: players[p1Id], me: 'p2' });
            }
        }
    });

    socket.on('submitBattleAnswer', ans => {
        const pId = socket.id;
        const player = players[pId];
        if (!player || !player.inBattle) return;

        let battle = null, myRole = null, oppRole = null;
        for (let bId in activeBattles) {
            if (activeBattles[bId].p1.id === pId) { battle = activeBattles[bId]; myRole = 'p1'; oppRole = 'p2'; break; }
            if (activeBattles[bId].p2.id === pId) { battle = activeBattles[bId]; myRole = 'p2'; oppRole = 'p1'; break; }
        }
        if (!battle) return;

        const isCorrect = (ans === battle.question.answer);
        const me = battle[myRole];
        const opp = battle[oppRole];
        let logs = [];

        if (isCorrect) {
            const timeTaken = (Date.now() - battle.question.startTime) / 1000;
            me.combo += 1;
            me.energy = Math.min(100, me.energy + 25);
            
            let dmg = battle.question.baseDmg;

            // 1. CLASS PASSIVE SKILLS
            let critChance = 0.1;
            if (me.avatar === 'hero') critChance = 0.3; // Warrior: High Crit
            if (me.avatar === 'wizard') dmg = Math.floor(dmg * 1.2); // Mage: +20% Base Dmg
            if (me.avatar === 'cleric') { 
                me.hp = Math.min(me.maxHp, me.hp + 10); // Cleric: Heal on correct
                logs.push('💚 HEAL +10');
            }

            // 2. SPEED BONUS (First Strike)
            if (timeTaken <= 3.5) {
                let speedMult = me.avatar === 'rogue' ? 1.8 : 1.5; // Rogue: higher speed bonus
                dmg = Math.floor(dmg * speedMult);
                logs.push('⚡ FIRST STRIKE!');
            }

            // 3. COMBO BONUS
            if (me.combo > 1) {
                dmg += (me.combo * 5);
                logs.push(`🔥 COMBO x${me.combo}`);
            }

            // 4. CRITICAL HIT
            if (Math.random() < critChance) {
                dmg = Math.floor(dmg * 2);
                logs.push('💥 CRITICAL!');
            }

            // 5. OPPONENT DEFENSE (Robot)
            if (opp.avatar === 'robot') {
                dmg = Math.floor(dmg * 0.8); // Robot takes 20% less damage
            }

            // APPLY DAMAGE
            opp.hp -= dmg;
            logs.push(`-${dmg} HP`);
            
            io.to(battle.p1.id).emit('battleUpdate', { action: 'HIT', attacker: myRole, logs, match: battle });
            io.to(battle.p2.id).emit('battleUpdate', { action: 'HIT', attacker: myRole, logs, match: battle });

            // WIN CONDITION
            if (opp.hp <= 0) {
                players[battle[myRole].id].score += 500;
                players[battle[myRole].id].inBattle = false; players[battle[oppRole].id].inBattle = false;
                io.to(battle[myRole].id).emit('battleEnd', { result: '🏆 VICTORY' });
                io.to(battle[oppRole].id).emit('battleEnd', { result: '💀 DEFEAT' });
                delete activeBattles[battle.id];
                return;
            }

            // NEXT QUESTION
            battle.question = generateBattleQuestion();
            setTimeout(() => {
                if(activeBattles[battle.id]) {
                    io.to(battle.p1.id).emit('nextQuestion', battle.question);
                    io.to(battle.p2.id).emit('nextQuestion', battle.question);
                }
            }, 1000);

        } else {
            me.combo = 0; // Combo Break
            io.to(pId).emit('battleUpdate', { action: 'MISS', logs: ['❌ MISS! Combo Break'], match: battle });
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(id => id !== socket.id);
        delete players[socket.id];
    });
});

setInterval(() => { io.emit('stateUpdate', players); }, 40);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Math Dungeon PvP Online port ${PORT}`));
