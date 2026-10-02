const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

test('typing game starts a server-authoritative solo run and keeps later joins spectating', async t => {
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => {
    clients.forEach(client => client.terminate());
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });

  const states = [];
  const join = async label => {
    const received = [];
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}?room=typing&client=${label}`);
    clients.push(client); states.push(received);
    client.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'typingState') received.push(message);
    });
    await new Promise(resolve => client.once('open', resolve));
    await waitFor(() => received.length > 0);
    return client;
  };

  const solo = await join('solo-player');
  assert.equal(states[0].at(-1).phase, 'waiting');
  solo.send(JSON.stringify({ type: 'mode', mode: 'solo' }));
  await waitFor(() => states[0].some(state => state.mode === 'solo' && state.phase === 'countdown'));

  const visitor = await join('solo-spectator');
  await waitFor(() => states[1].some(state => state.mode === 'solo' && state.role === 'spectator'));
  visitor.send(JSON.stringify({ type: 'mode', mode: 'versus' }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(states[0].at(-1).mode, 'solo');

  await waitFor(() => states[0].some(state => state.mode === 'solo' && state.phase === 'racing'), 4000);
  assert.equal(states[0].at(-1).players.length, 1);
  assert.equal(states[0].at(-1).role, 'player');
});

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for typing state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
