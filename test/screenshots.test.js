const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GAMES, dimensions, checkShowcase } = require('../scripts/capture-screenshots');

test('all nine README previews share source and thumbnail dimensions', () => {
  const result = checkShowcase();
  assert.equal(result.count, 9);
  assert.equal(result.width / result.height, 16 / 9);
  assert.equal(new Set(GAMES).size, 9);
});

test('screenshot dimension reader rejects a disguised or corrupt PNG', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-screenshot-test-'));
  try {
    const file = path.join(temporary, 'fake.png');
    fs.writeFileSync(file, '<svg width="1280" height="720"></svg>');
    assert.throws(() => dimensions(file), /Invalid PNG/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

function showcaseFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-showcase-test-'));
  try {
    fs.mkdirSync(path.join(root, 'public/screenshots'), { recursive: true });
    for (const game of GAMES) fs.writeFileSync(path.join(root, `public/screenshots/${game}.svg`), '<svg width="1280" height="720"></svg>');
    fs.writeFileSync(path.join(root, 'README.md'), GAMES.map(game => `<img src="public/screenshots/${game}.svg" width="320" height="180">`).join('\n'));
    run(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('showcase check rejects mixed thumbnail sizes', () => {
  showcaseFixture(root => {
    const readme = path.join(root, 'README.md');
    fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace('width="320"', 'width="640"'));
    assert.throws(() => checkShowcase(root), /thumbnail must be 320×180/);
  });
});

test('showcase check rejects mixed source sizes even with matching aspect ratios', () => {
  showcaseFixture(root => {
    fs.writeFileSync(path.join(root, 'public/screenshots/poll.svg'), '<svg width="1920" height="1080"></svg>');
    assert.throws(() => checkShowcase(root), /source dimensions differ/);
  });
});

test('showcase check requires every experience exactly once', () => {
  showcaseFixture(root => {
    const readme = path.join(root, 'README.md');
    fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace('poll.svg', 'board.svg'));
    assert.throws(() => checkShowcase(root), /Unknown or duplicate screenshot/);
  });
});
