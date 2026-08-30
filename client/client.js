const socket = io();

socket.emit('register', {
  name: 'Player_' + Math.floor(Math.random() * 1000),
  class: 'MAGE'
});

socket.on('onlinePlayers', players => {
  const ul = document.getElementById('players');
  ul.innerHTML = '';
  players.forEach(p => {
    if (p.id === socket.id) return;
    const li = document.createElement('li');
    li.textContent = `${p.name} (${p.class})`;
    const btn = document.createElement('button');
    btn.textContent = 'Challenge';
    btn.onclick = () => socket.emit('challenge', p.id);
    li.appendChild(btn);
    ul.appendChild(li);
  });
});

socket.on('challengeRequest', from => {
  if (confirm(`${from.name} challenges you!`)) {
    socket.emit('acceptChallenge', from.id);
  }
});

socket.on('matchFound', data => {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('battle').style.display = 'block';
});

socket.on('newQuestion', q => {
  document.getElementById('question').textContent = q.text;
});

document.getElementById('submit').onclick = () => {
  const answer = document.getElementById('answer').value;
  socket.emit('submitAnswer', {
    roomId: null,
    answer
  });
};

socket.on('roundResult', result => {
  const log = document.getElementById('log');
  log.innerHTML += `<div>Correct: ${result.correct}, Damage: ${result.damage}</div>`;
});

socket.on('matchEnd', data => {
  alert(`Winner: ${data.winner.name}`);
});
