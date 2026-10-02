const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPollAction } = require('../lib/protocol');

test('poll protocol validates creation, voting, and creator actions', () => {
  assert.deepEqual(cleanPollAction({ type: 'createPoll', question: ' Lunch? ', choices: [' Pizza ', 'Tacos'], allowText: true }), { type: 'createPoll', question: 'Lunch?', choices: ['Pizza', 'Tacos'], allowText: true });
  assert.equal(cleanPollAction({ type: 'createPoll', question: '', choices: ['A', 'B'] }), null);
  assert.equal(cleanPollAction({ type: 'createPoll', question: 'Pick', choices: ['Same', 'same'] }), null);
  assert.deepEqual(cleanPollAction({ type: 'vote', choice: 1, text: ' Because! ' }), { type: 'vote', choice: 1, text: 'Because!' });
  assert.equal(cleanPollAction({ type: 'vote', choice: -1 }), null);
  assert.equal(cleanPollAction({ type: 'showResults', creatorToken: 7 }), null);
});

test('poll state is authoritative and creator-only controls are enforced', async t => {
  const { WebSocket } = require('ws');
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const lobby = new WebSocket(`ws://127.0.0.1:${port}?room=poll&client=host`);
  const lobbyMessages = messages(lobby);
  t.after(async () => { lobby.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  await opened(lobby);
  lobby.send(JSON.stringify({ type: 'createPoll', question: 'Best color?', choices: ['Red', 'Blue'], allowText: true }));
  const created = await waitMessage(lobbyMessages, 'pollCreated');

  const host = new WebSocket(`ws://127.0.0.1:${port}?room=poll&poll=${created.id}&client=host&creator=${created.creatorToken}`);
  const voter = new WebSocket(`ws://127.0.0.1:${port}?room=poll&poll=${created.id}&client=voter`);
  const hostMessages = messages(host), voterMessages = messages(voter);
  await Promise.all([opened(host), opened(voter)]);
  await waitMessage(voterMessages, 'pollState', state => state.connected === 2);
  voter.send(JSON.stringify({ type: 'vote', choice: 1, text: 'Ocean' }));
  await waitMessage(hostMessages, 'pollState', state => state.submitted === 1);
  voter.send(JSON.stringify({ type: 'vote', choice: 0, text: 'duplicate' }));
  voter.send(JSON.stringify({ type: 'showResults', creatorToken: 'wrong' }));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(hostMessages.at(-1).submitted, 1);
  assert.equal(hostMessages.at(-1).showingResults, false);
  host.send(JSON.stringify({ type: 'showResults', creatorToken: created.creatorToken }));
  const results = await waitMessage(voterMessages, 'pollState', state => state.showingResults);
  assert.deepEqual(results.results, { totals: [0, 1], texts: ['Ocean'] });
  host.terminate(); voter.terminate();
});

function messages(socket) { const list = []; socket.on('message', raw => list.push(JSON.parse(raw))); return list; }
function opened(socket) { return socket.readyState === socket.OPEN ? Promise.resolve() : new Promise(resolve => socket.once('open', resolve)); }
async function waitMessage(list, type, predicate = () => true) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) { const found = list.find(message => message.type === type && predicate(message)); if (found) return found; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out waiting for ${type}`);
}
