// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { sampleQuestions, getQuestionByDifficulty } = require('./questions');
const { computeDamage, nowISO } = require('./utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/../client'));

const PORT = process.env.PORT || 3000;

// In-memory stores (for demo). In production use DB.
const onlinePlayers = new Map(); // socketId -> playerInfo
const pendingChallenges = new Map(); // challengerId -> targetId
const rooms = new Map(); // roomId -> roomState

// Simple matchmaking: challenge friend
io.on('connection', socket => {
  console.log('connect', socket.id);

  socket.on('register', (player) => {
    // player: { id, name, avatar, class, level, rating }
    onlinePlayers.set(socket.id, { socketId: socket.id, ...player });
    io.emit('onlinePlayers', Array.from(onlinePlayers.values()).map(p => ({
      socketId: p.socketId, name: p.name, avatar: p.avatar, class: p.class, level: p.level, rating: p.rating
    })));
  });

  socket.on('challenge', ({ targetSocketId }) => {
    const challenger = onlinePlayers.get(socket.id);
    const target = onlinePlayers.get(targetSocketId);
    if (!challenger || !target) return;
    // send challenge request
    io.to(targetSocketId).emit('challengeRequest', { from: challenger });
  });

  socket.on('acceptChallenge', ({ fromSocketId }) => {
    const a = onlinePlayers.get(socket.id);
    const b = onlinePlayers.get(fromSocketId);
    if (!a || !b) return;
    // create room
    const roomId = `room_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const room = {
      id: roomId,
      players: {
        [socket.id]: { ...a, hp: 100, energy: 0, combo: 0, shield: 0 },
        [fromSocketId]: { ...b, hp: 100, energy: 0, combo: 0, shield: 0 }
      },
      turn: 0,
      questionIndex: 0,
      inProgress: true,
      log: []
    };
    rooms.set(roomId, room);
    // join sockets to room
    io.sockets.sockets.get(socket.id).join(roomId);
    io.sockets.sockets.get(fromSocketId).join(roomId);

    // notify both
    io.to(roomId).emit('matchFound', {
      roomId,
      players: Object.values(room.players).map(p => ({ socketId: p.socketId, name: p.name, avatar: p.avatar, class: p.class, level: p.level }))
    });

    // small delay then start
    setTimeout(() => startRound(roomId), 1200);
  });

  socket.on('submitAnswer', ({ roomId, answer, questionId, clientTimestamp }) => {
    const room = rooms.get(roomId);
    if (!room || !room.inProgress) return;
    const player = room.players[socket.id];
    if (!player) return;

    // Prevent double submit
    if (!room.submissions) room.submissions = {};
    if (!room.submissions[questionId]) room.submissions[questionId] = {};

    // record server receive time
    const serverReceive = Date.now();
    // store submission
    room.submissions[questionId][socket.id] = {
      answer,
      serverReceive,
      clientTimestamp
    };

    // If both submitted or timeout, evaluate
    const playersInRoom = Object.keys(room.players);
    const subs = room.submissions[questionId];
    if (Object.keys(subs).length === playersInRoom.length) {
      evaluateQuestion(roomId, questionId);
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    onlinePlayers.delete(socket.id);
    io.emit('onlinePlayers', Array.from(onlinePlayers.values()).map(p => ({
      socketId: p.socketId, name: p.name, avatar: p.avatar, class: p.class, level: p.level, rating: p.rating
    })));
    // TODO: handle disconnect in rooms (forfeit)
  });
});

function startRound(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  // pick question difficulty based on simple scaling
  const difficulty = pickDifficultyForRoom(room);
  const q = getQuestionByDifficulty(difficulty);
  const questionId = `q_${Date.now()}_${Math.floor(Math.random()*1000)}`;
  room.currentQuestion = { id: questionId, ...q, difficulty };
  room.submissions = {}; // reset
  room.questionIndex++;

  // broadcast question with server timestamp
  io.to(roomId).emit('newQuestion', {
    questionId,
    text: q.text,
    difficulty,
    serverSentAt: Date.now()
  });

  // set timeout for question (e.g., 12s)
  setTimeout(() => {
    // if not all submitted, evaluate with what we have
    if (room.submissions && Object.keys(room.submissions[questionId] || {}).length < Object.keys(room.players).length) {
      evaluateQuestion(roomId, questionId);
    }
  }, 12000);
}

function evaluateQuestion(roomId, questionId) {
  const room = rooms.get(roomId);
  if (!room || !room.currentQuestion || room.currentQuestion.id !== questionId) return;
  const q = room.currentQuestion;
  const correctAnswer = q.answer; // numeric or string
  const subs = room.submissions[questionId] || {};
  const results = [];

  // For each player compute correctness, time, damage
  for (const socketId of Object.keys(room.players)) {
    const p = room.players[socketId];
    const sub = subs[socketId];
    let correct = false;
    let timeTaken = null;
    if (sub) {
      // compute time using serverReceive - serverSentAt
      timeTaken = (sub.serverReceive - q.serverSentAt) || (sub.serverReceive - q.serverSentAt);
      // Accept numeric equality (loose)
      correct = String(sub.answer).trim() === String(correctAnswer).trim();
    } else {
      correct = false;
      timeTaken = null;
    }

    // compute damage via helper
    const dmgResult = computeDamage({
      baseDamageByDifficulty: q.baseDamage,
      correct,
      timeTaken,
      difficulty: q.difficulty,
      combo: p.combo || 0,
      playerClass: p.class,
      energy: p.energy || 0
    });

    // apply damage to opponent or self (backfire)
    const opponentId = Object.keys(room.players).find(id => id !== socketId);
    if (correct) {
      // apply to opponent, consider opponent shield
      const opponent = room.players[opponentId];
      let finalDamage = dmgResult.damage;
      if (opponent.shield && opponent.shield > 0) {
        const blocked = Math.min(opponent.shield, finalDamage);
        opponent.shield -= blocked;
        finalDamage -= blocked;
      }
      opponent.hp = Math.max(0, opponent.hp - finalDamage);
      // update combo, energy
      p.combo = (p.combo || 0) + 1;
      p.energy = Math.min(100, (p.energy || 0) + dmgResult.energyGain);
    } else {
      // miss: maybe backfire
      if (dmgResult.backfire) {
        p.hp = Math.max(0, p.hp - dmgResult.backfireDamage);
        p.combo = 0;
      } else {
        p.combo = 0;
      }
    }

    // record result
    results.push({
      socketId,
      name: p.name,
      correct,
      timeTaken,
      damageDealt: correct ? dmgResult.damage : 0,
      backfire: !correct && dmgResult.backfire ? true : false,
      backfireDamage: !correct && dmgResult.backfire ? dmgResult.backfireDamage : 0,
      newHp: p.hp,
      newEnergy: p.energy,
      combo: p.combo
    });
  }

  // push to log
  room.log.push({ questionId, results, timestamp: Date.now(), question: q.text });

  // broadcast results
  io.to(roomId).emit('questionResult', { questionId, results, roomState: summarizeRoom(room) });

  // check win/lose
  const alive = Object.values(room.players).filter(p => p.hp > 0);
  if (alive.length <= 1) {
    // match end
    room.inProgress = false;
    const winner = alive[0] ? alive[0] : null;
    io.to(roomId).emit('matchEnd', {
      winner: winner ? { socketId: winner.socketId, name: winner.name } : null,
      summary: buildMatchSummary(room)
    });
    rooms.delete(roomId);
    return;
  }

  // next question after short delay
  setTimeout(() => startRound(roomId), 1500);
}

function pickDifficultyForRoom(room) {
  // simple: random weighted by questionIndex
  const idx = room.questionIndex || 0;
  if (idx < 2) return 'Normal';
  if (idx < 5) return Math.random() < 0.8 ? 'Normal' : 'Hard';
  return Math.random() < 0.6 ? 'Hard' : 'Expert';
}

function summarizeRoom(room) {
  return {
    players: Object.values(room.players).map(p => ({ socketId: p.socketId, hp: p.hp, energy: p.energy, combo: p.combo, shield: p.shield })),
    logLength: room.log.length
  };
}

function buildMatchSummary(room) {
  // simple summary
  const players = Object.values(room.players).map(p => ({
    name: p.name,
    finalHp: p.hp,
    totalDamageDealt: 0 // for demo, compute from log if needed
  }));
  return { players, questions: room.log.length, log: room.log };
}

server.listen(PORT, () => console.log(`Server running on ${PORT}`));

