const test = require('node:test');
const assert = require('node:assert/strict');
const { segmentHitsBox, segmentDistance } = require('../server');

test('a fast cannon round cannot tunnel through an obstacle', () => {
  const wall = { x: 0, z: 0, w: 1, d: 8 };
  assert.equal(segmentHitsBox(-2, 0, 2, 0, wall), true);
  assert.equal(segmentHitsBox(-2, 5, 2, 5, wall), false);
});

test('a swept cannon round detects a tank between simulation frames', () => {
  assert.equal(segmentDistance(-2, 0, 2, 0, 0, 0), 0);
  assert.equal(segmentDistance(-2, 0, 2, 0, 0, 2), 2);
});
