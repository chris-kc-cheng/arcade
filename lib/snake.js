const SNAKE_COLS = 36;
const SNAKE_ROWS = 25;

const SNAKE_STARTS = [
  { x: 6, y: 6, dx: 1, dy: 0 },
  { x: 29, y: 18, dx: -1, dy: 0 },
  { x: 29, y: 6, dx: -1, dy: 0 },
  { x: 6, y: 18, dx: 1, dy: 0 },
  { x: 18, y: 6, dx: 0, dy: 1 },
  { x: 18, y: 18, dx: 0, dy: -1 },
];

function snakeBodyAt(start, length = 5) {
  return Array.from({ length }, (_, index) => ({
    x: start.x - start.dx * index,
    y: start.y - start.dy * index,
  }));
}

function chooseSnakeSpawn(players, random = Math.random) {
  const occupied = new Set(
    players.flatMap((player) => player.body ?? []).map(({ x, y }) => `${x},${y}`),
  );
  const available = SNAKE_STARTS.filter((start) =>
    snakeBodyAt(start).every(({ x, y }) => !occupied.has(`${x},${y}`)),
  );

  if (available.length === 0) return null;
  return available[Math.floor(random() * available.length)];
}

function cleanSnakeAction(message) {
  if (!message || typeof message !== "object") return null;
  if (["snakeStart", "snakeReset", "snakeTogglePause"].includes(message.type)) {
    return { type: message.type };
  }
  if (
    message.type === "snakeInput"
    && Number.isInteger(message.x)
    && Number.isInteger(message.y)
    && Math.abs(message.x) + Math.abs(message.y) === 1
  ) {
    return { type: message.type, x: message.x, y: message.y };
  }
  return null;
}

module.exports = {
  SNAKE_COLS,
  SNAKE_ROWS,
  SNAKE_STARTS,
  snakeBodyAt,
  chooseSnakeSpawn,
  cleanSnakeAction,
};
