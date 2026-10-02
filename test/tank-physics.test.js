const test = require('node:test');
const assert = require('node:assert/strict');
const { segmentHitsBox, segmentDistance } = require('../server');
const { TANK_MAP_HALF_SIZE, TANK_OBSTACLE_COUNT, createTankObstacles, radarPoint } = require('../lib/tank');

test('a fast cannon round cannot tunnel through an obstacle', () => {
  const wall = { x: 0, z: 0, w: 1, d: 8 };
  assert.equal(segmentHitsBox(-2, 0, 2, 0, wall), true);
  assert.equal(segmentHitsBox(-2, 5, 2, 5, wall), false);
});

test('a swept cannon round detects a tank between simulation frames', () => {
  assert.equal(segmentDistance(-2, 0, 2, 0, 0, 0), 0);
  assert.equal(segmentDistance(-2, 0, 2, 0, 0, 2), 2);
});

test('tank arena starts with a fixed half-sized random obstacle layout', () => {
  let seed = 123456789;
  const obstacles = createTankObstacles(() => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32));
  assert.equal(obstacles.length, TANK_OBSTACLE_COUNT);
  assert.equal(TANK_OBSTACLE_COUNT, 54 / 2);
  assert.ok(obstacles.every(box => Math.abs(box.x) + box.w / 2 < TANK_MAP_HALF_SIZE));
  assert.ok(obstacles.every(box => Math.abs(box.z) + box.d / 2 < TANK_MAP_HALF_SIZE));
});

test('radar places the direction in front of the user toward the top', () => {
  const player = { x: 10, z: 20, heading: Math.PI / 2 };
  assert.deepEqual(radarPoint(20, 20, player, 1, 120), { x: 120, y: 110 });
});
