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

function cleanTypingAction(message) {
  if (!message || !['input', 'reset', 'difficulty'].includes(message.type)) return null;
  if (message.type === 'reset') return { type: 'reset' };
  if (message.type === 'difficulty') return ['easy', 'medium', 'hard'].includes(message.difficulty)
    ? { type: 'difficulty', difficulty: message.difficulty } : null;
  if (typeof message.value !== 'string' || message.value.length > 900) return null;
  return { type: 'input', value: message.value, backspace: message.backspace === true };
}

module.exports = { cleanPoint, cleanFighterInput, cleanBigTwoAction, cleanTypingAction };
