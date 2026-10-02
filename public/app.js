function sessionClient(){if(typeof sessionStorage==='undefined')return'test-client';let id=sessionStorage.getItem('arcade-client');if(!id){id=crypto.randomUUID();sessionStorage.setItem('arcade-client',id)}return id}
const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scoreNode = document.querySelector('#score');
const highScoreNode = document.querySelector('#highScore');
const roster = document.querySelector('#roster');
const startCard = document.querySelector('#startCard');
const pauseCard = document.querySelector('#pauseCard');
const soundButton = document.querySelector('#soundButton');
const resetButton = document.querySelector('#resetButton');
const startButton = document.querySelector('#startButton');
const insertNode = document.querySelector('.insert');
const titleNode = document.querySelector('.start-card h2');
const hintNode = document.querySelector('.hint');
const COLS = 36;
const ROWS = 25;
const CELL = 20;
let platformSocket;
let selfId = '';
let players = [];
let food = { x: 18, y: 12 };
let running = false;
let paused = false;
let sound = true;
let audio;
let highScore = Number(localStorage.getItem('snakePartyHigh') || 0);

function me() { return players.find(player => player.id === selfId); }
function send(message) {
  if (platformSocket?.readyState === WebSocket.OPEN) platformSocket.send(JSON.stringify(message));
}
function start() { send({ type: 'snakeStart' }); beep(520, .05); }
function reset() { send({ type: 'snakeReset' }); beep(440, .05); }
function steer(x, y) { if (me()?.alive) send({ type: 'snakeInput', x, y }); }
function togglePause() { if (running) send({ type: 'snakeTogglePause' }); else start(); }

function updateUI() {
  const player = me();
  const playerScore = player?.score || 0;
  if (playerScore > highScore) {
    highScore = playerScore;
    localStorage.setItem('snakePartyHigh', highScore);
  }
  scoreNode.textContent = String(playerScore).padStart(4, '0');
  highScoreNode.textContent = String(highScore).padStart(4, '0');
  document.querySelector('#missionProgress').textContent = `${playerScore}/25`;
  roster.replaceChildren(...players.map(item => {
    const row = document.createElement('div');
    row.className = `player${item.id === selfId ? ' you' : ''}`;
    const snake = document.createElement('span');
    snake.className = 'player-snake';
    snake.style.setProperty('--player', item.alive ? item.color : '#66706a');
    snake.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    const details = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = `${item.name}${item.id === selfId ? ' (YOU)' : ''}`;
    const tail = document.createElement('small');
    tail.textContent = item.alive ? `TAIL: ${item.body.length}` : 'CRASHED';
    details.append(name, tail);
    const points = document.createElement('b');
    points.textContent = String(item.score).padStart(2, '0');
    row.append(snake, details, points);
    return row;
  }));
  pauseCard.hidden = !paused;
  pauseCard.classList.toggle('is-paused', paused);
  const waiting = !running;
  const crashed = running && player && !player.alive;
  startCard.classList.toggle('hide', !waiting && !crashed);
  if (crashed) {
    insertNode.textContent = '★ SIGNAL LOST ★';
    titleNode.innerHTML = 'YOU<br><span>CRASHED!</span>';
    hintNode.textContent = 'RESET THE SHARED MATCH TO PLAY AGAIN.';
    startButton.textContent = 'RESET MATCH ▶';
  } else if (waiting) {
    insertNode.textContent = `★ ${players.length} PLAYER${players.length === 1 ? '' : 'S'} CONNECTED ★`;
    titleNode.innerHTML = 'CHASE THE<br><span>GLOW-BIT!</span>';
    hintNode.textContent = players.length > 1 ? 'EVERY SNAKE IS A REAL PLAYER.' : 'WAIT FOR FRIENDS OR START SOLO.';
    startButton.textContent = 'START MATCH ▶';
  }
}

function drawGrid() {
  ctx.fillStyle = '#111c15'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#213025'; ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += CELL) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 0; y <= canvas.height; y += CELL) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  ctx.fillStyle = '#29372d';
  for (let x = 0; x < COLS; x++) { ctx.fillRect(x * CELL, 0, CELL - 1, CELL - 1); ctx.fillRect(x * CELL, (ROWS - 1) * CELL, CELL - 1, CELL - 1); }
  for (let y = 1; y < ROWS - 1; y++) { ctx.fillRect(0, y * CELL, CELL - 1, CELL - 1); ctx.fillRect((COLS - 1) * CELL, y * CELL, CELL - 1, CELL - 1); }
}

function draw() {
  drawGrid();
  const pulse = 2 + Math.sin(performance.now() / 130) * 2;
  ctx.save(); ctx.shadowColor = '#fff36b'; ctx.shadowBlur = 11 + pulse; ctx.fillStyle = '#fff36b';
  ctx.fillRect(food.x * CELL + 5, food.y * CELL + 5, 10, 10); ctx.fillStyle = '#fff'; ctx.fillRect(food.x * CELL + 7, food.y * CELL + 7, 3, 3); ctx.restore();
  for (const player of players) for (const [index, part] of player.body.entries()) {
    ctx.save(); ctx.fillStyle = player.alive ? player.color : '#48534c'; ctx.shadowColor = player.color; ctx.shadowBlur = index === 0 ? 9 : 0;
    const inset = index === 0 ? 2 : 3; ctx.fillRect(part.x * CELL + inset, part.y * CELL + inset, CELL - inset * 2 - 1, CELL - inset * 2 - 1);
    if (index === 0) {
      ctx.fillStyle = '#0b100d'; const horizontal = player.direction.x !== 0;
      const ex = part.x * CELL + (player.direction.x > 0 ? 13 : player.direction.x < 0 ? 5 : 6);
      const ey = part.y * CELL + (player.direction.y > 0 ? 13 : player.direction.y < 0 ? 5 : 6);
      ctx.fillRect(ex, ey, 3, 3); if (horizontal) ctx.fillRect(ex, ey + 6, 3, 3); else ctx.fillRect(ex + 6, ey, 3, 3);
    }
    ctx.restore();
  }
}

function loop() { draw(); requestAnimationFrame(loop); }
function beep(frequency, duration) {
  if (!sound) return;
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audio.createOscillator(); const gain = audio.createGain(); oscillator.type = 'square'; oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + duration);
}

window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'p', 'r', ' ', 'enter'].includes(key)) event.preventDefault();
  if (key === 'p') togglePause();
  else if (key === 'enter' && !running) start();
  else if (key === 'r') reset();
  else if (key === 'arrowup' || key === 'w') steer(0, -1);
  else if (key === 'arrowdown' || key === 's') steer(0, 1);
  else if (key === 'arrowleft' || key === 'a') steer(-1, 0);
  else if (key === 'arrowright' || key === 'd') steer(1, 0);
}, { capture: true });
startButton.addEventListener('click', () => running ? reset() : start());
resetButton.addEventListener('click', reset);
soundButton.addEventListener('click', () => {
  sound = !sound; soundButton.setAttribute('aria-pressed', sound);
  soundButton.innerHTML = `<span>${sound ? '♪' : '×'}</span> SOUND: ${sound ? 'ON' : 'OFF'}`;
  if (sound) beep(440, .05);
});

function connectPlatform() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  platformSocket = new WebSocket(`${protocol}://${location.host}?room=snake&client=${encodeURIComponent(sessionClient())}`);
  platformSocket.onopen = () => { const name = sessionStorage.getItem('arcade-name'); if (name) send({ type: 'setName', name }); };
  platformSocket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'platformPresence') { renderArcadePresence(message.players); return; }
    if (message.type === 'switchGame' && message.path !== location.pathname) location.assign(message.path);
    if (message.type === 'snakeWelcome') selfId = message.selfId;
    if (message.type === 'snakeState') {
      players = message.players; food = message.food; running = message.running; paused = message.paused;
      updateUI();
    }
  };
  platformSocket.onclose = () => setTimeout(connectPlatform, 1200);
}

document.querySelector('.screen-title').textContent = 'SNAKE';
document.querySelectorAll('.snake-bar nav a').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (confirm(`Switch everyone to ${link.title}?`)) send({ type: 'switchGame', path: link.getAttribute('href') });
}));
updateUI(); requestAnimationFrame(loop); connectPlatform();
