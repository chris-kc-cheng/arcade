const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { cleanPoint, cleanFighterInput, cleanBigTwoAction, cleanTypingAction, cleanWordleAction, cleanPollAction } = require('./lib/protocol');
const { randomParagraph, typingStats } = require('./lib/typing');
const { cardValue, classify, beats, deck: bigTwoDeck } = require('./lib/bigtwo');
const { SNAKE_COLS, SNAKE_ROWS, snakeBodyAt, chooseSnakeSpawn, cleanSnakeAction } = require('./lib/snake');
const { TANK_MAP_HALF_SIZE, createTankObstacles } = require('./lib/tank');
const { words: wordleWords, scoreGuess, randomWord } = require('./lib/wordle');

const PORT = Number(process.env.PORT) || 3000;
const DISCONNECT_GRACE_MS = Math.max(0, Number(process.env.DISCONNECT_GRACE_MS) || 10000);
const developmentMode = process.argv.includes('--dev');
const publicDir = path.join(__dirname, 'public');
const reloadClients = new Set();
const colors = ['#ff6b6b', '#5c7cfa', '#20c997', '#f59f00', '#cc5de8', '#12b886'];
const users = new Map();
const platformProfiles = new Map();
const history = [];
const chatHistory = [];
let nextUserNumber = 1;
const tankPlayers = new Map();
const bullets = [];
let nextTankNumber = 1;
const tankColors = ['#d8ff3e', '#ff7149', '#55c8ff', '#ffce45', '#db70ff', '#54e0a5'];
// Keep the whole tank, including its short cannon, clear of solid geometry.
const tankRadius = 0.9;
// The arena is generated once for this server-side match and remains authoritative.
const tankObstacles = createTankObstacles();
const penaltyClients = new Map();
const penaltyPlayers = [];
const penaltyColors = ['#ed4f45', '#3b71e8'];
const penaltyZones = new Set(['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right']);
let nextPenaltyNumber = 1;
let penaltyStartingKicker = 0;
let penaltyGame = createPenaltyGame();

function createPenaltyGame() {
  return { phase: 'waiting', kicker: penaltyStartingKicker, kicks: [[], []], choices: {}, result: null, winner: null, message: 'Waiting for two players' };
}
const fighters = new Map();
let fighterOrder = [];
let nextFighterNumber = 1;
let fighterRound = 1;
let fighterRoundEndsAt = 0;
let fighterNotice = '';
const bigTwoPlayers = new Map();
let bigTwoOrder = [], nextBigTwoNumber = 1, bigTwoRound = 0;
let bigTwoGame = { status: 'waiting', turn: '', trick: null, passes: [], openingCard: '', notice: 'Waiting for players' };
const bigTwoCpus = Array.from({ length: 3 }, (_, index) => ({ id: `cpu-${index + 1}`, name: `CPU ${index + 1}`, computer: true, hand: [], score: 0 }));
let bigTwoCpuTimer;
const snakeClients = new Map();
let nextSnakeNumber = 1;
let snakeFood = { x: 18, y: 12 };
let snakeRunning = false;
let snakePaused = false;
const snakeColors = ['#ccff38', '#ff5b4f', '#42d6ff', '#ffca45', '#c86bff', '#ff70b7'];
const fighterEffects = [];
const typingPlayers = new Map();
let typingOrder = [], nextTypingNumber = 1, typingTimer;
let typingGame = { phase: 'waiting', mode: 'versus', difficulty: 'easy', paragraph: randomParagraph('easy'), countdownEndsAt: 0, startedAt: 0 };
const wordleGames = new Map();
const polls = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (developmentMode && pathname === '/__dev_reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }
  const legacyPath = legacyPaths.get(pathname);
  if (legacyPath) {
    res.writeHead(308, { Location: legacyPath }).end();
    return;
  }
  const requested = routeFiles.get(pathname) || pathname.slice(1);
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
    if (developmentMode && requested === 'index.html') {
      const reloadScript = `<script>(()=>{let opened=false;const source=new EventSource('/__dev_reload');source.onopen=()=>{opened=true};source.onmessage=()=>location.reload();source.onerror=()=>{if(opened)setTimeout(()=>location.reload(),500)};})();</script>`;
      data = Buffer.from(data.toString().replace('</body>', `${reloadScript}</body>`));
    }
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

if (developmentMode) {
  fs.watch(publicDir, (event, filename) => {
    if (filename !== 'react-app.js') return;
    for (const response of reloadClients) response.write('data: reload\n\n');
  });
}

const wss = new WebSocketServer({ server });

function broadcast(message, except) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

const gamePaths = new Set(['/', '/tank', '/penalty', '/fighter', '/snake', '/bigtwo', '/typing', '/wordle', '/poll']);
const routeFiles = new Map([['/', 'index.html'], ['/tank', 'index.html'], ['/penalty', 'index.html'], ['/fighter', 'fighter.html'], ['/snake', 'snake.html'], ['/bigtwo', 'bigtwo.html'], ['/typing', 'typing.html'], ['/wordle', 'wordle.html'], ['/poll', 'poll.html']]);
const legacyPaths = new Map([['/index.html', '/'], ['/tank.html', '/tank'], ['/penalty.html', '/penalty'], ['/fighter.html', '/fighter'], ['/snake.html', '/snake'], ['/bigtwo.html', '/bigtwo'], ['/typing.html', '/typing'], ['/wordle.html', '/wordle'], ['/poll.html', '/poll']]);
let currentGamePath = '/';
function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
}

function requestIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function nextAvailableUserName() {
  const used = new Set([...platformProfiles.values()].map(profile => profile.name));
  let number = 1;
  while (used.has(`User ${number}`)) number++;
  return `User ${number}`;
}

function platformPresence() {
  return [...platformProfiles.values()].filter(profile => profile.sockets.size).map(({ key, name, ip, connectedAt, room }) => ({ id: key, name, ip, connectedAt, room }));
}

function broadcastPlatformPresence() {
  broadcast({ type: 'platformPresence', players: platformPresence() });
}

function registerPlatformSocket(socket, request, key, room) {
  let profile = platformProfiles.get(key);
  if (!profile) {
    profile = { key, name: nextAvailableUserName(), customName: false, ip: requestIp(request), connectedAt: Date.now(), room, sockets: new Set(), removeTimer: null };
    platformProfiles.set(key, profile);
  }
  clearTimeout(profile.removeTimer);
  profile.removeTimer = null;
  profile.room = room;
  profile.sockets.add(socket);
  socket.platformProfile = profile;
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== 'setName' || profile.customName) return;
    const name = cleanName(message.name);
    if (!name) return;
    profile.name = name;
    profile.customName = true;
    broadcastPlatformPresence();
  });
  socket.on('close', () => {
    profile.sockets.delete(socket);
    broadcastPlatformPresence();
    if (!profile.sockets.size) {
      profile.removeTimer = setTimeout(() => platformProfiles.delete(key), DISCONNECT_GRACE_MS);
      profile.removeTimer.unref?.();
    }
  });
  queueMicrotask(broadcastPlatformPresence);
  return profile;
}

function profileName(socket) { return socket.platformProfile?.name; }
function resetTankState() {
  bullets.length = 0;
  for (const player of tankPlayers.values()) {
    Object.assign(player, randomSpawn(), { score: 0, alive: true, respawnAt: 0, heading: Math.random() * Math.PI * 2, input: { forward: 0, turn: 0, aimX: 0 } });
    player.turret = player.heading;
  }
  tankBroadcast(tankSnapshot());
}
function resetPenaltyState(swapRoles = false) {
  if (swapRoles) penaltyStartingKicker = 1 - penaltyStartingKicker;
  penaltyGame = createPenaltyGame();
  if (penaltyPlayers.length === 2) {
    penaltyGame.phase = 'choosing';
    penaltyGame.message = 'Both players choose a zone';
  }
  penaltyBroadcast();
}
function resetArcadeState() {
  history.length = 0;
  resetTankState();
  resetPenaltyState();
  fighterRound++;
  resetFighterRound('ARCADE RESET');
  if (fighters.size) fighterBroadcast();
  if (typingPlayers.size) resetTypingGame();
  broadcast({ type: 'clear', by: 'Game switch' });
}
function attachPlatformMessages(socket) {
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'switchGame' && gamePaths.has(message.path)) {
      currentGamePath = message.path;
      resetArcadeState();
      broadcast({ type: 'switchGame', path: message.path });
    }
  });
}

function publicUsers() {
  return [...users.values()].filter(user => user.socket?.readyState === WebSocket.OPEN).map(publicUser);
}

function publicUser({ id, name, color, tool, drawing }) { return { id, name, color, tool, drawing }; }

function tankSnapshot() {
  return {
    type: 'tankState',
    obstacles: tankObstacles,
    players: [...tankPlayers.values()].map(({ socket, input, lastFire, key, removeTimer, ...player }) => player),
    bullets: bullets.map(({ ownerId, ...bullet }) => bullet)
  };
}

function clientKey(request) {
  const value = new URL(request.url, 'http://localhost').searchParams.get('client');
  return value && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : crypto.randomUUID();
}

function uniqueClientKey(records, key) {
  return records.get(key)?.socket?.readyState === WebSocket.OPEN ? crypto.randomUUID() : key;
}

function scheduleRemoval(record, remove) {
  clearTimeout(record.removeTimer);
  record.removeTimer = setTimeout(() => {
    record.removeTimer = null;
    remove(record);
  }, DISCONNECT_GRACE_MS);
  record.removeTimer.unref?.();
}

function randomSpawn() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const point = { x: Math.random() * 228 - 114, z: Math.random() * 228 - 114 };
    if (!tankObstacles.some(box => Math.abs(point.x - box.x) < box.w / 2 + 3 && Math.abs(point.z - box.z) < box.d / 2 + 3)) return point;
  }
  return { x: 114, z: 114 };
}

function segmentHitsBox(x1, z1, x2, z2, box, padding = 0) {
  const minX = box.x - box.w / 2 - padding, maxX = box.x + box.w / 2 + padding;
  const minZ = box.z - box.d / 2 - padding, maxZ = box.z + box.d / 2 + padding;
  const dx = x2 - x1, dz = z2 - z1;
  let enter = 0, exit = 1;
  for (const [start, delta, min, max] of [[x1, dx, minX, maxX], [z1, dz, minZ, maxZ]]) {
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return false; continue; }
    const a = (min - start) / delta, b = (max - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

function segmentDistance(x1, z1, x2, z2, x, z) {
  const dx = x2 - x1, dz = z2 - z1, lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / lengthSquared)) : 0;
  return Math.hypot(x - (x1 + dx * amount), z - (z1 + dz * amount));
}

function tankBroadcast(message) {
  const payload = JSON.stringify(message);
  for (const player of tankPlayers.values()) if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(payload);
}

function addTank(socket, requestedKey) {
  const key = uniqueClientKey(tankPlayers, requestedKey);
  const returning = tankPlayers.get(key);
  if (returning) {
    clearTimeout(returning.removeTimer);
    returning.removeTimer = null;
    returning.socket = socket;
    returning.input = { forward: 0, turn: 0, aimX: 0 };
    socket.isAlive = true;
    socket.send(JSON.stringify({ type: 'tankWelcome', selfId: returning.id, clientId: key }));
    socket.on('pong', () => { socket.isAlive = true; });
    attachTankMessages(socket, returning, key);
    return;
  }
  const number = nextTankNumber++;
  const spawn = randomSpawn();
  const player = { socket, key, id: `tank-${number}`, name: profileName(socket) || `TANK ${String(number).padStart(2, '0')}`, color: tankColors[(number - 1) % tankColors.length], score: 0, alive: true, respawnAt: 0, heading: Math.random() * Math.PI * 2, turret: 0, ...spawn, input: { forward: 0, turn: 0, aimX: 0 }, lastFire: 0 };
  player.turret = player.heading;
  tankPlayers.set(key, player);
  socket.isAlive = true;
  socket.send(JSON.stringify({ type: 'tankWelcome', selfId: player.id, clientId: key }));

  socket.on('pong', () => { socket.isAlive = true; });
  attachTankMessages(socket, player, key);
}

function attachTankMessages(socket, player, key) {
  socket.on('message', raw => {
    if (player.socket !== socket) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'tankReset') {
      resetTankState();
    } else if (message.type === 'setName') {
      const name = profileName(socket);
      if (name && player.name !== name) { player.name = name; tankBroadcast(tankSnapshot()); }
    } else if (message.type === 'tankInput') {
      player.input.forward = Math.max(-1, Math.min(1, Number(message.forward) || 0));
      player.input.turn = Math.max(-1, Math.min(1, Number(message.turn) || 0));
    } else if (message.type === 'tankFire' && player.alive && Date.now() - player.lastFire > 650) {
      player.lastFire = Date.now();
      const muzzle = { x: player.x + Math.sin(player.turret) * 0.9, z: player.z + Math.cos(player.turret) * 0.9 };
      const blocked = tankObstacles.some(box => segmentHitsBox(player.x, player.z, muzzle.x, muzzle.z, box));
      if (!blocked) bullets.push({ id: `${player.id}-${player.lastFire}`, ownerId: player.id, ...muzzle, vx: Math.sin(player.turret) * 22, vz: Math.cos(player.turret) * 22, life: 2.5 });
    }
  });
  socket.on('close', () => {
    if (player.socket !== socket) return;
    player.socket = null;
    player.input = { forward: 0, turn: 0, aimX: 0 };
    scheduleRemoval(player, record => tankPlayers.delete(key));
  });
}

function publicPenaltyState(viewer) {
  const players = penaltyPlayers.map(key => penaltyClients.get(key)).filter(Boolean);
  return {
    type: 'penaltyState',
    selfId: viewer.id,
    role: viewer.role,
    players: players.map((player, index) => ({ id: player.id, name: player.name, color: player.color, connected: Boolean(player.socket), index })),
    spectators: [...penaltyClients.values()].filter(client => client.role === 'spectator').length,
    game: { ...penaltyGame, choices: { 0: Boolean(penaltyGame.choices[0]), 1: Boolean(penaltyGame.choices[1]) } }
  };
}

function penaltyBroadcast() {
  for (const client of penaltyClients.values()) {
    if (client.socket?.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(publicPenaltyState(client)));
  }
}

function penaltyScore(index) { return penaltyGame.kicks[index].filter(Boolean).length; }

function finishPenaltyIfDecided() {
  const taken = penaltyGame.kicks.map(kicks => kicks.length);
  const scores = [penaltyScore(0), penaltyScore(1)];
  if (taken[0] <= 5 && taken[1] <= 5) {
    if (scores[0] > scores[1] + 5 - taken[1]) penaltyGame.winner = 0;
    if (scores[1] > scores[0] + 5 - taken[0]) penaltyGame.winner = 1;
  }
  if (!penaltyGame.winner && penaltyGame.winner !== 0 && taken[0] >= 5 && taken[0] === taken[1] && scores[0] !== scores[1]) {
    penaltyGame.winner = scores[0] > scores[1] ? 0 : 1;
  }
  if (penaltyGame.winner === 0 || penaltyGame.winner === 1) {
    penaltyGame.phase = 'finished';
    penaltyGame.message = `${penaltyClients.get(penaltyPlayers[penaltyGame.winner])?.name || 'Team'} wins`;
    return true;
  }
  return false;
}

function resolvePenalty() {
  const kicker = penaltyGame.kicker;
  const keeper = 1 - kicker;
  const target = penaltyGame.choices[kicker];
  const dive = penaltyGame.choices[keeper];
  const goal = target !== dive;
  penaltyGame.kicks[kicker].push(goal);
  penaltyGame.result = { kicker, keeper, target, dive, goal };
  penaltyGame.phase = 'result';
  penaltyGame.message = goal ? 'GOAL!' : 'SAVED!';
  penaltyBroadcast();
  setTimeout(() => {
    if (penaltyGame.phase !== 'result') return;
    if (finishPenaltyIfDecided()) { penaltyBroadcast(); return; }
    penaltyGame.kicker = keeper;
    penaltyGame.choices = {};
    penaltyGame.result = null;
    penaltyGame.phase = 'choosing';
    penaltyGame.message = 'Both players choose a zone';
    penaltyBroadcast();
  }, 1800);
}

function addPenalty(socket, requestedKey) {
  const key = uniqueClientKey(penaltyClients, requestedKey);
  let client = penaltyClients.get(key);
  if (client) {
    clearTimeout(client.removeTimer);
    client.removeTimer = null;
    client.socket = socket;
  } else {
    const number = nextPenaltyNumber++;
    const role = penaltyPlayers.length < 2 && penaltyGame.phase === 'waiting' ? 'player' : 'spectator';
    client = { key, socket, id: `penalty-${number}`, name: profileName(socket) || `User ${number}`, role, color: role === 'player' ? penaltyColors[penaltyPlayers.length] : '#8c918b' };
    penaltyClients.set(key, client);
    if (role === 'player') penaltyPlayers.push(key);
  }
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', raw => {
    if (client.socket !== socket) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const index = penaltyPlayers.indexOf(key);
    if (message.type === 'setName') {
      const name = profileName(socket);
      if (name && client.name !== name) { client.name = name; penaltyBroadcast(); }
      return;
    }
    if (message.type === 'penaltyReset' && client.role === 'player') {
      resetPenaltyState(true);
      return;
    }
    if (client.role !== 'player' || penaltyGame.phase !== 'choosing') return;
    if (message.type !== 'penaltyChoose' || index < 0 || !penaltyZones.has(message.zone) || penaltyGame.choices[index]) return;
    penaltyGame.choices[index] = message.zone;
    penaltyBroadcast();
    if (penaltyGame.choices[0] && penaltyGame.choices[1]) resolvePenalty();
  });
  socket.on('close', () => {
    if (client.socket !== socket) return;
    client.socket = null;
    penaltyBroadcast();
    scheduleRemoval(client, record => {
      penaltyClients.delete(record.key);
      const playerIndex = penaltyPlayers.indexOf(record.key);
      if (playerIndex >= 0) {
        if (penaltyGame.phase === 'waiting') penaltyPlayers.splice(playerIndex, 1);
        else if (penaltyGame.phase !== 'finished') {
          penaltyGame.winner = 1 - playerIndex;
          penaltyGame.phase = 'finished';
          penaltyGame.message = `${penaltyClients.get(penaltyPlayers[1 - playerIndex])?.name || 'Opponent'} wins by disconnect`;
        }
      }
      penaltyBroadcast();
    });
  });
  if (penaltyPlayers.length === 2 && penaltyGame.phase === 'waiting') {
    penaltyGame.phase = 'choosing';
    penaltyGame.message = 'Both players choose a zone';
  }
  socket.send(JSON.stringify({ type: 'penaltyWelcome', clientId: key }));
  penaltyBroadcast();
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
  fighterEffects.length = 0;
  const active = fighterOrder.slice(0, 2);
  active.forEach((id, index) => {
    const player = fighters.get(id);
    if (player) Object.assign(player, { x: index ? 72 : 28, y: 0, vx: 0, vy: 0, energy: 100, facing: index ? -1 : 1, attack: '', attackUntil: 0, hitUntil: 0, combo: '', cpuEnergy: 100, cpuAttack: '', cpuAttackUntil: 0, cpuHitUntil: 0, cpuCombo: '' });
  });
}

function fighterSnapshot(now = Date.now()) {
  const active = fighterOrder.slice(0, 2).map(id => fighters.get(id)).filter(Boolean);
  const players = active.map(fighterPublic);
  if (players.length === 1) players.push({ id: 'cpu', name: 'CPU', role: 'computer', color: '#d9483b', x: 72, y: 0, energy: active[0].cpuEnergy ?? 100, facing: -1, attack: active[0].cpuAttack || '', attackUntil: active[0].cpuAttackUntil || 0, hitUntil: active[0].cpuHitUntil || 0, combo: active[0].cpuCombo || '' });
  return { type: 'fighterState', selfCount: fighters.size, round: fighterRound, players, effects: fighterEffects, queue: fighterOrder.slice(2).map((id, i) => ({ ...fighterPublic(fighters.get(id)), queuePosition: i + 1 })), roundEndsAt: fighterRoundEndsAt, notice: fighterNotice, serverTime: now };
}

function fighterBroadcast(message = fighterSnapshot()) {
  const payload = JSON.stringify(message);
  for (const player of fighters.values()) if (player.socket.readyState === WebSocket.OPEN) player.socket.send(payload);
}

function addFighter(socket) {
  const number = nextFighterNumber++;
  const id = `fighter-${number}`;
  const player = { socket, id, name: profileName(socket) || `Player ${number}`, color: number % 2 ? '#f4f0e6' : '#d9483b', role: 'spectator', x: 28, y: 0, vx: 0, vy: 0, facing: 1, energy: 100, attack: '', attackUntil: 0, hitUntil: 0, combo: '', input: cleanFighterInput({}), attackHeld: false, cpuEnergy: 100 };
  fighters.set(id, player); fighterOrder.push(id);
  if (fighterOrder.length <= 2) resetFighterRound(fighterOrder.length === 2 ? 'A NEW CHALLENGER!' : 'CPU CHALLENGER'); else fighterRoles();
  socket.isAlive = true;
  socket.send(JSON.stringify({ type: 'fighterWelcome', selfId: id }));
  fighterBroadcast();
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'fighterInput') player.input = cleanFighterInput(message);
    if (message.type === 'fighterCombo' && ['hadoken', 'shoryuken', 'tatsumaki'].includes(message.combo) && player.role !== 'spectator') player.pendingCombo = message.combo;
    if (message.type === 'setName') { const name = profileName(socket); if (name && player.name !== name) { player.name = name; fighterBroadcast(); } }
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


function bigTwoActive() {
  const humans = bigTwoOrder.slice(0, 4).map(id => bigTwoPlayers.get(id)).filter(Boolean);
  return humans.length ? [...humans, ...bigTwoCpus.slice(0, 4 - humans.length)] : [];
}
function broadcastBigTwo() {
  const active=bigTwoActive();
  const onlineCount=[...bigTwoPlayers.values()].filter(player=>player.socket.readyState===WebSocket.OPEN).length;
 for(const viewer of bigTwoPlayers.values()) if(viewer.socket.readyState===WebSocket.OPEN) viewer.socket.send(JSON.stringify({type:'bigTwoState',onlineCount,selfId:viewer.id,role:active.includes(viewer)?'player':'spectator',round:bigTwoRound,status:bigTwoGame.status,turn:bigTwoGame.turn,trick:bigTwoGame.trick,openingCard:bigTwoGame.openingCard,notice:bigTwoGame.notice,hand:active.includes(viewer)?viewer.hand:[],players:active.map(p=>({id:p.id,name:p.name,count:p.hand.length,score:p.score||0,computer:Boolean(p.computer)})),spectators:Math.max(0,bigTwoOrder.length-4)}));
 scheduleBigTwoCpu();
}
function startBigTwo(notice='New deal') {
 const players=bigTwoActive();bigTwoRound++;const shuffled=bigTwoDeck().sort(()=>Math.random()-.5),dealt=shuffled.slice(0,players.length*13);
 if(players.length&&!dealt.includes('3D'))dealt[dealt.length-1]='3D';
 players.forEach((p,n)=>p.hand=dealt.filter((_,i)=>i%players.length===n).sort((a,b)=>cardValue(a)-cardValue(b)));
 const openingCard=dealt.reduce((a,c)=>!a||cardValue(c)<cardValue(a)?c:a,'');const starter=players.find(p=>p.hand.includes(openingCard));
 bigTwoGame={status:players.length?'playing':'waiting',turn:starter?.id||'',trick:null,passes:[],openingCard,notice};broadcastBigTwo();
}
function nextBigTwoTurn(id){const a=bigTwoActive().filter(p=>p.hand.length),i=a.findIndex(p=>p.id===id);return a[(i+1)%a.length]?.id||'';}
function finishBigTwoPlay(player, cards) {
 const combo=classify(cards);player.hand=player.hand.filter(c=>!cards.includes(c));bigTwoGame.trick={playerId:player.id,playerName:player.name,cards,kind:combo.kind};bigTwoGame.passes=[];bigTwoGame.notice=`${player.name} played ${combo.kind}`;
 if(!player.hand.length){let won=0;for(const other of bigTwoActive())if(other!==player){other.score-=other.hand.length;won+=other.hand.length}player.score+=won;bigTwoGame.status='finished';bigTwoGame.turn='';bigTwoGame.notice=`${player.name} wins +${won}`}else bigTwoGame.turn=nextBigTwoTurn(player.id);broadcastBigTwo();
}
function passBigTwo(player) {
 if(!bigTwoGame.trick)return;bigTwoGame.passes.push(player.id);const others=bigTwoActive().filter(x=>x.hand.length&&x.id!==bigTwoGame.trick.playerId);if(others.every(x=>bigTwoGame.passes.includes(x.id))){bigTwoGame.turn=bigTwoGame.trick.playerId;bigTwoGame.trick=null;bigTwoGame.passes=[];bigTwoGame.notice='Trick cleared'}else bigTwoGame.turn=nextBigTwoTurn(player.id);broadcastBigTwo();
}
function scheduleBigTwoCpu() {
 clearTimeout(bigTwoCpuTimer);
 const cpu=bigTwoActive().find(player=>player.id===bigTwoGame.turn&&player.computer);
 if(!cpu||bigTwoGame.status!=='playing')return;
 bigTwoCpuTimer=setTimeout(()=>{
  if(bigTwoGame.status!=='playing'||bigTwoGame.turn!==cpu.id)return;
  const opening=bigTwoActive().every(player=>player.hand.length===13)&&cpu.hand.includes(bigTwoGame.openingCard);
  const cards=!bigTwoGame.trick||opening?[opening?bigTwoGame.openingCard:cpu.hand[0]]:bigTwoGame.trick.cards.length===1?cpu.hand.find(card=>beats([card],bigTwoGame.trick))? [cpu.hand.find(card=>beats([card],bigTwoGame.trick))]:null:null;
  if(cards)finishBigTwoPlay(cpu,cards);else passBigTwo(cpu);
 },550);
}
function addBigTwo(socket){
 const id=`big-${nextBigTwoNumber++}`,p={socket,id,name:profileName(socket)||`PLAYER ${String(nextBigTwoNumber-1).padStart(2,'0')}`,hand:[],score:0};bigTwoPlayers.set(id,p);bigTwoOrder.push(id);socket.isAlive=true;socket.on('pong',()=>socket.isAlive=true);
 if(bigTwoOrder.length<=4)startBigTwo(`${p.name} joined — new deal`);else broadcastBigTwo();
 socket.on('message',raw=>{let source;try{source=JSON.parse(raw.toString())}catch{return}if(source.type==='setName'){const name=profileName(socket);if(name&&p.name!==name){p.name=name;broadcastBigTwo()}return}const m=cleanBigTwoAction(source);if(!m||!bigTwoActive().includes(p))return;if(m.type==='reset'){startBigTwo(`${p.name} reset the table`);return}if(bigTwoGame.status!=='playing'||bigTwoGame.turn!==id)return;
  if(m.type==='pass'){passBigTwo(p);return}
  if(!m.cards.every(c=>p.hand.includes(c))||!beats(m.cards,bigTwoGame.trick))return;if(!bigTwoGame.trick&&bigTwoActive().every(x=>x.hand.length===13)&&!m.cards.includes(bigTwoGame.openingCard))return;
  finishBigTwoPlay(p,m.cards);
 });
 socket.on('close',()=>{const active=bigTwoOrder.indexOf(id)<4;bigTwoPlayers.delete(id);bigTwoOrder=bigTwoOrder.filter(x=>x!==id);if(active)startBigTwo(`${p.name} left — new deal`);else broadcastBigTwo()});
}

function activeTypists() { return typingOrder.slice(0, typingGame.mode === 'solo' ? 1 : 2).map(key => typingPlayers.get(key)).filter(Boolean); }
function typingPublic(player, paragraph, now) {
  return { id: player.id, name: player.name, length: player.value.length, value: player.value, finished: Boolean(player.finishedAt), stats: player.finishedAt ? typingStats(player, paragraph, now) : null };
}
function broadcastTyping() {
  const paragraph = typingGame.paragraph, now = Date.now(), active = activeTypists();
  for (const viewer of typingPlayers.values()) if (viewer.socket?.readyState === WebSocket.OPEN) {
    viewer.socket.send(JSON.stringify({ type: 'typingState', selfId: viewer.id, role: active.includes(viewer) ? 'player' : 'spectator', phase: typingGame.phase, mode: typingGame.mode, difficulty: typingGame.difficulty, countdownEndsAt: typingGame.countdownEndsAt, serverTime: now, paragraph, players: active.map(p => typingPublic(p, paragraph, now)), spectators: Math.max(0, typingOrder.length - active.length) }));
  }
}
function clearTypingPlayer(player) { Object.assign(player, { value: '', startedAt: 0, finishedAt: 0, keystrokes: 0, correctKeystrokes: 0, backspaces: 0 }); }
function resetTypingGame() {
  clearTimeout(typingTimer); activeTypists().forEach(clearTypingPlayer);
  typingGame.paragraph = randomParagraph(typingGame.difficulty, typingGame.paragraph);
  const requiredPlayers = typingGame.mode === 'solo' ? 1 : 2;
  if (activeTypists().length === requiredPlayers) {
    if (typingGame.mode === 'solo') { typingGame.phase = 'ready'; typingGame.countdownEndsAt = 0; typingGame.startedAt = 0; }
    else {
      typingGame.phase = 'countdown'; typingGame.countdownEndsAt = Date.now() + 3000; typingGame.startedAt = 0;
      typingTimer = setTimeout(() => { typingGame.phase = 'racing'; typingGame.startedAt = Date.now(); activeTypists().forEach(p => { p.startedAt = typingGame.startedAt; }); broadcastTyping(); }, 3000);
      typingTimer.unref?.();
    }
  } else { typingGame.phase = 'waiting'; typingGame.countdownEndsAt = 0; typingGame.startedAt = 0; }
  broadcastTyping();
}
function addTyping(socket, key) {
  key = uniqueClientKey(typingPlayers, key);
  let player = typingPlayers.get(key);
  if (player) { clearTimeout(player.removeTimer); player.removeTimer = null; player.socket = socket; }
  else {
    const number = nextTypingNumber++;
    player = { key, socket, id: `typist-${number}`, name: profileName(socket) || `Typist ${number}`, value: '', startedAt: 0, finishedAt: 0, keystrokes: 0, correctKeystrokes: 0, backspaces: 0, removeTimer: null };
    typingPlayers.set(key, player); typingOrder.push(key);
    if (typingGame.mode === 'versus' && typingOrder.length <= 2 && typingGame.phase !== 'racing') resetTypingGame();
  }
  socket.isAlive = true; socket.on('pong', () => { socket.isAlive = true; }); broadcastTyping();
  socket.on('message', raw => {
    if (player.socket !== socket) return;
    let source; try { source = JSON.parse(raw.toString()); } catch { return; }
    if (source.type === 'setName') { const name = profileName(socket); if (name) { player.name = name; broadcastTyping(); } return; }
    const message = cleanTypingAction(source); const active = activeTypists();
    if (!message || !active.includes(player)) return;
    if (message.type === 'reset') { resetTypingGame(); return; }
    if (message.type === 'mode') { if (typingGame.phase === 'racing') return; typingGame.mode = message.mode; resetTypingGame(); return; }
    if (message.type === 'difficulty') { typingGame.difficulty = message.difficulty; resetTypingGame(); return; }
    if (!['ready', 'racing'].includes(typingGame.phase) || player.finishedAt) return;
    const old = player.value, value = message.value, paragraph = typingGame.paragraph;
    if (value.length > paragraph.length || Math.abs(value.length - old.length) > 1 || (value.length === old.length && value !== old)) return;
    if (typingGame.phase === 'ready') {
      if (!value.length) return;
      typingGame.phase = 'racing'; typingGame.startedAt = Date.now(); player.startedAt = typingGame.startedAt;
    }
    if (value.length < old.length) { player.backspaces++; }
    else if (value.length > old.length) { player.keystrokes++; if (value.at(-1) === paragraph[value.length - 1]) player.correctKeystrokes++; }
    player.value = value;
    if (value.length === paragraph.length) player.finishedAt = Date.now();
    if (active.length === (typingGame.mode === 'solo' ? 1 : 2) && active.every(p => p.finishedAt)) typingGame.phase = 'finished';
    broadcastTyping();
  });
  socket.on('close', () => {
    if (player.socket !== socket) return; player.socket = null; broadcastTyping();
    scheduleRemoval(player, () => { const wasActive = activeTypists().includes(player); typingPlayers.delete(key); typingOrder = typingOrder.filter(item => item !== key); if (wasActive) resetTypingGame(); else broadcastTyping(); });
  });
}

function snakeOpenCell() {
  const occupied = new Set(
    [...snakeClients.values()].flatMap(player => player.body).map(({ x, y }) => `${x},${y}`)
  );
  const spaces = [];
  for (let y = 1; y < SNAKE_ROWS - 1; y++) {
    for (let x = 1; x < SNAKE_COLS - 1; x++) if (!occupied.has(`${x},${y}`)) spaces.push({ x, y });
  }
  return spaces[Math.floor(Math.random() * spaces.length)] || { x: 18, y: 12 };
}

function resetSnakePlayer(player) {
  const start = chooseSnakeSpawn([...snakeClients.values()].filter(other => other.id !== player.id));
  player.body = start ? snakeBodyAt(start) : [];
  player.direction = start ? { x: start.dx, y: start.dy } : { x: 1, y: 0 };
  player.nextDirection = { ...player.direction };
  player.score = 0;
  player.alive = Boolean(start);
}

function resetSnakeGame(running = true) {
  for (const player of snakeClients.values()) player.body = [];
  for (const player of snakeClients.values()) resetSnakePlayer(player);
  snakeFood = snakeOpenCell();
  snakeRunning = running;
  snakePaused = false;
  broadcastSnakeState();
}

function snakeSnapshot() {
  return {
    type: 'snakeState',
    running: snakeRunning,
    paused: snakePaused,
    food: snakeFood,
    players: [...snakeClients.values()].map(({ id, name, color, body, direction, score, alive }) => ({
      id, name, color, body, direction, score, alive,
    })),
  };
}

function broadcastSnakeState() {
  const message = JSON.stringify(snakeSnapshot());
  for (const client of snakeClients.values()) {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(message);
  }
}

function addSnake(socket) {
  const number = nextSnakeNumber++;
  const player = {
    id: `snake-${number}`,
    name: profileName(socket) || `PLAYER ${number}`,
    color: snakeColors[(number - 1) % snakeColors.length],
    socket,
    body: [],
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    score: 0,
    alive: false,
  };
  snakeClients.set(player.id, player);
  resetSnakePlayer(player);
  snakeFood = snakeOpenCell();
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.send(JSON.stringify({ type: 'snakeWelcome', selfId: player.id }));
  broadcastSnakeState();
  socket.on('message', data => {
    let raw;
    try { raw = JSON.parse(data.toString()); } catch { return; }
    if (raw.type === 'setName') { const name = profileName(socket); if (name && player.name !== name) { player.name = name; broadcastSnakeState(); } return; }
    const action = cleanSnakeAction(raw);
    if (!action) return;
    if (action.type === 'snakeInput') {
      if (!player.alive) return;
      if (action.x !== -player.direction.x || action.y !== -player.direction.y) {
        player.nextDirection = { x: action.x, y: action.y };
      }
    } else if (action.type === 'snakeTogglePause' && snakeRunning) {
      snakePaused = !snakePaused;
      broadcastSnakeState();
    } else if (action.type === 'snakeStart' || action.type === 'snakeReset') {
      resetSnakeGame(true);
    }
  });
  socket.on('close', () => {
    snakeClients.delete(player.id);
    if (snakeClients.size === 0) {
      snakeRunning = false;
      snakePaused = false;
    }
    broadcastSnakeState();
  });
}

const snakeLoop = setInterval(() => {
  if (!snakeRunning || snakePaused) return;
  const active = [...snakeClients.values()].filter(player => player.alive && player.body.length);
  if (!active.length) {
    snakeRunning = false;
    broadcastSnakeState();
    return;
  }
  const nextHeads = new Map(active.map(player => [player.id, {
    x: player.body[0].x + player.nextDirection.x,
    y: player.body[0].y + player.nextDirection.y,
  }]));
  for (const player of active) {
    const next = nextHeads.get(player.id);
    const wall = next.x < 1 || next.x >= SNAKE_COLS - 1 || next.y < 1 || next.y >= SNAKE_ROWS - 1;
    const bodyHit = active.some(other => other.body.some((part, index) =>
      !(other.id === player.id && index === other.body.length - 1)
      && part.x === next.x && part.y === next.y
    ));
    const headHit = active.some(other => other.id !== player.id && nextHeads.get(other.id).x === next.x && nextHeads.get(other.id).y === next.y);
    if (wall || bodyHit || headHit) {
      player.alive = false;
      continue;
    }
    player.direction = player.nextDirection;
    player.body.unshift(next);
    if (next.x === snakeFood.x && next.y === snakeFood.y) {
      player.score += 1;
      snakeFood = snakeOpenCell();
    } else {
      player.body.pop();
    }
  }
  broadcastSnakeState();
}, 115);
snakeLoop.unref();

function wordleState(game) {
  return {
    type: 'wordleState', length: game.length, guesses: game.guesses,
    status: game.status, message: game.message,
    availableByLength: Object.fromEntries(Object.entries(wordleWords).map(([length, list]) => [length, list.length])),
    answer: game.status === 'playing' ? undefined : game.answer
  };
}

function resetWordle(game, length = game.length) {
  const previous = game.answer;
  game.length = length;
  game.answer = randomWord(length, previous);
  game.guesses = [];
  game.status = 'playing';
  game.message = '';
}

function addWordle(socket, key) {
  let game = wordleGames.get(key);
  if (!game) {
    game = { length: 5, answer: '', guesses: [], status: 'playing', message: '', socket: null, removeTimer: null };
    resetWordle(game, 5);
    wordleGames.set(key, game);
  }
  clearTimeout(game.removeTimer);
  game.socket?.close();
  game.socket = socket;
  socket.send(JSON.stringify(wordleState(game)));
  socket.on('message', raw => {
    if (game.socket !== socket) return;
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const action = cleanWordleAction(message);
    if (!action) return;
    if (action.type === 'reset') resetWordle(game);
    if (action.type === 'length') resetWordle(game, action.length);
    if (action.type === 'guess') {
      if (game.status !== 'playing' || action.word.length !== game.length) return;
      if (!wordleWords[game.length].includes(action.word)) {
        game.message = 'Not in the word list';
      } else {
        game.message = '';
        game.guesses.push({ word: action.word, result: scoreGuess(game.answer, action.word) });
        if (action.word === game.answer) game.status = 'won';
        else if (game.guesses.length === 6) game.status = 'lost';
      }
    }
    socket.send(JSON.stringify(wordleState(game)));
  });
  socket.on('close', () => {
    if (game.socket !== socket) return;
    game.socket = null;
    game.removeTimer = setTimeout(() => wordleGames.delete(key), DISCONNECT_GRACE_MS);
    game.removeTimer.unref?.();
  });
}

function pollState(poll, socket) {
  const isCreator = socket.pollCreator === poll.creatorToken;
  const totals = poll.choices.map((_, index) => poll.responses.filter(response => response.choice === index).length);
  const participants = [...new Map([...poll.sockets].filter(client => (
    client.platformProfile && client.pollCreator !== poll.creatorToken
  )).map(client => {
    const profile = client.platformProfile;
    return [profile.key, { id: profile.key, name: profile.name, ip: profile.ip, room: `poll ${poll.id}`, connectedAt: profile.connectedAt }];
  })).values()];
  return {
    type: 'pollState', id: poll.id, question: poll.question, choices: poll.choices,
    connected: participants.length, participants, submitted: poll.responses.length,
    eligibleParticipants: poll.participants.size,
    hasVoted: poll.voters.has(socket.pollClient), isCreator, showingResults: poll.showingResults,
    results: poll.showingResults || isCreator ? { totals } : undefined
  };
}

function broadcastPoll(poll) {
  for (const client of poll.sockets) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(pollState(poll, client)));
}

function joinPoll(socket, id, client, creatorToken) {
  const poll = polls.get(id);
  if (!poll) {
    socket.send(JSON.stringify({ type: 'pollMissing' }));
    return;
  }
  socket.pollClient = client;
  socket.pollCreator = creatorToken;
  const isCreator = creatorToken === poll.creatorToken;
  if (!isCreator) poll.participants.add(client);
  poll.sockets.add(socket);
  broadcastPoll(poll);
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const action = cleanPollAction(message);
    if (!action) return;
    if (action.type === 'vote') {
      if (isCreator || poll.showingResults || poll.voters.has(client) || action.choice >= poll.choices.length) return;
      poll.voters.add(client);
      poll.responses.push({ choice: action.choice });
    } else {
      if (action.creatorToken !== poll.creatorToken) return;
      if (action.type === 'showResults') poll.showingResults = true;
      if (action.type === 'resetPoll') {
        for (const client of poll.sockets) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'pollReset' }));
        polls.delete(poll.id);
        return;
      }
    }
    broadcastPoll(poll);
  });
  socket.on('close', () => { poll.sockets.delete(socket); broadcastPoll(poll); });
}

function addPollLobby(socket, request, client, creatorToken) {
  const url = new URL(request.url, 'http://localhost');
  const id = (url.searchParams.get('poll') || '').toUpperCase();
  if (id) { joinPoll(socket, id, client, creatorToken); return; }
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    const action = cleanPollAction(message);
    if (!action || action.type !== 'createPoll') return;
    let pollId;
    do { pollId = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (polls.has(pollId));
    const token = crypto.randomBytes(24).toString('base64url');
    polls.set(pollId, { ...action, id: pollId, creatorToken: token, participants: new Set(), sockets: new Set(), responses: [], voters: new Set(), showingResults: false });
    socket.send(JSON.stringify({ type: 'pollCreated', id: pollId, creatorToken: token }));
  });
}

wss.on('connection', (socket, request) => {
  socket.isAlive = true;
  attachPlatformMessages(socket);
  socket.send(JSON.stringify({ type: 'switchGame', path: currentGamePath }));
  const url = new URL(request.url, 'http://localhost');
  const room = url.searchParams.get('room') || 'doodle';
  let key = clientKey(request);
  registerPlatformSocket(socket, request, key, room);
  if (room === 'tanks') {
    addTank(socket, key);
    return;
  }
  if (room === 'penalty') {
    addPenalty(socket, key);
    return;
  }
  if (room === 'fighter') { addFighter(socket); return; }
  if (room === 'bigtwo') { addBigTwo(socket); return; }
  if (room === 'snake') { addSnake(socket); return; }
  if (room === 'typing') { addTyping(socket, key); return; }
  if (room === 'wordle') { addWordle(socket, key); return; }
  if (room === 'poll') { addPollLobby(socket, request, key, url.searchParams.get('creator') || ''); return; }
  key = uniqueClientKey(users, key);
  const returning = users.get(key);
  if (returning) {
    clearTimeout(returning.removeTimer);
    returning.removeTimer = null;
    returning.socket = socket;
    socket.isAlive = true;
    socket.send(JSON.stringify({ type: 'welcome', self: publicUser(returning), users: publicUsers(), history, chatHistory, clientId: key }));
    broadcast({ type: 'presence', users: publicUsers() }, socket);
    attachDoodleMessages(socket, returning, key);
    return;
  }
  const number = nextUserNumber++;
  const user = {
    socket,
    key,
    id: `user-${number}`,
    name: profileName(socket) || `User ${number}`,
    color: colors[(number - 1) % colors.length],
    tool: 'pen',
    drawing: false
  };
  users.set(key, user);
  socket.isAlive = true;
  socket.send(JSON.stringify({ type: 'welcome', self: publicUser(user), users: publicUsers(), history, chatHistory, clientId: key }));
  broadcast({ type: 'presence', users: publicUsers() }, socket);
  attachDoodleMessages(socket, user, key);
});

function attachDoodleMessages(socket, user, key) {
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', (raw) => {
    if (user.socket !== socket) return;
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
    } else if (message.type === 'setName') {
      const name = profileName(socket);
      if (name && user.name !== name) { user.name = name; broadcast({ type: 'presence', users: publicUsers() }); }
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
    } else if (message.type === 'chat') {
      const text = typeof message.text === 'string' ? message.text.trim().slice(0, 240) : '';
      const now = Date.now();
      if (!text || now - (user.lastChat || 0) < 500) return;
      user.lastChat = now;
      const chat = { type: 'chat', id: `${user.id}-${now}`, userId: user.id, name: user.name, color: user.color, text, sentAt: now };
      chatHistory.push(chat);
      if (chatHistory.length > 100) chatHistory.shift();
      broadcast(chat);
    }
  });

  socket.on('close', () => {
    if (user.socket !== socket) return;
    user.socket = null;
    user.drawing = false;
    broadcast({ type: 'left', userId: user.id, users: publicUsers() });
    scheduleRemoval(user, () => {
      users.delete(key);
    });
  });
}

function beginFighterAttack(attacker, type, now) {
  const attacks = {
    punch: { duration: 230, reach: 11, damage: 7, push: 4 }, kick: { duration: 360, reach: 15, damage: 11, push: 4 },
    hadoken: { duration: 520, reach: 45, damage: 15, push: 8 }, shoryuken: { duration: 460, reach: 16, damage: 19, push: 7 }, tatsumaki: { duration: 560, reach: 21, damage: 17, push: 8 }
  };
  const data = attacks[type] || attacks.punch;
  attacker.attack = type; attacker.attackUntil = now + data.duration; attacker.attackHeld = true;
  return data;
}

function landFighterAttack(attacker, defender, type, now) {
  const attack = beginFighterAttack(attacker, type, now);
  if (type === 'hadoken') {
    fighterEffects.push({
      id: `${attacker.id || 'cpu'}-${now}`,
      x: attacker.x + attacker.facing * 5,
      y: Math.max(7, attacker.y + 12),
      vx: attacker.facing * 64,
      life: 0.68
    });
  }
  if (type === 'shoryuken' && attacker.y === 0) attacker.vy = 46;
  if (Math.abs(defender.x - attacker.x) <= attack.reach && Math.abs(defender.y - attacker.y) < 18 && now >= defender.hitUntil) {
    defender.energy = Math.max(0, defender.energy - attack.damage); defender.hitUntil = now + 320; defender.x = Math.max(5, Math.min(95, defender.x + attacker.facing * attack.push));
    attacker.combo = type.toUpperCase(); attacker.comboUntil = now + 1100;
  }
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
  if (attacker.pendingCombo && now >= attacker.attackUntil) { const combo = attacker.pendingCombo; attacker.pendingCombo = ''; landFighterAttack(attacker, defender, combo, now); }
  const pressed = input.punch || input.kick;
  if (!pressed) attacker.attackHeld = false;
  if (pressed && !attacker.attackHeld && now >= attacker.attackUntil) {
    landFighterAttack(attacker, defender, input.punch ? 'punch' : 'kick', now);
  }
  if (now > (attacker.comboUntil || 0)) attacker.combo = '';
}

let previousFighterTick = Date.now();
const fighterLoop = setInterval(() => {
  if (!fighters.size) return;
  const now = Date.now(), dt = Math.min((now - previousFighterTick) / 1000, .05); previousFighterTick = now;
  for (let index = fighterEffects.length - 1; index >= 0; index--) {
    const effect = fighterEffects[index];
    effect.x += effect.vx * dt;
    effect.life -= dt;
    if (effect.life <= 0 || effect.x < -8 || effect.x > 108) fighterEffects.splice(index, 1);
  }
  const active = fighterOrder.slice(0, 2).map(id => fighters.get(id)).filter(Boolean);
  if (!fighterRoundEndsAt && active.length) {
    if (active.length === 1) {
      const human = active[0];
      const cpu = { x: 72, y: 0, vx: 0, vy: 0, facing: -1, energy: human.cpuEnergy ?? 100, attack: human.cpuAttack || '', attackUntil: human.cpuAttackUntil || 0, hitUntil: human.cpuHitUntil || 0, combo: human.cpuCombo || '', comboUntil: human.cpuComboUntil || 0, attackHeld: human.cpuAttackHeld || false };
      runFighter(human, cpu, dt, now); runFighter(cpu, human, dt, now, true);
      Object.assign(human, { cpuEnergy: cpu.energy, cpuAttack: cpu.attack, cpuAttackUntil: cpu.attackUntil, cpuHitUntil: cpu.hitUntil, cpuCombo: cpu.combo, cpuComboUntil: cpu.comboUntil, cpuAttackHeld: cpu.attackHeld });
      if (human.energy <= 0 || cpu.energy <= 0) { fighterNotice = human.energy > 0 ? `${human.name} WINS` : 'CPU WINS'; fighterRoundEndsAt = now + 3000; }
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
      if (now >= player.respawnAt) {
        const heading = Math.random() * Math.PI * 2;
        Object.assign(player, randomSpawn(), { alive: true, respawnAt: 0, heading, turret: heading });
      }
      continue;
    }
    const hullTurn = player.input.turn * dt * 2.1;
    player.heading += hullTurn;
    player.turret = player.heading;
    const next = { x: player.x + Math.sin(player.heading) * player.input.forward * dt * 9, z: player.z + Math.cos(player.heading) * player.input.forward * dt * 9 };
    const blocked = Math.abs(next.x) > TANK_MAP_HALF_SIZE - tankRadius || Math.abs(next.z) > TANK_MAP_HALF_SIZE - tankRadius || tankObstacles.some(box => Math.abs(next.x - box.x) < box.w / 2 + tankRadius && Math.abs(next.z - box.z) < box.d / 2 + tankRadius);
    if (!blocked) Object.assign(player, next);
  }
  for (let index = bullets.length - 1; index >= 0; index--) {
    const bullet = bullets[index];
    const previousX = bullet.x, previousZ = bullet.z;
    bullet.x += bullet.vx * dt; bullet.z += bullet.vz * dt; bullet.life -= dt;
    const hitsWall = Math.abs(bullet.x) > TANK_MAP_HALF_SIZE || Math.abs(bullet.z) > TANK_MAP_HALF_SIZE || tankObstacles.some(box => segmentHitsBox(previousX, previousZ, bullet.x, bullet.z, box));
    const victim = hitsWall ? null : [...tankPlayers.values()].find(player => player.alive && player.id !== bullet.ownerId && segmentDistance(previousX, previousZ, bullet.x, bullet.z, player.x, player.z) < tankRadius);
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

wss.on('close', () => { clearInterval(heartbeat); clearInterval(gameLoop); clearInterval(fighterLoop); clearInterval(snakeLoop); });

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Doodle Together is live on http://localhost:${PORT}`));
}

module.exports = { server, wss, segmentHitsBox, segmentDistance };
