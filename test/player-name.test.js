const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the player name is display only: it can change, is validated at the server, and can be reset to the generated name', async t => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), APPS_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('startup timeout')), 5000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=snake&client=name-test`); const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw))); t.after(() => socket.terminate());
  await once(socket, 'open');
  const send = message => socket.send(JSON.stringify(message));
  const me = async predicate => { for (let i = 0; i < 100; i++) { const found = messages.findLast(m => m.type === 'platformPresence')?.players.find(player => player.id === 'name-test'); if (found && predicate(found.name)) return found.name; await pause(20); } throw Error(`name never matched; last: ${JSON.stringify(messages.findLast(m => m.type === 'platformPresence')?.players)}`); };

  const generated = await me(name => /^User \d+$/.test(name));
  send({ type: 'setName', name: '  Ada   Lovelace  ' }); assert.equal(await me(name => name === 'Ada Lovelace'), 'Ada Lovelace');
  await pause(350); send({ type: 'setName', name: 'x'.repeat(80) }); assert.equal((await me(name => name.startsWith('xxx'))).length, 24, 'long names are cut at the server');
  await pause(350); send({ type: 'setName', name: { evil: true } }); send({ type: 'setName' }); await pause(350);
  assert.equal(await me(name => name.startsWith('xxx')), 'x'.repeat(24), 'a non-string name changes nothing');
  send({ type: 'setName', name: 'Grace' }); await me(name => name === 'Grace');
  send({ type: 'setName', name: 'Too Fast' }); await pause(100);
  assert.equal(await me(name => name === 'Grace'), 'Grace', 'changes inside the rate-limit window are ignored');
  await pause(350); send({ type: 'setName', name: '   ' });
  assert.equal(await me(name => /^User \d+$/.test(name)), generated, 'an empty name goes back to the generated one');
});
