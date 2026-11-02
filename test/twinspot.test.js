const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { cleanTwinAction } = require('../lib/protocol');
const twin = require('../lib/twinspot');

function seeded(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const names = card => card.map(item => item.name);

test('twin spot protocol accepts only a bounded card and item, known levels, skip and reset', () => {
  for (const value of [null, [], {}, { type: 'pick' }, { type: 'pick', card: 2, item: 0 }, { type: 'pick', card: -1, item: 0 }, { type: 'pick', card: 0, item: 12 }, { type: 'pick', card: 0, item: 1.5 }, { type: 'pick', card: '0', item: 1 }, { type: 'level', level: 'insane' }, { type: 'level', level: 3 }, { type: 'score', score: 99 }]) assert.equal(cleanTwinAction(value), null);
  assert.deepEqual(cleanTwinAction({ type: 'pick', card: 1, item: 6, correct: true }), { type: 'pick', card: 1, item: 6 });
  assert.deepEqual(cleanTwinAction({ type: 'level', level: 'hard', x: 1 }), { type: 'level', level: 'hard' });
  assert.deepEqual(cleanTwinAction({ type: 'skip', x: 1 }), { type: 'skip' });
  assert.deepEqual(cleanTwinAction({ type: 'reset' }), { type: 'reset' });
});

test('the symbol set has no country flags, no duplicate emoji and no duplicate words', () => {
  const flags = /[\u{1F1E6}-\u{1F1FF}]|\u{1F3F4}|\u{1F3C1}|\u{1F6A9}|\u{1F38C}/u;
  assert.ok(twin.symbols.length >= 100);
  for (const [emoji, word] of twin.symbols) { assert.doesNotMatch(emoji, flags, emoji); assert.match(word, /^[a-z]{2,9}$/, word); }
  assert.equal(new Set(twin.symbols.map(([emoji]) => emoji)).size, twin.symbols.length);
  assert.equal(new Set(twin.symbols.map(([, word]) => word)).size, twin.symbols.length);
});

test('every round has two cards of the right size that share exactly one symbol', () => {
  const expected = { easy: [5, 0], medium: [7, 0], hard: [7, 3] };
  for (const level of ['easy', 'medium', 'hard']) for (let seed = 1; seed <= 60; seed++) {
    const round = twin.generateRound(level, seeded(seed * 97 + level.length));
    const [a, b] = round.cards;
    assert.equal(a.length, expected[level][0]); assert.equal(b.length, expected[level][0]);
    assert.equal(a.filter(item => item.kind === 'word').length, expected[level][1]);
    assert.equal(b.filter(item => item.kind === 'word').length, expected[level][1]);
    const shared = a.filter(x => b.some(y => y.id === x.id));
    assert.equal(shared.length, 1, `${level} seed ${seed}`);
    assert.equal(a[round.match[0]].id, round.shared); assert.equal(b[round.match[1]].id, round.shared);
    for (const card of round.cards) assert.equal(new Set(card.map(item => item.id)).size, card.length, 'no symbol repeats on one card');
    // The match is still the same thing by name even when one side is a word and the other an emoji.
    assert.equal(a[round.match[0]].name, b[round.match[1]].name);
    assert.equal(new Set([...names(a), ...names(b)]).size, 2 * expected[level][0] - 1);
  }
});

test('hard shows some matches as emoji on one card and the word on the other', () => {
  let mixed = 0, wordWord = 0, emojiEmoji = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const round = twin.generateRound('hard', seeded(seed));
    const kinds = round.match.map((item, card) => round.cards[card][item].kind).sort().join('/');
    if (kinds === 'emoji/word') mixed++; else if (kinds === 'word/word') wordWord++; else emojiEmoji++;
  }
  assert.ok(mixed > 20 && wordWord > 5 && emojiEmoji > 5, `${mixed} ${wordWord} ${emojiEmoji}`);
});

test('items are different sizes, randomly rotated, inside the circle and never touching, even long rotated words', () => {
  const sizes = new Set(), rotations = new Set();
  let worstGap = Infinity, longestWord = 0;
  for (const level of ['easy', 'medium', 'hard']) for (let seed = 1; seed <= 80; seed++) {
    for (const card of twin.generateRound(level, seeded(seed * 31 + 7)).cards) {
      for (const [i, item] of card.entries()) {
        sizes.add(item.size); rotations.add(item.rot);
        assert.ok(item.rot >= 0 && item.rot < 360 && Number.isInteger(item.rot));
        assert.ok(twin.edgeRoom(item) >= 0, `${level} ${item.label} pokes out of the card`);
        if (item.kind === 'word') longestWord = Math.max(longestWord, item.label.length);
        for (const other of card.slice(i + 1)) worstGap = Math.min(worstGap, twin.clearance(item, other));
      }
    }
  }
  assert.ok(worstGap >= 0.05 - 1e-9, `closest pair is only ${worstGap.toFixed(3)} apart`);
  assert.ok(sizes.size > 30 && rotations.size > 200, 'sizes and rotations vary');
  assert.ok(longestWord >= 7, 'long words such as elephant and scissors are laid out too');
});

test('items are spread over the card instead of bunched together', () => {
  let spread = 0, cards = 0;
  for (let seed = 1; seed <= 100; seed++) for (const card of twin.generateRound('medium', seeded(seed)).cards) {
    // Average distance from the centre: bunched items sit near 0, well-spread items reach towards the rim.
    spread += card.reduce((sum, item) => sum + Math.hypot(item.x, item.y), 0) / card.length; cards++;
  }
  assert.ok(spread / cards > 0.5, `average distance from centre is only ${(spread / cards).toFixed(2)}`);
});

function started(level = 'easy') {
  const game = twin.newGame(level), players = ['Ana', 'Bo'].map((name, i) => twin.newPlayer(`k${i}`, `spotter-${i + 1}`, name));
  twin.startRound(game, players, 1000, { level });
  assert.equal(game.phase, 'playing');
  return { game, players };
}

test('the next pair replaces only the clicked card, and the new card shares exactly one symbol with the one that stays', () => {
  for (const level of ['easy', 'medium', 'hard']) for (let seed = 1; seed <= 30; seed++) {
    const random = seeded(seed * 13 + level.length);
    let puzzle = twin.generateRound(level, random);
    for (let step = 0; step < 6; step++) {
      const replace = step % 2 === (seed % 2), kept = puzzle.cards[1 - Number(replace)];
      const next = twin.generateNext(puzzle, Number(replace), random);
      assert.deepEqual(next.cards[1 - Number(replace)], kept, 'the other card is untouched, layout and all');
      assert.notDeepEqual(next.cards[Number(replace)], puzzle.cards[Number(replace)]);
      const [a, b] = next.cards;
      assert.equal(a.length, b.length);
      assert.equal(a.filter(x => b.some(y => y.id === x.id)).length, 1, `${level} seed ${seed} step ${step}`);
      assert.notEqual(next.shared, puzzle.shared, 'the answer changes every pair');
      assert.equal(a[next.match[0]].id, next.shared); assert.equal(b[next.match[1]].id, next.shared);
      assert.equal(next.cards[Number(replace)].filter(item => item.kind === 'word').length, twin.LEVELS[level].words);
      for (const card of next.cards) assert.equal(new Set(card.map(item => item.id)).size, card.length);
      puzzle = next;
    }
  }
});

test('a correct click remembers which card to replace, a skip replaces one at random, and a new level deals two new cards', () => {
  const { game, players } = started('medium');
  const before = JSON.stringify(game.puzzle.cards);
  assert.ok(twin.pick(game, players[0], 1, game.puzzle.match[1], 5000).hit);
  assert.equal(game.replace, 1);
  const kept = JSON.stringify(game.puzzle.cards[0]);
  twin.startRound(game, players, 9000, { level: 'medium', keepScores: true, continuing: true });
  assert.equal(JSON.stringify(game.puzzle.cards[0]), kept); assert.notEqual(JSON.stringify(game.puzzle.cards), before);
  const skipped = started('easy'); const keptLeft = JSON.stringify(skipped.game.puzzle.cards[0]);
  assert.ok(twin.skip(skipped.game, 3000, () => 0.9)); assert.equal(skipped.game.replace, 1);
  twin.startRound(skipped.game, skipped.players, 6000, { level: 'easy', continuing: true });
  assert.equal(JSON.stringify(skipped.game.puzzle.cards[0]), keptLeft);
  const level = started('easy');
  twin.pick(level.game, level.players[0], 0, level.game.puzzle.match[0], 5000);
  twin.startRound(level.game, level.players, 9000, { level: 'hard', continuing: true });
  assert.equal(level.game.level, 'hard'); assert.equal(level.game.puzzle.cards[0].length, 7); assert.equal(level.game.puzzle.cards[1].length, 7);
  assert.equal(level.game.puzzle.cards[1].filter(item => item.kind === 'word').length, 3, 'a level change deals two brand-new hard cards');
});

test('only the server judges clicks: either copy of the match scores once, wrong clicks deduct and lock', () => {
  const { game, players: [a, b] } = started('medium');
  const wrong = game.puzzle.cards[0].findIndex(item => item.id !== game.puzzle.shared);
  assert.deepEqual(twin.pick(game, a, 0, wrong, 2000), { ok: true, hit: false, penalty: twin.MISS_PENALTY });
  assert.equal(a.score, -25); assert.equal(a.misses, 1);
  assert.equal(twin.pick(game, a, 1, game.puzzle.match[1], 2500).reason, 'locked');
  for (const bad of [[2, 0], [0, -1], [0, 99], [0, 1.5], ['0', 0], [0, undefined]]) assert.equal(twin.pick(game, b, ...bad, 3000).ok, false);
  const hit = twin.pick(game, b, 1, game.puzzle.match[1], 1200);
  assert.equal(hit.hit, true); assert.ok(hit.points >= twin.BASE_POINTS.medium && hit.points <= twin.BASE_POINTS.medium + 50);
  assert.equal(game.phase, 'revealed'); assert.equal(game.winner, b.id);
  assert.equal(twin.pick(game, a, 0, game.puzzle.match[0], 9000).ok, false, 'a revealed pair cannot be clicked again');
});

test('clicking the match on card one or card two both score, and harder levels pay more', () => {
  const left = started('easy'), right = started('hard');
  assert.ok(twin.pick(left.game, left.players[0], 0, left.game.puzzle.match[0], 5000).hit);
  assert.ok(twin.pick(right.game, right.players[0], 1, right.game.puzzle.match[1], 5000).hit);
  assert.ok(right.players[0].score > left.players[0].score);
});

test('the public state never names the match until it is revealed, and skipping scores nothing', () => {
  const { game, players: [a] } = started('hard');
  const view = twin.publicGame(game, 2000), text = JSON.stringify(view);
  assert.equal(view.match, null); assert.equal(view.winner, null);
  for (const key of ['"id"', 'shared', '"sym"']) assert.equal(text.includes(key), false, key);
  assert.equal(twin.publicGame(twin.newGame('easy'), 0).cards.length, 0, 'no cards before the round starts');
  assert.equal(twin.skip(game, 3000), true);
  assert.deepEqual(twin.publicGame(game, 3001).match, game.puzzle.match);
  assert.equal(a.score, 0);
  assert.equal(twin.skip(game, 3002), false);
});

test('a shared room ranks everyone live, deals the next pair on its own, and lets spectators only watch', async t => {
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => { clients.forEach(client => client.terminate()); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  let arcade = '';
  const join = async label => {
    const states = [], client = new WebSocket(`ws://127.0.0.1:${server.address().port}/?room=twinspot&client=${label}&game=/twinspot${arcade ? `&arcade=${arcade}` : ''}`);
    clients.push(client);
    client.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'arcadeRooms' && !arcade) arcade = message.currentRoom;
      if (message.type === 'twinState') states.push(message);
    });
    await new Promise(resolve => client.once('open', resolve));
    await waitFor(() => states.length > 0 && arcade);
    return { client, states, last: () => states.at(-1) };
  };
  const self = state => state.players.find(player => player.id === state.selfId);
  // Players find the match the way a person does: the same name on both cards.
  const spot = state => { for (const [i, a] of state.cards[0].entries()) { const j = state.cards[1].findIndex(b => b.name === a.name); if (j >= 0) return { card: i % 2, item: i % 2 ? j : i, i, j }; } };
  const one = await join('spotter-aaaa1111'), two = await join('spotter-bbbb2222');
  await waitFor(() => one.last().phase === 'playing' && two.last().players.length === 2);
  assert.equal(one.last().cards[0].length, 5); assert.equal(one.last().role, 'player');
  assert.equal(JSON.stringify(one.last().cards).includes('"id"'), false, 'cards never carry symbol ids');

  const first = one.last();
  const wrongItem = first.cards[0].findIndex(item => !first.cards[1].some(other => other.name === item.name));
  two.client.send(JSON.stringify({ type: 'pick', card: 0, item: wrongItem }));
  await waitFor(() => self(two.last()).score === -twin.MISS_PENALTY);
  const hit = spot(first);
  one.client.send(JSON.stringify({ type: 'pick', card: 0, item: hit.i, score: 99999 }));
  await waitFor(() => one.last().phase === 'revealed' && one.last().winner === one.last().selfId);
  const scored = self(one.last()).score;
  assert.ok(scored >= 100 && scored <= 150);
  assert.deepEqual(one.last().players.map(player => player.score), [scored, -twin.MISS_PENALTY], 'sorted live ranking');
  await waitFor(() => one.last().phase === 'playing' && one.last().round === first.round + 1, 5000);
  assert.equal(self(one.last()).score, scored, 'the next pair keeps the ranking');
  assert.deepEqual(one.last().cards[1], first.cards[1], 'the card that was not clicked stays on the table');
  assert.notDeepEqual(one.last().cards[0], first.cards[0], 'the clicked card is replaced');

  two.client.send(JSON.stringify({ type: 'level', level: 'hard' }));
  await waitFor(() => one.last().level === 'hard' && one.last().cards[0].length === 7 && self(one.last()).score === 0);
  assert.equal(one.last().cards[0].filter(item => item.kind === 'word').length, 3);
  await new Promise(resolve => setTimeout(resolve, 50));
  one.client.send(JSON.stringify({ type: 'skip' }));
  await waitFor(() => one.last().phase === 'revealed' && one.last().winner === null && one.last().match);

  // Anyone beyond the room's player cap only watches.
  const crowd = [];
  for (let i = 0; i < twin.MAX_PLAYERS - 1; i++) crowd.push(await join(`spotter-crowd${String(i).padStart(4, '0')}`));
  const watcher = await join('spotter-late00001');
  await waitFor(() => watcher.last().role === 'spectator');
  const before = one.last().level;
  watcher.client.send(JSON.stringify({ type: 'level', level: 'easy' })); watcher.client.send(JSON.stringify({ type: 'reset' }));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(one.last().level, before);
});

async function waitFor(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for condition');
}
