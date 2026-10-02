const TANK_MAP_HALF_SIZE = 120;
const TANK_OBSTACLE_COUNT = 27;
const obstacleShapes = [
  { w: 15, d: 10, h: 8 }, { w: 9, d: 18, h: 11 }, { w: 13, d: 13, h: 7 },
  { w: 10, d: 15, h: 10 }, { w: 14, d: 9, h: 6 }, { w: 7, d: 8, h: 5 }
];

function createTankObstacles(random = Math.random) {
  const obstacles = [];
  for (let attempt = 0; obstacles.length < TANK_OBSTACLE_COUNT && attempt < 10000; attempt++) {
    const shape = obstacleShapes[Math.floor(random() * obstacleShapes.length)];
    const candidate = {
      ...shape,
      x: Math.round((random() * 2 - 1) * (TANK_MAP_HALF_SIZE - shape.w / 2 - 5)),
      z: Math.round((random() * 2 - 1) * (TANK_MAP_HALF_SIZE - shape.d / 2 - 5))
    };
    const overlaps = obstacles.some(box =>
      Math.abs(candidate.x - box.x) < (candidate.w + box.w) / 2 + 5 &&
      Math.abs(candidate.z - box.z) < (candidate.d + box.d) / 2 + 5
    );
    if (!overlaps) obstacles.push(candidate);
  }
  if (obstacles.length !== TANK_OBSTACLE_COUNT) throw new Error('Unable to place tank obstacles');
  return obstacles;
}

function radarPoint(x, z, player, scale, center) {
  const dx = x - player.x, dz = z - player.z;
  return {
    x: center + (dx * Math.cos(player.heading) - dz * Math.sin(player.heading)) * scale,
    y: center - (dx * Math.sin(player.heading) + dz * Math.cos(player.heading)) * scale
  };
}

module.exports = { TANK_MAP_HALF_SIZE, TANK_OBSTACLE_COUNT, createTankObstacles, radarPoint };
