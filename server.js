const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const { cleanPoint, cleanFighterInput } = require('./lib/protocol');

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
const fighters = new Map();
let fighterOrder = [];
let nextFighterNumber = 1;
let fighterRound = 1;
let fighterRoundEndsAt = 0;
let fighterNotice = '';

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

function fighterPublic(player) {
  const { socket, input, attackHeld, ...visible } = player;
  return visible;
}

function fighterRoles() {
  const active = fighterOrder.slice(0, 2);
  for (const [id, player] of fighters) {
    const position = active.indexOf(id);
    player.role = position < 0 ? 'spectator' : `player${position + 1}`;
  }
}

function resetFighterRound(notice = '') {
  fighterRoles();
  fighterRoundEndsAt = 0;
  fighterNotice = notice;
  const active = fighterOrder.slice(0, 2);
  active.forEach((id, index) => {
    const player = fighters.get(id);
    if (player) Object.assign(player, { x: index ? 72 : 28, y: 0, vx: 0, vy: 0, energy: 100, facing: index ? -1 : 1, attack: '', attackUntil: 0, hitUntil: 0, combo: '', cpuEnergy: 100, cpuAttack: '', cpuAttackUntil: 0, cpuHitUntil: 0, cpuCombo: '' });
  });
}

function fighterSnapshot(now = Date.now()) {
  const active = fighterOrder.slice(0, 2).map(id => fighters.get(id)).filter(Boolean);
  const players = active.map(fighterPublic);
  if (players.length === 1) players.push({ id: 'cpu', name: 'CPU KEN', role: 'computer', color: '#d9483b', x: 72, y: 0, energy: active[0].cpuEnergy ?? 100, facing: -1, attack: active[0].cpuAttack || '', attackUntil: active[0].cpuAttackUntil || 0, hitUntil: active[0].cpuHitUntil || 0, combo: active[0].cpuCombo || '' });
  return { type: 'fighterState', selfCount: fighters.size, round: fighterRound, players, queue: fighterOrder.slice(2).map((id, i) => ({ ...fighterPublic(fighters.get(id)), queuePosition: i + 1 })), roundEndsAt: fighterRoundEndsAt, notice: fighterNotice, serverTime: now };
}

function fighterBroadcast(message = fighterSnapshot()) {
  const payload = JSON.stringify(message);
  for (const player of fighters.values()) if (player.socket.readyState === WebSocket.OPEN) player.socket.send(payload);
}

function addFighter(socket) {
  const number = nextFighterNumber++;
  const id = `fighter-${number}`;
  const player = { socket, id, name: `FIGHTER ${String(number).padStart(2, '0')}`, color: number % 2 ? '#f4f0e6' : '#d9483b', role: 'spectator', x: 28, y: 0, vx: 0, vy: 0, facing: 1, energy: 100, attack: '', attackUntil: 0, hitUntil: 0, combo: '', input: cleanFighterInput({}), attackHeld: false, cpuEnergy: 100 };
  fighters.set(id, player); fighterOrder.push(id);
  if (fighterOrder.length <= 2) resetFighterRound(fighterOrder.length === 2 ? 'A NEW CHALLENGER!' : 'CPU CHALLENGER'); else fighterRoles();
  socket.isAlive = true;
  socket.send(JSON.stringify({ type: 'fighterWelcome', selfId: id }));
  fighterBroadcast();
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'fighterInput') player.input = cleanFighterInput(message);
    if (message.type === 'fighterReset' && player.role !== 'spectator') { fighterRound++; resetFighterRound(`${player.name} RESET THE ROUND`); fighterBroadcast(); }
  });
  socket.on('close', () => {
    const wasActive = fighterOrder.indexOf(id) < 2;
    fighters.delete(id); fighterOrder = fighterOrder.filter(item => item !== id);
    if (wasActive) { fighterRound++; resetFighterRound('MATCH LINEUP UPDATED'); }
    else fighterRoles();
    fighterBroadcast();
  });
}

wss.on('connection', (socket, request) => {
  const room = new URL(request.url, 'http://localhost').searchParams.get('room');
  if (room === 'tanks') {
    addTank(socket);
    return;
  }
  if (room === 'fighter') { addFighter(socket); return; }
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

function beginFighterAttack(attacker, type, now) {
  const data = type === 'punch' ? { duration: 230, reach: 11, damage: 7 } : { duration: 360, reach: 15, damage: 11 };
  attacker.attack = type; attacker.attackUntil = now + data.duration; attacker.attackHeld = true;
  return data;
}

function runFighter(attacker, defender, dt, now, computer = false) {
  if (!attacker || !defender || attacker.energy <= 0 || now < attacker.hitUntil) return;
  let input = attacker.input;
  if (computer) {
    const distance = defender.x - attacker.x;
    input = { left: distance < -9, right: distance > 9, down: false, jump: Math.random() < .008, punch: Math.abs(distance) < 12 && Math.random() < .07, kick: Math.abs(distance) < 16 && Math.random() < .035 };
  }
  attacker.facing = defender.x >= attacker.x ? 1 : -1;
  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  attacker.vx = move * (input.down ? 0 : 22);
  if (input.jump && attacker.y === 0) attacker.vy = 38;
  attacker.vy -= 90 * dt; attacker.y = Math.max(0, attacker.y + attacker.vy * dt); if (attacker.y === 0) attacker.vy = 0;
  attacker.x = Math.max(5, Math.min(95, attacker.x + attacker.vx * dt));
  const pressed = input.punch || input.kick;
  if (!pressed) attacker.attackHeld = false;
  if (pressed && !attacker.attackHeld && now >= attacker.attackUntil) {
    const kind = input.punch ? 'punch' : 'kick';
    const attack = beginFighterAttack(attacker, kind, now);
    if (Math.abs(defender.x - attacker.x) <= attack.reach && Math.abs(defender.y - attacker.y) < 14 && now >= defender.hitUntil) {
      defender.energy = Math.max(0, defender.energy - attack.damage); defender.hitUntil = now + 260; defender.x = Math.max(5, Math.min(95, defender.x + attacker.facing * 4));
      attacker.combo = kind === 'punch' ? 'HADOUKEN' : (attacker.y > 5 ? 'SHORYUKEN' : 'TATSUMAKI SENPUU KYAKU');
      attacker.comboUntil = now + 900;
    }
  }
  if (now > (attacker.comboUntil || 0)) attacker.combo = '';
}

let previousFighterTick = Date.now();
const fighterLoop = setInterval(() => {
  if (!fighters.size) return;
  const now = Date.now(), dt = Math.min((now - previousFighterTick) / 1000, .05); previousFighterTick = now;
  const active = fighterOrder.slice(0, 2).map(id => fighters.get(id)).filter(Boolean);
  if (!fighterRoundEndsAt && active.length) {
    if (active.length === 1) {
      const human = active[0];
      const cpu = { x: 72, y: 0, vx: 0, vy: 0, facing: -1, energy: human.cpuEnergy ?? 100, attack: human.cpuAttack || '', attackUntil: human.cpuAttackUntil || 0, hitUntil: human.cpuHitUntil || 0, combo: human.cpuCombo || '', comboUntil: human.cpuComboUntil || 0, attackHeld: human.cpuAttackHeld || false };
      runFighter(human, cpu, dt, now); runFighter(cpu, human, dt, now, true);
      Object.assign(human, { cpuEnergy: cpu.energy, cpuAttack: cpu.attack, cpuAttackUntil: cpu.attackUntil, cpuHitUntil: cpu.hitUntil, cpuCombo: cpu.combo, cpuComboUntil: cpu.comboUntil, cpuAttackHeld: cpu.attackHeld });
      if (human.energy <= 0 || cpu.energy <= 0) { fighterNotice = human.energy > 0 ? `${human.name} WINS` : 'CPU KEN WINS'; fighterRoundEndsAt = now + 3000; }
    } else {
      runFighter(active[0], active[1], dt, now); runFighter(active[1], active[0], dt, now);
      const winner = active.find(player => player.energy > 0);
      if (active.some(player => player.energy <= 0)) { fighterNotice = `${winner?.name || 'DRAW'} WINS`; fighterRoundEndsAt = now + 3000; }
    }
  } else if (fighterRoundEndsAt && now >= fighterRoundEndsAt) {
    fighterRound++;
    if (fighterOrder.length > 2) fighterOrder.push(...fighterOrder.splice(0, 2));
    resetFighterRound('FIGHT!');
  }
  fighterBroadcast(fighterSnapshot(now));
}, 50);
fighterLoop.unref();

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

wss.on('close', () => { clearInterval(heartbeat); clearInterval(gameLoop); clearInterval(fighterLoop); });

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Doodle Together is live on http://localhost:${PORT}`));
}

module.exports = { server, wss };
