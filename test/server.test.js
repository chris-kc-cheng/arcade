const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPoint, cleanFighterInput } = require('../lib/protocol');

test('cleanPoint accepts and clamps normalized coordinates', () => {
  assert.deepEqual(cleanPoint({ x: -2, y: 3 }), { x: 0, y: 1 });
  assert.deepEqual(cleanPoint({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
});

test('cleanFighterInput normalizes controls to booleans', () => {
  assert.deepEqual(cleanFighterInput({ left: 1, right: 0, punch: 'yes' }), {
    left: true, right: false, down: false, jump: false, punch: true, kick: false
  });
});

test('cleanPoint rejects malformed coordinates', () => {
  assert.equal(cleanPoint(null), null);
  assert.equal(cleanPoint({ x: '0.5', y: 0.5 }), null);
});

const { cleanBigTwoAction } = require('../lib/protocol');
const { classify, beats } = require('../lib/bigtwo');
test('Big Two messages accept only unique valid cards',()=>{
 assert.deepEqual(cleanBigTwoAction({type:'play',cards:['3D','3S']}),{type:'play',cards:['3D','3S']});
 assert.equal(cleanBigTwoAction({type:'play',cards:['2S','2S']}),null);
 assert.equal(cleanBigTwoAction({type:'play',cards:['XX']}),null);
 assert.equal(cleanBigTwoAction({type:'cheat'}),null);
});
test('Big Two combinations rank 2 high and five-card categories',()=>{
 assert.equal(classify(['4D','4S']).kind,'pair');
 assert.equal(classify(['3D','4D','5D','6D','7D']).kind,'straight flush');
 assert.equal(beats(['2D'],{cards:['AS']}),true);
 assert.equal(beats(['3D','3C','3H','4D','4C'],{cards:['3S','5S','7S','9S','JS']}),true);
});

const { cleanTypingAction } = require('../lib/protocol');
const { paragraphs, randomParagraph, typingStats } = require('../lib/typing');
test('typing messages validate input, difficulty, and reset actions', () => {
  assert.deepEqual(cleanTypingAction({ type: 'input', value: 'hello', backspace: true }), { type: 'input', value: 'hello', backspace: true });
  assert.deepEqual(cleanTypingAction({ type: 'difficulty', difficulty: 'hard' }), { type: 'difficulty', difficulty: 'hard' });
  assert.deepEqual(cleanTypingAction({ type: 'mode', mode: 'solo' }), { type: 'mode', mode: 'solo' });
  assert.deepEqual(cleanTypingAction({ type: 'mode', mode: 'versus' }), { type: 'mode', mode: 'versus' });
  assert.equal(cleanTypingAction({ type: 'mode', mode: 'computer' }), null);
  assert.equal(cleanTypingAction({ type: 'difficulty', difficulty: 'impossible' }), null);
  assert.equal(cleanTypingAction({ type: 'input', value: 'x'.repeat(901) }), null);
  assert.equal(cleanTypingAction({ type: 'finish', score: 9999 }), null);
});
test('typing statistics are derived from server-owned race data', () => {
  const player = { startedAt: 1000, finishedAt: 61000, keystrokes: 120, correctKeystrokes: 114, backspaces: 4 };
  const stats = typingStats(player, 'one two three four five', 99999);
  assert.deepEqual(stats, { timeMs: 60000, accuracy: 95, backspaces: 4, cpm: 23, wps: 0.08, score: 9 });
  assert.ok(Object.values(paragraphs).every(examples => examples.length >= 4));
  assert.ok(paragraphs.easy.every(text => text.length > 80 && text.length < 160));
  assert.ok(paragraphs.medium.every(text => text.length > 200 && text.length < 350));
  assert.ok(paragraphs.hard.every(text => text.length > 600 && text.length <= 900));
  assert.notEqual(randomParagraph('easy', paragraphs.easy[0]), paragraphs.easy[0]);
});
