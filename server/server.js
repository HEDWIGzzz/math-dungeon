const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getQuestion } = require('./questions');
const { calculateDamage } = require('./utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/../client'));

const rooms = new Map();

io.on('connection', socket => {
  socket.on('register', player => {
    socket.player = { ...player, hp: 100, energy: 0, combo: 0 };
    io.emit('onlinePlayers', getOnlinePlayers());
  });

  socket.on('challenge', targetId => {
    io.to(targetId).emit('challengeRequest', socket.player);
  });

  socket.on('acceptChallenge', challengerId => {
    const roomId = 'room_' + Date.now();
    const challenger = io.sockets.sockets.get(challengerId);
    const opponent = socket;

    rooms.set(roomId, {
      players: [challenger, opponent],
      question: null
    });

    challenger.join(roomId);
    opponent.join(roomId);

    io.to(roomId).emit('matchFound', {
      roomId,
      players: rooms.get(roomId).players.map(p => p.player)
    });

    sendNewQuestion(roomId);
  });

  socket.on('submitAnswer', ({ roomId, answer }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const player = socket;
    const opponent = room.players.find(p => p.id !== socket.id);

    const correct = String(answer).trim() === String(room.question.answer).trim();
    const damage = calculateDamage(correct, room.question.difficulty, player.player.combo);

    if (correct) {
      opponent.player.hp -= damage;
      player.player.combo++;
    } else {
      player.player.combo = 0;
    }

    io.to(roomId).emit('roundResult', {
      question: room.question.text,
      correct,
      damage,
      hp: {
        [player.id]: player.player.hp,
        [opponent.id]: opponent.player.hp
      }
    });

    if (opponent.player.hp <= 0 || player.player.hp <= 0) {
      io.to(roomId).emit('matchEnd', {
        winner: player.player.hp > 0 ? player.player : opponent.player
      });
      rooms.delete(roomId);
      return;
    }

    sendNewQuestion(roomId);
  });
});

function sendNewQuestion(roomId) {
  const room = rooms.get(roomId);
  const q = getQuestion();
  room.question = q;
  io.to(roomId).emit('newQuestion', q);
}

function getOnlinePlayers() {
  return [...io.sockets.sockets.values()].map(s => ({
    id: s.id,
    name: s.player?.name || 'Unknown',
    class: s.player?.class || 'None'
  }));
}

server.listen(3000, () => console.log('Server running on port 3000'));
