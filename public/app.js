const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scoreNode = document.querySelector('#score');
const highScoreNode = document.querySelector('#highScore');
const roster = document.querySelector('#roster');
const startCard = document.querySelector('#startCard');
const pauseCard = document.querySelector('#pauseCard');
const soundButton = document.querySelector('#soundButton');
let platformSocket;

const COLS = 36;
const ROWS = 25;
const CELL = 20;
const COLORS = ['#ccff38', '#ff5b4f', '#42d6ff', '#ffca45', '#c86bff', '#ff70b7'];
const STARTS = [
  { x: 7, y: 13, dx: 1, dy: 0 }, { x: 29, y: 4, dx: -1, dy: 0 },
  { x: 29, y: 20, dx: -1, dy: 0 }, { x: 18, y: 5, dx: 0, dy: 1 },
  { x: 7, y: 21, dx: 1, dy: 0 }, { x: 18, y: 20, dx: 0, dy: -1 }
];
let snakes = [];
let food = { x: 18, y: 12 };
let running = false;
let paused = false;
let gameOver = false;
let lastTick = 0;
let accumulator = 0;
let sound = true;
let audio;
let highScore = Number(localStorage.getItem('snakePartyHigh') || 0);
let playerCount = 1;

function createSnakes() {
  return STARTS.slice(0, playerCount).map((start, index) => ({
    color: COLORS[index], direction: { x: start.dx, y: start.dy },
    nextDirection: { x: start.dx, y: start.dy }, score: 0, alive: true,
    body: Array.from({ length: index ? 4 : 5 }, (_, part) => ({ x: start.x - start.dx * part, y: start.y - start.dy * part }))
  }));
}

function reset() {
  snakes = createSnakes();
  food = openCell();
  gameOver = false;
  paused = false;
  pauseCard.hidden = true; pauseCard.classList.remove('is-paused');
  accumulator = 0;
  updateUI();
  draw();
}

function openCell() {
  const occupied = new Set(snakes.flatMap(snake => snake.body.map(point => `${point.x},${point.y}`)));
  const spaces = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (!occupied.has(`${x},${y}`)) spaces.push({ x, y });
  return spaces[Math.floor(Math.random() * spaces.length)] || { x: 18, y: 12 };
}

function start() {
  if (gameOver || !snakes.length) reset();
  running = true;
  paused = false;
  startCard.classList.add('hide');
  pauseCard.hidden = true; pauseCard.classList.remove('is-paused');
  beep(520, .05);
}

function chooseBotDirection(snake, index) {
  const options = [{ x:1,y:0 },{ x:-1,y:0 },{ x:0,y:1 },{ x:0,y:-1 }]
    .filter(dir => dir.x !== -snake.direction.x || dir.y !== -snake.direction.y)
    .map(dir => {
      const head = snake.body[0];
      const next = { x:head.x + dir.x, y:head.y + dir.y };
      let danger = next.x < 1 || next.x >= COLS - 1 || next.y < 1 || next.y >= ROWS - 1;
      if (!danger) danger = snakes.some(other => other.body.some((part, partIndex) => !(other === snake && partIndex === other.body.length - 1) && part.x === next.x && part.y === next.y));
      const distance = Math.abs(food.x - next.x) + Math.abs(food.y - next.y);
      return { dir, value: distance + (danger ? 1000 : 0) + Math.random() * (index + 3) };
    }).sort((a,b) => a.value - b.value);
  snake.nextDirection = options[0]?.dir || snake.direction;
}

function respawnBot(index) {
  const start = STARTS[index];
  const snake = snakes[index];
  snake.body = Array.from({ length:3 }, (_, part) => ({ x:start.x - start.dx * part, y:start.y - start.dy * part }));
  snake.direction = { x:start.dx, y:start.dy };
  snake.nextDirection = { ...snake.direction };
  snake.alive = true;
}

function tick() {
  snakes.forEach((snake, index) => { if (index && snake.alive) chooseBotDirection(snake, index); });
  const nextHeads = snakes.map(snake => ({ x:snake.body[0].x + snake.nextDirection.x, y:snake.body[0].y + snake.nextDirection.y }));
  snakes.forEach((snake, index) => {
    if (!snake.alive) return;
    snake.direction = snake.nextDirection;
    const next = nextHeads[index];
    const wall = next.x < 1 || next.x >= COLS - 1 || next.y < 1 || next.y >= ROWS - 1;
    const hitSnake = snakes.some(other => other.body.some((part, partIndex) => !(other === snake && partIndex === other.body.length - 1) && part.x === next.x && part.y === next.y));
    if (wall || hitSnake) {
      snake.alive = false;
      beep(100, .12);
      if (index === 0) endGame(); else setTimeout(() => { if (running) respawnBot(index); }, 900);
      return;
    }
    snake.body.unshift(next);
    if (next.x === food.x && next.y === food.y) {
      snake.score++;
      food = openCell();
      beep(index ? 330 : 720, .06);
      if (index === 0 && snake.score >= 25) endGame(true);
    } else snake.body.pop();
  });
  updateUI();
}

function endGame(won = false) {
  running = false;
  gameOver = true;
  const score = snakes[0].score;
  highScore = Math.max(score, highScore);
  localStorage.setItem('snakePartyHigh', highScore);
  document.querySelector('.insert').textContent = won ? '★ MISSION COMPLETE ★' : '★ SIGNAL LOST ★';
  document.querySelector('.start-card h2').innerHTML = won ? 'YOU RULED<br><span>THE GRID!</span>' : 'GAME<br><span>OVER!</span>';
  document.querySelector('.hint').textContent = `FINAL SCORE: ${String(score).padStart(4,'0')}`;
  document.querySelector('#startButton').innerHTML = 'PLAY AGAIN <b>▶</b>';
  startCard.classList.remove('hide');
  updateUI();
}

function updateUI() {
  const playerScore = snakes[0]?.score || 0;
  scoreNode.textContent = String(playerScore).padStart(4,'0');
  highScoreNode.textContent = String(Math.max(highScore, playerScore)).padStart(4,'0');
  document.querySelector('#missionProgress').textContent = `${playerScore}/25`;
  roster.innerHTML = `<div class="player you"><span class="player-snake" style="--player:${COLORS[0]}"><i></i><i></i><i></i></span><span><strong>${snakes.length} SNAKE${snakes.length===1?'':'S'} ACTIVE</strong><small>YOUR TAIL: ${snakes[0]?.body.length||0}</small></span><b>${String(playerScore).padStart(2,'0')}</b></div>`;
}

function drawGrid() {
  ctx.fillStyle = '#111c15'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = '#213025'; ctx.lineWidth = 1;
  for (let x=0;x<=canvas.width;x+=CELL){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke()}
  for (let y=0;y<=canvas.height;y+=CELL){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke()}
  ctx.fillStyle='#29372d';
  for(let x=0;x<COLS;x++){ctx.fillRect(x*CELL,0,CELL-1,CELL-1);ctx.fillRect(x*CELL,(ROWS-1)*CELL,CELL-1,CELL-1)}
  for(let y=1;y<ROWS-1;y++){ctx.fillRect(0,y*CELL,CELL-1,CELL-1);ctx.fillRect((COLS-1)*CELL,y*CELL,CELL-1,CELL-1)}
}

function draw() {
  drawGrid();
  const pulse = 2 + Math.sin(performance.now()/130)*2;
  ctx.save(); ctx.shadowColor='#fff36b';ctx.shadowBlur=11+pulse;ctx.fillStyle='#fff36b';ctx.fillRect(food.x*CELL+5,food.y*CELL+5,10,10);ctx.fillStyle='#fff';ctx.fillRect(food.x*CELL+7,food.y*CELL+7,3,3);ctx.restore();
  snakes.forEach(snake => snake.body.forEach((part,index) => {
    ctx.save();ctx.fillStyle=snake.alive?snake.color:'#48534c';ctx.shadowColor=snake.color;ctx.shadowBlur=index===0?9:0;
    const inset=index===0?2:3;ctx.fillRect(part.x*CELL+inset,part.y*CELL+inset,CELL-inset*2-1,CELL-inset*2-1);
    if(index===0){ctx.fillStyle='#0b100d';const horizontal=snake.direction.x!==0;const ex=part.x*CELL+(snake.direction.x>0?13:snake.direction.x<0?5:6);const ey=part.y*CELL+(snake.direction.y>0?13:snake.direction.y<0?5:6);ctx.fillRect(ex,ey,3,3);if(horizontal)ctx.fillRect(ex,ey+6,3,3);else ctx.fillRect(ex+6,ey,3,3)}ctx.restore();
  }));
}

function loop(now) {
  const elapsed = Math.min(now-lastTick,100); lastTick=now;
  if(running&&!paused){accumulator+=elapsed;while(accumulator>=115){tick();accumulator-=115}}
  draw();requestAnimationFrame(loop);
}

function beep(frequency,duration){
  if(!sound)return;audio ||= new (window.AudioContext||window.webkitAudioContext)();const oscillator=audio.createOscillator();const gain=audio.createGain();oscillator.type='square';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(.035,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);oscillator.connect(gain).connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+duration);
}

function steer(x,y){const snake=snakes[0];if(!snake||!snake.alive)return;if(x!==-snake.direction.x||y!==-snake.direction.y)snake.nextDirection={x,y}}
function togglePause(){if(!running||gameOver){start();return}paused=!paused;pauseCard.hidden=!paused;pauseCard.classList.toggle('is-paused',paused);beep(paused?180:520,.04)}
window.addEventListener('keydown',event=>{const key=event.key.toLowerCase(),pauseKey=event.code==='KeyP'||key==='p';if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' ','enter'].includes(key)||pauseKey)event.preventDefault();if(pauseKey){togglePause();return}if(key==='enter'&&!running)start();if(key==='arrowup'||key==='w')steer(0,-1);if(key==='arrowdown'||key==='s')steer(0,1);if(key==='arrowleft'||key==='a')steer(-1,0);if(key==='arrowright'||key==='d')steer(1,0);if(key==='r'){reset();start()}},{capture:true});
document.querySelector('#startButton').addEventListener('click',start);
soundButton.addEventListener('click',()=>{sound=!sound;soundButton.setAttribute('aria-pressed',sound);soundButton.innerHTML=`<span>${sound?'♪':'×'}</span> SOUND: ${sound?'ON':'OFF'}`;if(sound)beep(440,.05)});
reset();highScoreNode.textContent=String(highScore).padStart(4,'0');requestAnimationFrame(loop);

function connectPlatform(){
  const protocol=location.protocol==='https:'?'wss':'ws';
  platformSocket=new WebSocket(`${protocol}://${location.host}?room=snake`);
  platformSocket.onmessage=event=>{const message=JSON.parse(event.data);if(message.type==='switchGame'&&message.path!==location.pathname)location.assign(message.path);if(message.type==='snakePresence'){const count=Math.max(1,Math.min(STARTS.length,Number(message.count)||1));if(count!==playerCount){playerCount=count;reset();}}};
  platformSocket.onclose=()=>setTimeout(connectPlatform,1200);
}
document.querySelector('.screen-title').textContent='SNAKE';
document.querySelectorAll('.snake-bar nav a').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();if(confirm(`Switch everyone to ${link.title}?`))platformSocket?.send(JSON.stringify({type:'switchGame',path:link.getAttribute('href')}));}));
connectPlatform();
