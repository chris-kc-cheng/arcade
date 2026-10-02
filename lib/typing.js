const paragraphs = {
  easy: 'A bright red kite danced above the park. Mia held the string and laughed as the wind carried it over the green trees.',
  medium: 'Every Saturday, the neighbors meet beside the community garden. They trade seeds, water the tomatoes, and share stories while butterflies visit the flowers.',
  hard: 'Curiosity turns an ordinary afternoon into an adventure: a puddle reflects the clouds, a spider builds precise patterns, and each small discovery invites another thoughtful question.'
};

function typingStats(player, paragraph, now = Date.now()) {
  const elapsedMs = Math.max(1, (player.finishedAt || now) - player.startedAt);
  const accuracy = player.keystrokes ? player.correctKeystrokes / player.keystrokes * 100 : 100;
  const cpm = paragraph.length / elapsedMs * 60000;
  const wps = paragraph.trim().split(/\s+/).length / elapsedMs * 1000;
  return { timeMs: elapsedMs, accuracy: Math.round(accuracy * 10) / 10, backspaces: player.backspaces, cpm: Math.round(cpm), wps: Math.round(wps * 100) / 100, score: Math.max(0, Math.round(cpm / 250 * accuracy)) };
}

module.exports = { paragraphs, typingStats };
