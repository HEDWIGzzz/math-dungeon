// client/client.js
const socket = io();

// demo player info (in real app get from auth)
const me = { id: 'p_' + Math.floor(Math.random()*10000), name: 'Player' + Math.floor(Math.random()*100), avatar: 'A', class: 'MAGE', level: 5, rating: 1000 };

let currentRoom = null;
let currentQuestion = null;
let answerBuffer = '';

function register() {
  socket.emit('register', me);
}

socket.on('onlinePlayers', (players) => {
  const ul = document.getElementById('playersList');
  ul.innerHTML = '';
  players.forEach(p => {
    if (p.socketId === socket.id) return;
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.class}) [${p.level}]`;
    const btn = document.createElement('button');
    btn.textContent = 'Challenge';
    btn.onclick = () => {
      socket.emit('challenge', { targetSocketId: p.socketId });
      btn.disabled = true;
      btn.textContent = 'Challenging...';
    };
    li.appendChild(btn);
    ul.appendChild(li);
  });
});

socket.on('challengeRequest', ({ from }) => {
  if (!confirm(`${from.name} challenges you to a duel. Accept?`)) return;
  socket.emit('acceptChallenge', { fromSocketId: from.socketId });
});

socket.on('matchFound', ({ roomId, players }) => {
  currentRoom = roomId;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('battle').style.display = 'flex';
  // show players
  const pPanel = document.getElementById('playerPanel');
  pPanel.innerHTML = `<h3>${me.name}</h3><div>Class: ${me.class}</div><div>HP: <span id="myHp">100</span></div><div>Energy: <span id="myEnergy">0</span></div>`;
  const log = document.getElementById('combatLog');
  log.innerHTML = `<div>Match found! Room: ${roomId}</div>`;
});

socket.on('newQuestion', ({ questionId, text, difficulty, serverSentAt }) => {
  currentQuestion = { questionId, text, difficulty, serverSentAt };
  document.getElementById('questionText').textContent = `${text}  [${difficulty}]`;
  answerBuffer = '';
  document.getElementById('answerInput').textContent = '';
});

socket.on('questionResult', ({ questionId, results, roomState }) => {
  const log = document.getElementById('combatLog');
  results.forEach(r => {
    const line = document.createElement('div');
    if (r.socketId === socket.id) {
      line.textContent = `You: ${r.correct ? 'CORRECT' : 'WRONG'} dmg:${r.damageDealt} hp:${r.newHp} combo:${r.combo}`;
      document.getElementById('myHp').textContent = r.newHp;
      document.getElementById('myEnergy').textContent = r.newEnergy;
    } else {
      line.textContent = `${r.name}: ${r.correct ? 'CORRECT' : 'WRONG'} dmg:${r.damageDealt} hp:${r.newHp}`;
    }
    log.appendChild(line);
  });
  log.scrollTop = log.scrollHeight;
});

socket.on('matchEnd', ({ winner, summary }) => {
  alert(winner ? `${winner.name} wins!` : 'Draw!');
  // show summary
  console.log('match summary', summary);
  // reset UI
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('battle').style.display = 'none';
  currentRoom = null;
});

// keypad handlers
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('num')) {
    answerBuffer += e.target.textContent;
    document.getElementById('answerInput').textContent = answerBuffer;
  } else if (e.target.id === 'clear') {
    answerBuffer = '';
    document.getElementById('answerInput').textContent = '';
  } else if (e.target.id === 'submit') {
    if (!currentRoom || !currentQuestion) return;
    // send answer with client timestamp (for reference)
    socket.emit('submitAnswer', {
      roomId: currentRoom,
      questionId: currentQuestion.questionId,
      answer: answerBuffer,
      clientTimestamp: Date.now()
    });
    answerBuffer = '';
    document.getElementById('answerInput').textContent = '';
  }
});

register();

