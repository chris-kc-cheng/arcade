const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { cleanPoint } = require('./lib/protocol');

const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, 'public');
const colors = ['#ff6b6b', '#5c7cfa', '#20c997', '#f59f00', '#cc5de8', '#12b886'];
const users = new Map();
const history = [];
let nextUserNumber = 1;
const tankPlayers = new Map();
const bullets = [];
let nextTankNumber = 1;
const tankColors = ['#d8ff3e', '#ff7149', '#55c8ff', '#ffce45', '#db70ff', '#54e0a5'];
const tankObstacles = [
  { x: -20, z: -13, w: 15, d: 10 }, { x: 15, z: -18, w: 9, d: 18 },
  { x: -4, z: 3, w: 13, d: 13 }, { x: -25, z: 19, w: 10, d: 15 },
  { x: 23, z: 19, w: 14, d: 9 }, { x: 30, z: -4, w: 7, d: 8 }
];

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(publicDir, requested);

  if (!file.startsWith(`${publicDir}${path.sep}`)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function broadcast(message, except) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function publicUsers() {
  return [...users.values()].map(({ id, name, color, tool, drawing }) => ({ id, name, color, tool, drawing }));
}

function tankSnapshot() {
  return {
    type: 'tankState',
    players: [...tankPlayers.values()].map(({ socket, input, lastFire, ...player }) => player),
    bullets: bullets.map(({ ownerId, ...bullet }) => bullet)
  };
}

function randomSpawn() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const point = { x: Math.random() * 68 - 34, z: Math.random() * 68 - 34 };
    if (!tankObstacles.some(box => Math.abs(point.x - box.x) < box.w / 2 + 3 && Math.abs(point.z - box.z) < box.d / 2 + 3)) return point;
  }
  return { x: 34, z: 34 };
}

function tankBroadcast(message) {
  const payload = JSON.stringify(message);
  for (const player of tankPlayers.values()) if (player.socket.readyState === WebSocket.OPEN) player.socket.send(payload);
}

function addTank(socket) {
  const number = nextTankNumber++;
  const spawn = randomSpawn();
  const player = { socket, id: `tank-${number}`, name: `TANK ${String(number).padStart(2, '0')}`, color: tankColors[(number - 1) % tankColors.length], score: 0, alive: true, respawnAt: 0, heading: Math.random() * Math.PI * 2, turret: 0, ...spawn, input: { forward: 0, turn: 0, aimX: 0 }, lastFire: 0 };
  player.turret = player.heading;
  tankPlayers.set(socket, player);
  socket.isAlive = true;
  socket.send(JSON.stringify({ type: 'tankWelcome', selfId: player.id }));

  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'tankInput') {
      player.input.forward = Math.max(-1, Math.min(1, Number(message.forward) || 0));
      player.input.turn = Math.max(-1, Math.min(1, Number(message.turn) || 0));
      player.input.aimX = Math.max(-1, Math.min(1, Number(message.aimX) || 0));
    } else if (message.type === 'tankFire' && player.alive && Date.now() - player.lastFire > 650) {
      player.lastFire = Date.now();
      bullets.push({ id: `${player.id}-${player.lastFire}`, ownerId: player.id, x: player.x + Math.sin(player.turret) * 2, z: player.z + Math.cos(player.turret) * 2, vx: Math.sin(player.turret) * 22, vz: Math.cos(player.turret) * 22, life: 2.5 });
    }
  });
  socket.on('close', () => tankPlayers.delete(socket));
}

wss.on('connection', (socket, request) => {
  if (new URL(request.url, 'http://localhost').searchParams.get('room') === 'tanks') {
    addTank(socket);
    return;
  }
  const number = nextUserNumber++;
  const user = {
    id: `user-${number}`,
    name: `User ${number}`,
    color: colors[(number - 1) % colors.length],
    tool: 'pen',
    drawing: false
  };
  users.set(socket, user);
  socket.isAlive = true;
  socket.send(JSON.stringify({ type: 'welcome', self: user, users: publicUsers(), history }));
  broadcast({ type: 'presence', users: publicUsers() }, socket);

  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    if (message.type === 'stroke') {
      const from = cleanPoint(message.from);
      const to = cleanPoint(message.to);
      const size = Math.max(1, Math.min(40, Number(message.size) || 4));
      const tool = message.tool === 'eraser' ? 'eraser' : 'pen';
      if (!from || !to) return;
      const stroke = { type: 'stroke', userId: user.id, from, to, size, tool, color: user.color };
      history.push(stroke);
      if (history.length > 50000) history.splice(0, 10000);
      broadcast(stroke, socket);
    } else if (message.type === 'activity') {
      user.drawing = Boolean(message.drawing);
      user.tool = message.tool === 'eraser' ? 'eraser' : 'pen';
      broadcast({ type: 'presence', users: publicUsers() });
    } else if (message.type === 'cursor') {
      const point = cleanPoint(message.point);
      if (point) broadcast({ type: 'cursor', userId: user.id, point }, socket);
    } else if (message.type === 'clear') {
      history.length = 0;
      broadcast({ type: 'clear', by: user.name });
    }
  });

  socket.on('close', () => {
    users.delete(socket);
    broadcast({ type: 'left', userId: user.id, users: publicUsers() });
  });
});

let previousTick = Date.now();
const gameLoop = setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - previousTick) / 1000, 0.05);
  previousTick = now;
  for (const player of tankPlayers.values()) {
    if (!player.alive) {
      if (now >= player.respawnAt) Object.assign(player, randomSpawn(), { alive: true, respawnAt: 0, heading: Math.random() * Math.PI * 2 });
      continue;
    }
    player.heading += player.input.turn * dt * 2.1;
    player.turret = player.heading + player.input.aimX * 1.3;
    const next = { x: player.x + Math.sin(player.heading) * player.input.forward * dt * 9, z: player.z + Math.cos(player.heading) * player.input.forward * dt * 9 };
    const blocked = Math.abs(next.x) > 38 || Math.abs(next.z) > 38 || tankObstacles.some(box => Math.abs(next.x - box.x) < box.w / 2 + 1.25 && Math.abs(next.z - box.z) < box.d / 2 + 1.25);
    if (!blocked) Object.assign(player, next);
  }
  for (let index = bullets.length - 1; index >= 0; index--) {
    const bullet = bullets[index];
    bullet.x += bullet.vx * dt; bullet.z += bullet.vz * dt; bullet.life -= dt;
    const hitsWall = Math.abs(bullet.x) > 40 || Math.abs(bullet.z) > 40 || tankObstacles.some(box => Math.abs(bullet.x - box.x) < box.w / 2 && Math.abs(bullet.z - box.z) < box.d / 2);
    const victim = [...tankPlayers.values()].find(player => player.alive && player.id !== bullet.ownerId && Math.hypot(player.x - bullet.x, player.z - bullet.z) < 1.4);
    if (victim) {
      victim.alive = false; victim.respawnAt = now + 3000;
      const killer = [...tankPlayers.values()].find(player => player.id === bullet.ownerId);
      if (killer) killer.score++;
      tankBroadcast({ type: 'kill', killerId: bullet.ownerId, victimId: victim.id });
    }
    if (hitsWall || victim || bullet.life <= 0) bullets.splice(index, 1);
  }
  if (tankPlayers.size) tankBroadcast(tankSnapshot());
}, 50);
gameLoop.unref();

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) socket.terminate();
    else { socket.isAlive = false; socket.ping(); }
  }
}, 30000);
heartbeat.unref();

wss.on('close', () => { clearInterval(heartbeat); clearInterval(gameLoop); });

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Doodle Together is live on http://localhost:${PORT}`));
}

module.exports = { server, wss };
