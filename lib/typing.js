const paragraphs = {
  easy: [
    'A bright red kite danced above the park. Mia held the string and laughed as the wind carried it over the green trees.',
    'Sam packed a small lunch and walked to the lake. Ducks glided past the reeds while warm sunlight sparkled on the water.',
    'The little bakery opened early each day. Fresh bread filled the street with a cozy smell, and neighbors stopped to say hello.',
    'Clouds drifted over the quiet town as Leo rode his blue bike home. He waved to friends and rang his bell at every corner.'
  ],
  medium: [
    'Every Saturday, the neighbors meet beside the community garden. They trade seeds, water the tomatoes, and share stories while butterflies visit the flowers. Before lunch, everyone chooses a basket of vegetables to carry home and turns the soil for next week.',
    'At the edge of town, an old railway station has become a busy library. Travelers now arrive through the pages of books instead of on trains. Children read beneath the clock, while volunteers recommend mysteries, adventures, and histories to curious visitors.',
    'When the afternoon storm finally passed, the hiking group stepped carefully onto the trail. Drops shone on every leaf, birds called from the branches, and the cool air smelled of pine. They reached the overlook just as sunlight returned across the valley.',
    'Our science club built a tiny weather station behind the school. Each morning, students record the temperature, wind, and rainfall, then compare their notes with the forecast. Over time, their colorful charts reveal patterns that nobody noticed before.'
  ],
  hard: [
    'Curiosity can turn an ordinary afternoon into an unexpected adventure. A shallow puddle reflects a moving gallery of clouds, a patient spider builds precise patterns between two stems, and every small discovery invites another thoughtful question. When we pause long enough to observe these details, familiar places begin to feel entirely new. The cracked pavement becomes a map, the breeze carries evidence of distant rain, and birds exchange signals from rooftops. Careful observation does not require expensive equipment or a faraway destination; it asks only for time, attention, and a willingness to wonder.',
    'Long before sunrise, the harbor begins its complicated daily rhythm. Crews check ropes, engines, radios, and weather reports while vendors arrange boxes of fruit beside the market. A ferry eases away from the pier, leaving a silver wake that widens across the dark water. By the time the first commuters arrive, dozens of quiet decisions have already kept the waterfront moving safely. Mechanics have inspected equipment, dispatchers have adjusted schedules, and cooks have prepared breakfast for people ending an overnight shift. The harbor may appear chaotic from a distance, yet its activity depends on cooperation and routines refined over many years.',
    'Restoring a neglected neighborhood theater demanded more than fresh paint and new seats. Volunteers first studied old photographs, interviewed former performers, and labeled every surviving piece of scenery. Engineers strengthened the roof without hiding its original wooden beams, while local artists recreated decorative patterns around the stage. The project moved slowly because each improvement raised another question about history, safety, cost, or accessibility. Rather than treating those questions as obstacles, the team used them to shape a better building. They added ramps and flexible seating, preserved handwritten notes backstage, and converted a storage room into a workshop for students.',
    'A reliable map is both a practical tool and a carefully chosen argument about what matters. Cartographers must decide which roads, boundaries, landmarks, and names deserve attention at a particular scale. If every available detail appeared at once, the result would be accurate in one sense but almost impossible to read. Digital maps add another layer of complexity because they can respond to traffic, location, and personal searches within seconds. That convenience may make the map feel automatic, even though designers, surveyors, software engineers, and local contributors continually revise the information underneath it. Errors still occur when a road closes, a business moves, or two communities use different names for the same place.'
  ]
};

function randomParagraph(difficulty, previous) {
  const choices = paragraphs[difficulty] || paragraphs.easy;
  const alternatives = choices.filter(text => text !== previous);
  const pool = alternatives.length ? alternatives : choices;
  return pool[Math.floor(Math.random() * pool.length)];
}

function typingStats(player, paragraph, now = Date.now()) {
  const elapsedMs = Math.max(1, (player.finishedAt || now) - player.startedAt);
  const accuracy = player.keystrokes ? player.correctKeystrokes / player.keystrokes * 100 : 100;
  const cpm = paragraph.length / elapsedMs * 60000;
  const wps = paragraph.trim().split(/\s+/).length / elapsedMs * 1000;
  return { timeMs: elapsedMs, accuracy: Math.round(accuracy * 10) / 10, backspaces: player.backspaces, cpm: Math.round(cpm), wps: Math.round(wps * 100) / 100, score: Math.max(0, Math.round(cpm / 250 * accuracy)) };
}

module.exports = { paragraphs, randomParagraph, typingStats };
