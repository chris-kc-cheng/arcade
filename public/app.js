const canvas = document.querySelector('#board');
const context = canvas.getContext('2d');
const people = document.querySelector('#people');
const count = document.querySelector('#peopleCount');
const cursors = document.querySelector('#cursors');
const connection = document.querySelector('.connection');
const connectionText = document.querySelector('#connectionText');
const sizeInput = document.querySelector('#size');
const toast = document.querySelector('#toast');

let socket;
let self;
let userList = [];
let strokes = [];
let drawing = false;
let previousPoint;
let tool = 'pen';
let reconnectTimer;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  redraw();
}

function drawStroke(stroke) {
  const rect = canvas.getBoundingClientRect();
  context.beginPath();
  context.moveTo(stroke.from.x * rect.width, stroke.from.y * rect.height);
  context.lineTo(stroke.to.x * rect.width, stroke.to.y * rect.height);
  context.lineWidth = stroke.size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = stroke.color;
  context.stroke();
  context.globalCompositeOperation = 'source-over';
}

function redraw() { context.clearRect(0, 0, canvas.width, canvas.height); strokes.forEach(drawStroke); }
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}

function startDrawing(event) {
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  previousPoint = pointFromEvent(event);
  send({ type: 'activity', drawing: true, tool });
}
function move(event) {
  const point = pointFromEvent(event);
  send({ type: 'cursor', point });
  if (!drawing) return;
  const stroke = { type:'stroke', userId:self?.id, from:previousPoint, to:point, size:Number(sizeInput.value), tool, color:self?.color || '#222' };
  strokes.push(stroke); drawStroke(stroke); send(stroke); previousPoint = point;
}
function stopDrawing() { if (!drawing) return; drawing = false; send({ type:'activity', drawing:false, tool }); }

function renderPeople() {
  count.textContent = userList.length;
  people.innerHTML = userList.map(user => `<div class="person ${user.id === self?.id ? 'me' : ''}">
    <span class="avatar" style="background:${user.color}">${user.name.replace('User ', '')}</span>
    <span><strong>${user.name}${user.id === self?.id ? ' (you)' : ''}</strong><small class="${user.drawing ? 'drawing' : ''}">${user.drawing ? `Drawing with ${user.tool}` : 'Watching the canvas'}</small></span>
  </div>`).join('');
}

function updateCursor(message) {
  const user = userList.find(item => item.id === message.userId);
  if (!user) return;
  let cursor = document.getElementById(`cursor-${user.id}`);
  if (!cursor) {
    cursor = document.createElement('div'); cursor.id = `cursor-${user.id}`; cursor.className = 'remote-cursor';
    cursor.style.setProperty('--cursor', user.color); cursor.innerHTML = `<span>${user.name}</span>`; cursors.append(cursor);
  }
  cursor.style.left = `${message.point.x * 100}%`; cursor.style.top = `${message.point.y * 100}%`;
}

function showToast(text) { toast.textContent = text; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2200); }

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}`);
  socket.addEventListener('open', () => { connection.classList.add('online'); connectionText.textContent = 'Live & connected'; });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'welcome') { self = message.self; userList = message.users; strokes = message.history; redraw(); renderPeople(); }
    if (message.type === 'stroke') { strokes.push(message); drawStroke(message); }
    if (message.type === 'presence' || message.type === 'left') { userList = message.users; renderPeople(); if (message.userId) document.querySelector(`#cursor-${message.userId}`)?.remove(); }
    if (message.type === 'cursor') updateCursor(message);
    if (message.type === 'clear') { strokes = []; redraw(); showToast(`${message.by} cleared the board`); }
  });
  socket.addEventListener('close', () => { connection.classList.remove('online'); connectionText.textContent = 'Reconnecting…'; clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1500); });
}

document.querySelectorAll('.tool').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.tool.active').classList.remove('active'); button.classList.add('active'); tool = button.dataset.tool;
  send({ type:'activity', drawing:false, tool });
}));
document.querySelector('#clearButton').addEventListener('click', () => { if (confirm('Clear the board for everyone?')) { strokes=[]; redraw(); send({type:'clear'}); } });
canvas.addEventListener('pointerdown', startDrawing); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', stopDrawing); canvas.addEventListener('pointercancel', stopDrawing);
window.addEventListener('resize', resizeCanvas); new ResizeObserver(resizeCanvas).observe(canvas); connect();
