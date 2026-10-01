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
