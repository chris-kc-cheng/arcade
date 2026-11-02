// Twin Spot, a Spot-It style game: two round cards share exactly one symbol, and everyone in the room races to click it.
// On the hard level, about half of each card's symbols are shown as their name instead of the emoji, so the match can be an
// emoji on one card and its word on the other. The server builds the cards and alone knows which symbol matches.
const MAX_PLAYERS = 20;
const MISS_PENALTY = 25;
const MISS_LOCK_MS = 1000;
const REVEAL_MS = 1800;
const BASE_POINTS = { easy: 100, medium: 150, hard: 200 };
const SPEED_BONUS = 50;
const LEVELS = { easy: { items: 5, words: 0 }, medium: { items: 7, words: 0 }, hard: { items: 7, words: 3 } };

// Emoji and the word shown for them on the hard level. No flags, and every entry is a different idea.
const symbols = [
  ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐰', 'rabbit'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'],
  ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'], ['🦆', 'duck'], ['🦉', 'owl'], ['🦇', 'bat'],
  ['🐺', 'wolf'], ['🐴', 'horse'], ['🦄', 'unicorn'], ['🐝', 'bee'], ['🐌', 'snail'], ['🐞', 'ladybug'], ['🐢', 'turtle'], ['🐍', 'snake'], ['🦎', 'lizard'], ['🐙', 'octopus'],
  ['🦀', 'crab'], ['🐠', 'fish'], ['🐬', 'dolphin'], ['🐳', 'whale'], ['🦈', 'shark'], ['🐘', 'elephant'], ['🦒', 'giraffe'], ['🦓', 'zebra'], ['🐪', 'camel'], ['🍎', 'apple'],
  ['🍌', 'banana'], ['🍇', 'grapes'], ['🍓', 'berry'], ['🍊', 'orange'], ['🍋', 'lemon'], ['🍉', 'melon'], ['🍑', 'peach'], ['🍒', 'cherry'], ['🥝', 'kiwi'], ['🥕', 'carrot'],
  ['🌽', 'corn'], ['🍞', 'bread'], ['🧀', 'cheese'], ['🍕', 'pizza'], ['🍔', 'burger'], ['🍟', 'fries'], ['🌭', 'hotdog'], ['🍩', 'donut'], ['🍪', 'cookie'], ['🎂', 'cake'],
  ['🍬', 'candy'], ['☕', 'coffee'], ['🥛', 'milk'], ['⚽', 'soccer'], ['🎾', 'tennis'], ['🎸', 'guitar'], ['🥁', 'drum'], ['🎺', 'trumpet'], ['🎻', 'violin'], ['🚗', 'car'],
  ['🚌', 'bus'], ['🚲', 'bike'], ['✈️', 'plane'], ['🚀', 'rocket'], ['🚁', 'copter'], ['⛵', 'boat'], ['🚂', 'train'], ['🏠', 'house'], ['⏰', 'clock'], ['📚', 'books'],
  ['✏️', 'pencil'], ['🔑', 'key'], ['🔔', 'bell'], ['💡', 'bulb'], ['🎁', 'gift'], ['🎈', 'balloon'], ['🎩', 'hat'], ['👓', 'glasses'], ['👑', 'crown'], ['👟', 'shoe'],
  ['🧦', 'socks'], ['🌙', 'moon'], ['⭐', 'star'], ['☀️', 'sun'], ['☁️', 'cloud'], ['🌈', 'rainbow'], ['⛄', 'snowman'], ['🔥', 'fire'], ['💧', 'drop'], ['🌸', 'flower'],
  ['🌲', 'tree'], ['🌵', 'cactus'], ['🍀', 'clover'], ['⚡', 'bolt'], ['❤️', 'heart'], ['💎', 'gem'], ['🔨', 'hammer'], ['⚓', 'anchor'], ['🎯', 'target'], ['🧲', 'magnet'],
  ['🪁', 'kite'], ['🧸', 'teddy'], ['🎲', 'dice'], ['✂️', 'scissors'], ['📷', 'camera'], ['☂️', 'umbrella'], ['🧭', 'compass'], ['🕯️', 'candle']
];

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

// Every item is a capsule: a line segment (half-length s, along its rotation) swollen by a radius b. An emoji is a circle (s = 0);
// a word is a long thin capsule. Sizes are in units of the card's radius. The constants are generous for bold text and the glyph
// box, so neighbours never touch even when a long word is rotated.
// An emoji is drawn about 1.2em wide (measured in a browser), so its circle is 1.2 times its font size.
const WORD_WIDTH = 0.66, WORD_HEIGHT = 0.9, EMOJI_RADIUS = 1.2, GAP = 0.06, EDGE = 0.95;
function shape(item) {
  if (item.kind !== 'word') return { b: item.fs * EMOJI_RADIUS, s: 0 };
  const b = item.fs * WORD_HEIGHT;
  return { b, s: Math.max(0, item.label.length * WORD_WIDTH * item.fs - b) };
}
const ends = item => {
  const { s } = shape(item), angle = item.rot * Math.PI / 180, dx = Math.cos(angle) * s, dy = Math.sin(angle) * s;
  return [{ x: item.x - dx, y: item.y - dy }, { x: item.x + dx, y: item.y + dy }];
};
function pointToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function segmentsCross(p1, p2, p3, p4) {
  const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return side(p1, p2, p3) !== side(p1, p2, p4) && side(p3, p4, p1) !== side(p3, p4, p2);
}
// The empty space between two items: zero or negative means they touch or overlap.
function clearance(one, two) {
  // Layout caches each item's geometry, since it is compared against many neighbours.
  const [a1, a2] = one.geo?.ends || ends(one), [b1, b2] = two.geo?.ends || ends(two);
  const between = segmentsCross(a1, a2, b1, b2) ? 0 : Math.min(pointToSegment(a1, b1, b2), pointToSegment(a2, b1, b2), pointToSegment(b1, a1, a2), pointToSegment(b2, a1, a2));
  return between - (one.geo?.b ?? shape(one).b) - (two.geo?.b ?? shape(two).b);
}
// How far the item's furthest point is inside the card edge (negative when it pokes out).
const edgeRoom = item => EDGE - Math.max(...ends(item).map(point => Math.hypot(point.x, point.y))) - shape(item).b;

// Places items inside the unit circle without touching, spreading them out: each item, biggest first, takes the candidate spot
// with the most clear space around it. If the items will not fit, every item shrinks a little and placement starts again.
function layout(items, random) {
  for (let shrink = 1; shrink > 0.3; shrink *= 0.95) {
    const scaled = items.map(item => ({ ...item, fs: item.fs * shrink }));
    const placed = [];
    let ok = true;
    for (const item of [...scaled].sort((a, b) => (shape(b).b + shape(b).s) - (shape(a).b + shape(a).s))) {
      let best = null;
      for (let attempt = 0; attempt < 140; attempt++) {
        const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * 0.9;
        const candidate = { ...item, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
        candidate.geo = { b: shape(candidate).b, ends: ends(candidate) };
        if (edgeRoom(candidate) < 0.004) continue;
        const room = placed.length ? Math.min(...placed.map(other => clearance(candidate, other))) : 1;
        if (room >= GAP && (!best || room > best.room)) best = { candidate, room };
      }
      if (!best) { ok = false; break; }
      placed.push(best.candidate);
    }
    if (ok) return scaled.map(item => { const { geo, ...entry } = placed.find(found => found.id === item.id); return entry; });
  }
  throw new Error('Could not lay out a card');
}

function makeCard(symbolIds, words, base, random) {
  const wordSlots = new Set(shuffle(symbolIds.map((_, slot) => slot), random).slice(0, words));
  const items = symbolIds.map((id, slot) => {
    const asWord = wordSlots.has(slot), size = 0.65 + random() * 0.5, name = symbols[id][1];
    // Long words get a smaller font so the whole word stays a manageable length.
    const fs = asWord ? Math.min(0.085 * (0.8 + random() * 0.4), 0.3 / (name.length * WORD_WIDTH)) : base * size;
    return { id, kind: asWord ? 'word' : 'emoji', label: asWord ? name : symbols[id][0], name, size: Math.round(size * 100) / 100, rot: Math.floor(random() * 360), fs: Math.round(fs * 1000) / 1000 };
  });
  return layout(shuffle(items, random), random).map(item => ({ ...item, x: Math.round(item.x * 1000) / 1000, y: Math.round(item.y * 1000) / 1000 }));
}

// Two cards with the same number of symbols and exactly one symbol in common.
function generateRound(level = 'easy', random = Math.random) {
  const config = LEVELS[level] || LEVELS.easy, n = config.items;
  const ids = shuffle(symbols.map((_, index) => index), random).slice(0, 2 * n - 1);
  const shared = ids[0], first = [shared, ...ids.slice(1, n)], second = [shared, ...ids.slice(n)];
  const base = n === 5 ? 0.27 : 0.21;
  const cards = [makeCard(first, config.words, base, random), makeCard(second, config.words, base, random)];
  return { level, cards, shared, match: cards.map(card => card.findIndex(item => item.id === shared)) };
}

// The next pair after a match: only the card that was clicked is replaced. The other card stays, and the new card shares exactly
// one symbol with it. That symbol is never the one that was just found, so the answer always changes.
function generateNext(previous, replace, random = Math.random) {
  const config = LEVELS[previous.level] || LEVELS.easy, n = config.items, kept = 1 - replace, keptCard = previous.cards[kept];
  const shared = shuffle(keptCard.map(item => item.id).filter(id => id !== previous.shared), random)[0];
  const used = new Set(keptCard.map(item => item.id));
  const fresh = shuffle(symbols.map((_, index) => index).filter(id => !used.has(id)), random).slice(0, n - 1);
  const card = makeCard([shared, ...fresh], config.words, n === 5 ? 0.27 : 0.21, random);
  const cards = [null, null];
  cards[kept] = keptCard; cards[replace] = card;
  return { level: previous.level, cards, shared, match: cards.map(list => list.findIndex(item => item.id === shared)) };
}

function newGame(level = 'easy', random) {
  return { phase: 'waiting', level, round: 0, puzzle: generateRound(level, random), startedAt: 0, revealUntil: 0, winner: null, replace: null };
}

function newPlayer(key, id, name) {
  return { key, id, name, socket: null, removeTimer: null, score: 0, found: 0, misses: 0, lockedUntil: 0 };
}

// `continuing` deals the next pair of a running game (only the clicked card changes); otherwise both cards are new.
function startRound(game, players, now, { level = game.level, keepScores = true, continuing = false, random } = {}) {
  const puzzle = continuing && game.puzzle && game.replace !== null && game.level === level ? generateNext(game.puzzle, game.replace, random) : generateRound(level, random);
  Object.assign(game, { phase: 'playing', level, round: game.round + 1, puzzle, startedAt: now, revealUntil: 0, winner: null, replace: null });
  players.forEach(player => { if (keepScores) player.lockedUntil = 0; else Object.assign(player, { score: 0, found: 0, misses: 0, lockedUntil: 0 }); });
}

function reveal(game, now, winner = null, card = 0) {
  game.phase = 'revealed'; game.revealUntil = now + REVEAL_MS; game.winner = winner; game.replace = card;
}

// The only way to score: click the item, on either card, that is the shared symbol. The server decides.
function pick(game, player, card, item, now) {
  if (game.phase !== 'playing' || !Number.isInteger(card) || !Number.isInteger(item) || card < 0 || card > 1) return { ok: false };
  const items = game.puzzle.cards[card];
  if (item < 0 || item >= items.length) return { ok: false };
  if (now < player.lockedUntil) return { ok: false, reason: 'locked' };
  if (items[item].id !== game.puzzle.shared) {
    player.misses++; player.score -= MISS_PENALTY; player.lockedUntil = now + MISS_LOCK_MS;
    return { ok: true, hit: false, penalty: MISS_PENALTY };
  }
  const points = BASE_POINTS[game.level] + Math.max(0, SPEED_BONUS - Math.floor((now - game.startedAt) / 100));
  player.found++; player.score += points;
  reveal(game, now, player.id, card);
  return { ok: true, hit: true, points };
}

// Giving up on a pair reveals the match and scores nothing.
function skip(game, now, random = Math.random) {
  if (game.phase !== 'playing') return false;
  reveal(game, now, null, random() < 0.5 ? 0 : 1);
  return true;
}

// The cards are shown without the symbol ids; the matching items are only named once the pair is revealed.
function publicGame(game, now) {
  const showing = game.phase === 'playing' || game.phase === 'revealed';
  return {
    phase: game.phase, level: game.level, round: game.round, serverTime: now, revealUntil: game.revealUntil, startedAt: game.startedAt,
    cards: showing ? game.puzzle.cards.map(card => card.map(({ id, ...item }) => item)) : [],
    match: game.phase === 'revealed' ? game.puzzle.match : null, winner: game.phase === 'revealed' ? game.winner : null
  };
}

function publicPlayer(player) {
  return { id: player.id, name: player.name, score: player.score, found: player.found, misses: player.misses, lockedUntil: player.lockedUntil };
}

module.exports = { MAX_PLAYERS, MISS_PENALTY, MISS_LOCK_MS, REVEAL_MS, BASE_POINTS, LEVELS, symbols, generateRound, generateNext, clearance, edgeRoom, newGame, newPlayer, startRound, pick, skip, publicGame, publicPlayer };
