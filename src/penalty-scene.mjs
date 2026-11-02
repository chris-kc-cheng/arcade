// Geometry for the penalty shootout scene. Everything is laid out in metres on a real pitch (Laws of the Game, Law 1) and then
// projected through a pinhole camera standing behind the penalty mark, so the lines converge the way they do on a broadcast.
//
// World axes: x runs along the goal line (0 is the middle of the goal), y is height, z runs from the goal line towards the camera.
export const FIFA = {
  goalWidth: 7.32,        // inside distance between the posts
  goalHeight: 2.44,       // ground to the underside of the crossbar
  postWidth: 0.12,        // posts, crossbar and every line are at most 12 cm wide
  goalAreaDepth: 5.5,     // the goal area ("six-yard box") is 5.5 m from each post and 5.5 m into the field
  penaltyAreaDepth: 16.5, // the penalty area is 16.5 m from each post and 16.5 m into the field
  penaltyMark: 11,        // the penalty mark is 11 m from the midpoint between the posts, on a line at right angles to the goal line
  markDiameter: 0.22,
  arcRadius: 9.15,        // the penalty arc ("crescent") has a 9.15 m radius from the mark, drawn outside the penalty area only
  ballDiameter: 0.22,     // a size 5 ball is about 22 cm across
  lineWidth: 0.12
};
const HALF_GOAL = FIFA.goalWidth / 2;

// A pinhole camera 30 m from the goal line and 3 m up, tilted down towards the penalty mark.
const camera = { x: 0, y: 3.0, z: 30, focus: { y: 0.9, z: 5 }, f: 1650, cx: 500, cy: -128 };
const pitch = Math.atan2(camera.y - camera.focus.y, camera.z - camera.focus.z);

// World point (x, y, z) to screen { x, y, scale, depth }. `scale` is pixels per metre at that point.
export function project(x, y, z) {
  const rx = x - camera.x, ry = y - camera.y, rz = z - camera.z;
  const cos = Math.cos(pitch), sin = Math.sin(pitch);
  const depth = -(rz * cos - ry * sin);
  const up = ry * cos + rz * sin;
  const scale = camera.f / depth;
  return { x: camera.cx + rx * scale, y: camera.cy - up * scale, scale, depth };
}
const pt = (x, y, z) => { const p = project(x, y, z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };
const poly = points => points.map(([x, y, z]) => pt(x, y, z)).join(' ');

// A painted line is a ribbon of real width lying on the grass, so it thins towards the goal like a real one.
function ribbon(points, width = FIFA.lineWidth) {
  const left = [], right = [];
  points.forEach((point, i) => {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    let dx = after[0] - before[0], dz = after[1] - before[1];
    const length = Math.hypot(dx, dz) || 1; dx /= length; dz /= length;
    left.push([point[0] - dz * width / 2, 0, point[1] + dx * width / 2]);
    right.push([point[0] + dz * width / 2, 0, point[1] - dx * width / 2]);
  });
  return poly([...left, ...right.reverse()]);
}
// Straight and arc lines on the ground, as [x, z] points.
const segment = (x1, z1, x2, z2, steps = 24) => Array.from({ length: steps + 1 }, (_, i) => [x1 + (x2 - x1) * i / steps, z1 + (z2 - z1) * i / steps]);

const FIELD_HALF = 34;
// Every marking, in metres, and the polygon that draws it.
export function pitchMarkings() {
  const areaHalf = HALF_GOAL + FIFA.penaltyAreaDepth, boxHalf = HALF_GOAL + FIFA.goalAreaDepth;
  const arcAngle = Math.acos((FIFA.penaltyAreaDepth - FIFA.penaltyMark) / FIFA.arcRadius);
  const arc = Array.from({ length: 41 }, (_, i) => { const a = -arcAngle + 2 * arcAngle * i / 40; return [Math.sin(a) * FIFA.arcRadius, FIFA.penaltyMark + Math.cos(a) * FIFA.arcRadius]; });
  const lines = {
    goalLine: segment(-FIELD_HALF, 0, FIELD_HALF, 0, 40),
    goalAreaFront: segment(-boxHalf, FIFA.goalAreaDepth, boxHalf, FIFA.goalAreaDepth),
    goalAreaLeft: segment(-boxHalf, 0, -boxHalf, FIFA.goalAreaDepth, 8),
    goalAreaRight: segment(boxHalf, 0, boxHalf, FIFA.goalAreaDepth, 8),
    penaltyAreaFront: segment(-areaHalf, FIFA.penaltyAreaDepth, areaHalf, FIFA.penaltyAreaDepth, 40),
    penaltyAreaLeft: segment(-areaHalf, 0, -areaHalf, FIFA.penaltyAreaDepth, 16),
    penaltyAreaRight: segment(areaHalf, 0, areaHalf, FIFA.penaltyAreaDepth, 16),
    penaltyArc: arc
  };
  const mark = Array.from({ length: 24 }, (_, i) => { const a = Math.PI * 2 * i / 24; return [Math.cos(a) * FIFA.markDiameter / 2, 0, FIFA.penaltyMark + Math.sin(a) * FIFA.markDiameter / 2]; });
  return { lines, polygons: { ...Object.fromEntries(Object.entries(lines).map(([name, points]) => [name, ribbon(points)])), penaltyMark: poly(mark) }, arcAngle };
}

// Alternating bands of cut grass, 5.5 m deep, across the visible pitch (they stop well short of the camera, 30 m out).
export function stripes() {
  const bands = [];
  for (let z = 0, i = 0; z < 22; z += 5.5, i++) bands.push({ dark: i % 2 === 1, points: poly([[-FIELD_HALF, 0, z], [FIELD_HALF, 0, z], [FIELD_HALF, 0, z + 5.5], [-FIELD_HALF, 0, z + 5.5]]) });
  return bands;
}

// The goal frame and net. The net hangs from the crossbar to the ground behind the line, sloping like a real box-shaped goal net.
const NET_TOP = 0.9, NET_BOTTOM = 2.0;
// How far behind the goal line the back of the net is at a given height.
const backDepth = y => NET_BOTTOM + (NET_TOP - NET_BOTTOM) * (y / FIFA.goalHeight);
export function goal() {
  const h = FIFA.goalHeight, w = HALF_GOAL, t = FIFA.postWidth;
  const frame = [
    poly([[-w - t, 0, 0], [-w, 0, 0], [-w, h + t, 0], [-w - t, h + t, 0]]),
    poly([[w, 0, 0], [w + t, 0, 0], [w + t, h + t, 0], [w, h + t, 0]]),
    poly([[-w - t, h, 0], [w + t, h, 0], [w + t, h + t, 0], [-w - t, h + t, 0]])
  ];
  const line = (a, b) => [pt(...a), pt(...b)];
  const back = [], roof = [], sides = [];
  for (let i = 0; i <= 22; i++) { const x = -w + 2 * w * i / 22; back.push(line([x, h, -NET_TOP], [x, 0, -NET_BOTTOM])); roof.push(line([x, h, 0], [x, h, -NET_TOP])); }
  for (let j = 0; j <= 9; j++) { const y = h * j / 9; back.push(line([-w, y, -backDepth(y)], [w, y, -backDepth(y)])); }
  for (let j = 0; j <= 5; j++) { const z = NET_TOP * j / 5; roof.push(line([-w, h, -z], [w, h, -z])); }
  for (const side of [-w, w]) {
    for (let j = 0; j <= 9; j++) { const y = h * j / 9; sides.push(line([side, y, 0], [side, y, -backDepth(y)])); }
    for (let j = 1; j <= 8; j++) { const z = NET_BOTTOM * j / 8, top = z <= NET_TOP ? h : h * (NET_BOTTOM - z) / (NET_BOTTOM - NET_TOP); sides.push(line([side, 0, -z], [side, top, -z])); }
  }
  return { frame, net: { back, roof, sides }, mouth: { topLeft: project(-w, h, 0), topRight: project(w, h, 0), bottomLeft: project(-w, 0, 0), bottomRight: project(w, 0, 0) } };
}

// Where each aiming zone is in the goal, as [x, y] in metres. The centre zone covers the middle third from top to bottom.
export const zoneTargets = {
  'top-left': [-2.55, 1.85], 'top-right': [2.55, 1.85], center: [0, 1.15], 'bottom-left': [-2.55, 0.5], 'bottom-right': [2.55, 0.5]
};
// The rectangle each zone occupies in the goal mouth, in metres: [x0, y0, x1, y1].
export const zoneAreas = {
  'top-left': [-HALF_GOAL, FIFA.goalHeight / 2, -HALF_GOAL / 3, FIFA.goalHeight], 'top-right': [HALF_GOAL / 3, FIFA.goalHeight / 2, HALF_GOAL, FIFA.goalHeight],
  center: [-HALF_GOAL / 3, 0, HALF_GOAL / 3, FIFA.goalHeight], 'bottom-left': [-HALF_GOAL, 0, -HALF_GOAL / 3, FIFA.goalHeight / 2], 'bottom-right': [HALF_GOAL / 3, 0, HALF_GOAL, FIFA.goalHeight / 2]
};
export const zonePolygon = zone => { const [x0, y0, x1, y1] = zoneAreas[zone]; return poly([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]); };

// The ball at time t (0 to 1) of a kick from the penalty mark to a point in the goal: a fast, slightly rising strike.
export function ballAt(zone, t) {
  const [tx, ty] = zoneTargets[zone], z = FIFA.penaltyMark * (1 - t);
  const y = FIFA.ballDiameter / 2 + (ty - FIFA.ballDiameter / 2) * t + Math.sin(Math.PI * t) * 0.25;
  return { x: tx * t, y, z };
}
export const spot = () => project(0, FIFA.ballDiameter / 2, FIFA.penaltyMark);
export const ground = (x, z) => project(x, 0, z);
export const view = { width: 1000, height: 590 };
