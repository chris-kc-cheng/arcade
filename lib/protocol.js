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
  if (!message || !['input', 'reset', 'difficulty', 'mode'].includes(message.type)) return null;
  if (message.type === 'reset') return { type: 'reset' };
  if (message.type === 'mode') return ['solo', 'versus'].includes(message.mode)
    ? { type: 'mode', mode: message.mode } : null;
  if (message.type === 'difficulty') return ['easy', 'medium', 'hard'].includes(message.difficulty)
    ? { type: 'difficulty', difficulty: message.difficulty } : null;
  if (typeof message.value !== 'string' || message.value.length > 900) return null;
  return { type: 'input', value: message.value, backspace: message.backspace === true };
}

function cleanWordleAction(message) {
  if (!message || !['guess', 'reset', 'length'].includes(message.type)) return null;
  if (message.type === 'reset') return { type: 'reset' };
  if (message.type === 'length') return Number.isInteger(message.length) && message.length >= 2 && message.length <= 8
    ? { type: 'length', length: message.length } : null;
  if (typeof message.word !== 'string') return null;
  const word = message.word.trim().toLowerCase();
  return /^[a-z]{2,8}$/.test(word) ? { type: 'guess', word } : null;
}

function cleanPollAction(message) {
  if (!message || !['createPoll', 'vote', 'showResults', 'resetPoll'].includes(message.type)) return null;
  if (message.type === 'showResults' || message.type === 'resetPoll') {
    return typeof message.creatorToken === 'string' && message.creatorToken.length <= 80
      ? { type: message.type, creatorToken: message.creatorToken } : null;
  }
  if (message.type === 'createPoll') {
    const question = typeof message.question === 'string' ? message.question.trim().replace(/\s+/g, ' ').slice(0, 240) : '';
    const choices = Array.isArray(message.choices)
      ? message.choices.map(choice => typeof choice === 'string' ? choice.trim().replace(/\s+/g, ' ').slice(0, 120) : '').filter(Boolean)
      : [];
    if (!question || choices.length < 2 || choices.length > 20 || new Set(choices.map(choice => choice.toLowerCase())).size !== choices.length) return null;
    return { type: 'createPoll', question, choices, allowText: message.allowText === true };
  }
  const choice = Number(message.choice);
  const text = typeof message.text === 'string' ? message.text.trim().slice(0, 500) : '';
  if (!Number.isInteger(choice) || choice < 0 || choice > 19) return null;
  return { type: 'vote', choice, text };
}

module.exports = { cleanPoint, cleanFighterInput, cleanBigTwoAction, cleanTypingAction, cleanWordleAction, cleanPollAction };
