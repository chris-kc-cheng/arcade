// Flight simulator: the only thing the server knows about a plane is where it is. Each pilot flies their own plane in the browser
// (physics, buildings and map are all client side) and reports a pose a few times a second; the server checks that it is
// plausible and hands everyone the other planes' poses.
const BOUNDS = { lat: [-90, 90], lon: [-180, 180], alt: [-5, 6000] };  // anywhere on Earth: pilots can land in Toronto, Hong Kong or Tokyo
const MAX_SPEED = 12000;     // metres per second: the fastest a plane can travel, at 100x time compression
const MIN_INTERVAL_MS = 40;  // poses are accepted at most 25 times a second
const SLACK_M = 300;
const COLORS = ['#ffd23f', '#ee4266', '#3bceac', '#0ead69', '#f78c6b', '#7768ae', '#3a86ff', '#ff9f1c'];

const MODELS = ['plane', 'airbus', 'jet', 'drone'];
const finite = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;

// A message from a pilot, checked and cut down to the fields we use, or null.
function cleanFlightMessage(message) {
  if (!message || !['pose', 'respawn'].includes(message.type)) return null;
  if (message.type === 'respawn') return { type: 'respawn' };
  if (!finite(message.lat, ...BOUNDS.lat) || !finite(message.lon, ...BOUNDS.lon) || !finite(message.alt, ...BOUNDS.alt)) return null;
  if (![message.heading, message.pitch, message.roll].every(angle => finite(angle, -7, 7))) return null;
  if (!finite(message.throttle, 0, 1)) return null;
  return { type: 'pose', lat: message.lat, lon: message.lon, alt: message.alt, heading: message.heading, pitch: message.pitch, roll: message.roll, throttle: message.throttle, model: MODELS.includes(message.model) ? message.model : 'plane' };
}

// Metres between two poses on the ground plane, with height.
function distance(a, b) {
  const k = Math.PI / 180 * 6371008.8;
  return Math.hypot((a.lon - b.lon) * k * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * k, a.alt - b.alt);
}

// Whether moving from `previous` to `next` in `elapsedMs` is possible for any plane.
function plausible(previous, next, elapsedMs) {
  if (!previous) return true;
  return distance(previous, next) <= MAX_SPEED * Math.max(0, elapsedMs) / 1000 + SLACK_M;
}

const publicPlane = plane => ({ id: plane.id, name: plane.name, color: plane.color, lat: plane.pose.lat, lon: plane.pose.lon, alt: plane.pose.alt, heading: plane.pose.heading, pitch: plane.pose.pitch, roll: plane.pose.roll, throttle: plane.pose.throttle, model: plane.pose.model || 'plane' });

module.exports = { MODELS, BOUNDS, MAX_SPEED, MIN_INTERVAL_MS, SLACK_M, COLORS, cleanFlightMessage, distance, plausible, publicPlane };
