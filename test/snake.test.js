const test = require('node:test');
const assert = require('node:assert/strict');
const { SNAKE_STARTS, snakeBodyAt, chooseSnakeSpawn, cleanSnakeAction } = require('../lib/snake');
const { WebSocket } = require('ws');

test('Snake assigns every available player a non-overlapping starting body', () => {
  const players = [];
  for (let index = 0; index < SNAKE_STARTS.length; index += 1) {
    const start = chooseSnakeSpawn(players, () => 0);
    assert.ok(start);
    const body = snakeBodyAt(start);
    const occupied = new Set(players.flatMap(player => player.body).map(({ x, y }) => `${x},${y}`));
    assert.ok(body.every(({ x, y }) => !occupied.has(`${x},${y}`)));
    players.push({ body });
  }
  assert.equal(chooseSnakeSpawn(players), null);
});

test('Snake accepts only cardinal movement and known shared controls', () => {
  assert.deepEqual(cleanSnakeAction({ type: 'snakeInput', x: 0, y: -1 }), { type: 'snakeInput', x: 0, y: -1 });
  assert.deepEqual(cleanSnakeAction({ type: 'snakeReset' }), { type: 'snakeReset' });
  assert.equal(cleanSnakeAction({ type: 'snakeInput', x: 1, y: 1 }), null);
  assert.equal(cleanSnakeAction({ type: 'snakeInput', x: '1', y: 0 }), null);
  assert.equal(cleanSnakeAction({ type: 'snakeCheat' }), null);
});

test('two Snake clients receive the same non-overlapping server state', async () => {
  process.env.DISCONNECT_GRACE_MS = '20';
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}?room=snake`;
  const clients = [new WebSocket(url), new WebSocket(url)];
  const states = clients.map(() => []);
  clients.forEach((client, index) => client.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === 'snakeState') states[index].push(message);
  }));
  await Promise.all(clients.map(client => new Promise(resolve => client.once('open', resolve))));
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('timed out waiting for shared Snake state')), 1000);
    const check = setInterval(() => {
      if (states.every(items => items.some(state => state.players.length === 2))) {
        clearTimeout(deadline); clearInterval(check); resolve();
      }
    }, 10);
  });
  const shared = states.map(items => items.findLast(state => state.players.length === 2));
  assert.deepEqual(shared[0].players, shared[1].players);
  const occupied = shared[0].players.flatMap(player => player.body.map(part => `${part.x},${part.y}`));
  assert.equal(new Set(occupied).size, occupied.length);
  clients.forEach(client => client.close());
  await Promise.all(clients.map(client => new Promise(resolve => client.once('close', resolve))));

  const openDoodle = key => new Promise(resolve => {
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}?room=doodle&client=${key}`);
    client.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'welcome') resolve({ client, welcome: message });
    });
  });
  const first = await openDoodle('doodle-client-one');
  const twoConnected = new Promise(resolve => first.client.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === 'presence' && message.users.length === 2) resolve(message);
  }));
  const second = await openDoodle('doodle-client-two');
  await twoConnected;
  const departed = new Promise(resolve => first.client.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === 'left' && message.userId === second.welcome.self.id) resolve(message);
  }));
  second.client.close();
  assert.equal((await departed).users.length, 1);
  await new Promise(resolve => setTimeout(resolve, 40));
  const replacement = await openDoodle('doodle-client-two');
  assert.notEqual(replacement.welcome.self.id, second.welcome.self.id);
  first.client.close(); replacement.client.close();
  await Promise.all([first.client, replacement.client].map(client => new Promise(resolve => client.once('close', resolve))));
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
});
