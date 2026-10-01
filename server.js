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

wss.on('connection', (socket) => {
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

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) socket.terminate();
    else { socket.isAlive = false; socket.ping(); }
  }
}, 30000);
heartbeat.unref();

wss.on('close', () => clearInterval(heartbeat));

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Doodle Together is live on http://localhost:${PORT}`));
}

module.exports = { server, wss };
