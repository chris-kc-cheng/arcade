// Builds lib/typohunt-bank.json: 500, 400, 300, 200 and 100 distinct questions for Typo Hunt levels 1 to 5, from the rule-based generator.
// The bank is deterministic (seeded), so rerunning this script only changes the file when the sentence or rule tables change.
// Usage: node scripts/generate-typohunt-bank.js
const fs = require('node:fs');
const path = require('node:path');
const hunt = require('../lib/typohunt');

// Questions per level: plenty at the easy levels, fewer where each question is longer and harder to author by rule.
const PER_LEVEL = { 1: 500, 2: 400, 3: 300, 4: 200, 5: 100 };
function seeded(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const bank = {};
for (let level = 1; level <= 5; level++) {
  const random = seeded(level * 7919), seen = new Set(), entries = [], usage = {};
  for (let attempt = 0; entries.length < PER_LEVEL[level]; attempt++) {
    if (attempt > 200000) throw new Error(`Could not find ${PER_LEVEL[level]} distinct level ${level} questions; add sentences to lib/typohunt.js`);
    const puzzle = hunt.generatePuzzle(level, random, usage), entry = hunt.toEntry(puzzle), key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key); entries.push(entry);
    // Remember which right-to-wrong patterns have been used, so later questions favour the rarer ones.
    for (const mistake of puzzle.mistakes) { const pair = `${mistake.right.replace(/[^A-Za-z']/g, '').toLowerCase()}>${mistake.wrong.replace(/[^A-Za-z']/g, '').toLowerCase()}`; usage[pair] = (usage[pair] || 0) + 1; }
  }
  bank[level] = entries;
}
const file = path.join(__dirname, '..', 'lib', 'typohunt-bank.json');
fs.writeFileSync(file, JSON.stringify(bank) + '\n');
console.log(`Wrote ${Object.values(bank).reduce((sum, list) => sum + list.length, 0)} questions to ${file}`);
