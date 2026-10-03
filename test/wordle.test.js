const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanWordleAction } = require('../lib/protocol');
const { words, answerWords, totalWords, scoreGuess, letterStatuses, randomWord } = require('../lib/wordle');

test('Word game accepts only bounded guesses, lengths, and reset actions', () => {
  assert.deepEqual(cleanWordleAction({ type: 'guess', word: '  Apple ' }), { type: 'guess', word: 'apple' });
  assert.deepEqual(cleanWordleAction({ type: 'guess', word: ' ox ' }), { type: 'guess', word: 'ox' });
  assert.deepEqual(cleanWordleAction({ type: 'length', length: 2 }), { type: 'length', length: 2 });
  assert.deepEqual(cleanWordleAction({ type: 'length', length: 8 }), { type: 'length', length: 8 });
  assert.deepEqual(cleanWordleAction({ type: 'reset' }), { type: 'reset' });
  assert.equal(cleanWordleAction({ type: 'guess', word: 'a' }), null);
  assert.equal(cleanWordleAction({ type: 'length', length: 9 }), null);
  assert.equal(cleanWordleAction({ type: 'win', score: 999 }), null);
});

test('word library contains unique English-format words from two to eight letters', () => {
  assert.ok(totalWords > 16000);
  assert.equal(words[5].length, 14855);
  assert.ok(words[5].includes('aahed'));
  assert.ok(words[5].includes('zymic'));
  assert.ok(answerWords[5].length < words[5].length);
  assert.ok(answerWords[5].includes(randomWord(5)));
  assert.equal(totalWords, Object.values(words).reduce((sum, list) => sum + list.length, 0));
  for (const [length, list] of Object.entries(words)) {
    assert.ok(list.length > (Number(length) < 4 ? 20 : 250));
    assert.equal(new Set(list).size, list.length);
    assert.ok(list.every(word => word.length === Number(length) && /^[a-z]+$/.test(word)));
  }
});

test('guess scoring handles duplicate letters without over-counting', () => {
  assert.deepEqual(scoreGuess('apple', 'allee'), ['correct', 'present', 'absent', 'absent', 'correct']);
  assert.deepEqual(scoreGuess('stone', 'stone'), Array(5).fill('correct'));
});

test('keyboard hints keep the strongest result seen for each letter', () => {
  assert.deepEqual(letterStatuses([
    { word: 'allee', result: ['correct', 'present', 'absent', 'absent', 'correct'] },
    { word: 'stale', result: ['absent', 'absent', 'correct', 'present', 'correct'] }
  ]), { a: 'correct', l: 'present', e: 'correct', s: 'absent', t: 'absent' });
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
  assert.equal(states[0].wordCount, undefined);
  assert.deepEqual(states[0].letters, {});
  assert.deepEqual(Object.keys(states[0].availableByLength), ['2', '3', '4', '5', '6', '7', '8']);
  assert.equal(states[0].availableByLength[5], 14855);

  client.send(JSON.stringify({ type: 'length', length: 4 }));
  await waitFor(() => states.at(-1).length === 4);
  client.send(JSON.stringify({ type: 'guess', word: 'able', result: ['correct'], score: 999 }));
  await waitFor(() => states.at(-1).guesses.length === 1);
  assert.equal(states.at(-1).guesses[0].word, 'able');
  assert.equal(states.at(-1).guesses[0].result.length, 4);
  assert.ok(Object.keys(states.at(-1).letters).length > 0);
  assert.equal('score' in states.at(-1).guesses[0], false);

  client.send(JSON.stringify({ type: 'length', length: 2 }));
  await waitFor(() => states.at(-1).length === 2);
  for (let attempt = 0; attempt < 6 && states.at(-1).status === 'playing'; attempt++) {
    const count = states.length;
    client.send(JSON.stringify({ type: 'guess', word: 'am' }));
    await waitFor(() => states.length > count);
  }
  assert.notEqual(states.at(-1).status, 'playing');
  assert.match(states.at(-1).answer, /^[a-z]{2}$/);

  client.send(JSON.stringify({ type: 'reset' }));
  await waitFor(() => states.at(-1).status === 'playing' && states.at(-1).guesses.length === 0);
  assert.equal(states.at(-1).answer, undefined);
});

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for word game state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
