const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { WebSocket } = require('ws');

test('Big-D navigation sends shared switches and follows server switches', () => {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { classList: { add() {}, remove() {} }, replaceChildren() {}, remove() {} });
    return elements.get(selector);
  };
  let click, socket;
  const sent = [], navigated = [];
  const link = { title: 'Drawing board', getAttribute: () => '/', addEventListener: (_, handler) => { click = handler; } };
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; socket = this; }
    send(raw) { sent.push(JSON.parse(raw)); }
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/bigtwo.js'), 'utf8'), {
    document: { querySelector: element, querySelectorAll: () => [link], createElement: () => ({}) },
    location: { protocol: 'http:', host: 'localhost', pathname: '/bigtwo.html', assign: path => navigated.push(path) },
    WebSocket: FakeSocket, confirm: () => true
  });
  let prevented = false;
  click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(sent, [{ type: 'switchGame', path: '/' }]);
  socket.onmessage({ data: JSON.stringify({ type: 'switchGame', path: '/bigtwo.html' }) });
  assert.deepEqual(navigated, []);
  socket.onmessage({ data: JSON.stringify({ type: 'switchGame', path: '/' }) });
  assert.deepEqual(navigated, ['/']);
  socket.onmessage({ data: JSON.stringify({ type: 'bigTwoState', onlineCount: 5, role: 'spectator', players: [], hand: [], status: 'waiting', notice: 'Waiting', spectators: 1 }) });
  assert.equal(element('#onlineCount').textContent, '5 PLAYERS ONLINE');
  assert.equal(element('#reset').disabled, true);
  socket.onclose();
  assert.equal(element('#onlineCount').textContent, 'OFFLINE');
});

test('Big-D counts connected humans including spectators and synchronizes exits', async t => {
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [], messages = [];
  t.after(async () => {
    clients.forEach(client => client.terminate());
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });
  async function waitFor(predicate) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for Big-D state');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async function join() {
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}?room=bigtwo`);
    const received = [];
    clients.push(client); messages.push(received);
    client.on('message', raw => received.push(JSON.parse(raw)));
    await new Promise(resolve => client.once('open', resolve));
    await waitFor(() => received.some(message => message.type === 'bigTwoState'));
    return received.findLast(message => message.type === 'bigTwoState');
  }
  const solo = await join();
  assert.equal(solo.onlineCount, 1);
  assert.equal(solo.players.filter(player => player.computer).length, 3);
  for (let i = 0; i < 4; i++) await join();
  await waitFor(() => messages.every(items => items.some(m => m.onlineCount === 5)));
  const spectator = messages[4].findLast(m => m.type === 'bigTwoState');
  assert.equal(spectator.role, 'spectator');
  clients[4].send(JSON.stringify({ type: 'reset', onlineCount: 999 }));
  clients[4].close();
  await waitFor(() => messages[0].some(m => m.onlineCount === 4));
  assert.equal(messages[0].findLast(m => m.type === 'bigTwoState').round, spectator.round);
  clients[0].send(JSON.stringify({ type: 'switchGame', path: '/invalid.html' }));
  clients[0].send(JSON.stringify({ type: 'switchGame', path: '/tank.html' }));
  await waitFor(() => messages.slice(0, 4).every(items => items.some(m => m.type === 'switchGame' && m.path === '/tank.html')));
  assert.ok(messages.every(items => !items.some(m => m.path === '/invalid.html')));
  assert.ok(messages.every(items => !items.some(m => m.onlineCount === 999)));
});
