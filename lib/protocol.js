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

function cleanBigTwoAction(message) {
  if (!message || !['play', 'pass', 'reset'].includes(message.type)) return null;
  if (message.type !== 'play') return { type: message.type };
  if (!Array.isArray(message.cards) || !message.cards.length || message.cards.length > 5) return null;
  if (message.cards.some(card => typeof card !== 'string' || !/^[3-9TJQKA2][DCHS]$/.test(card)) || new Set(message.cards).size !== message.cards.length) return null;
  return { type: 'play', cards: message.cards };
}

module.exports = { cleanPoint, cleanFighterInput, cleanBigTwoAction };
