const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanWordleAction } = require('../lib/protocol');
const { words, totalWords, scoreGuess } = require('../lib/wordle');

test('Word game accepts only bounded guesses, lengths, and reset actions', () => {
  assert.deepEqual(cleanWordleAction({ type: 'guess', word: '  Apple ' }), { type: 'guess', word: 'apple' });
  assert.deepEqual(cleanWordleAction({ type: 'length', length: 8 }), { type: 'length', length: 8 });
  assert.deepEqual(cleanWordleAction({ type: 'reset' }), { type: 'reset' });
  assert.equal(cleanWordleAction({ type: 'guess', word: 'cat' }), null);
  assert.equal(cleanWordleAction({ type: 'length', length: 9 }), null);
  assert.equal(cleanWordleAction({ type: 'win', score: 999 }), null);
});

test('word library contains unique English-format words from four to eight letters', () => {
  assert.ok(totalWords > 1500);
  assert.equal(totalWords, Object.values(words).reduce((sum, list) => sum + list.length, 0));
  for (const [length, list] of Object.entries(words)) {
    assert.ok(list.length > 250);
    assert.equal(new Set(list).size, list.length);
    assert.ok(list.every(word => word.length === Number(length) && /^[a-z]+$/.test(word)));
  }
});

test('guess scoring handles duplicate letters without over-counting', () => {
  assert.deepEqual(scoreGuess('apple', 'allee'), ['correct', 'present', 'absent', 'absent', 'correct']);
  assert.deepEqual(scoreGuess('stone', 'stone'), Array(5).fill('correct'));
});

test('Word game keeps each solo puzzle authoritative on the server', async t => {
  const { WebSocket } = require('ws');
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}?room=wordle&client=wordle-test`);
  const states = [];
  client.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type === 'wordleState') states.push(message);
  });
  t.after(async () => {
    client.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => client.once('open', resolve));
  await waitFor(() => states.length);
  assert.equal(states[0].answer, undefined);
  assert.equal(states[0].wordCount, totalWords);

  client.send(JSON.stringify({ type: 'length', length: 4 }));
  await waitFor(() => states.at(-1).length === 4);
  client.send(JSON.stringify({ type: 'guess', word: 'able', result: ['correct'], score: 999 }));
  await waitFor(() => states.at(-1).guesses.length === 1);
  assert.equal(states.at(-1).guesses[0].word, 'able');
  assert.equal(states.at(-1).guesses[0].result.length, 4);
  assert.equal('score' in states.at(-1).guesses[0], false);
});

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for word game state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
