function cleanPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
}

function cleanFighterInput(message) {
  return {
    left: Boolean(message?.left),
    right: Boolean(message?.right),
    down: Boolean(message?.down),
    jump: Boolean(message?.jump),
    punch: Boolean(message?.punch),
    kick: Boolean(message?.kick)
  };
}

module.exports = { cleanPoint, cleanFighterInput };
