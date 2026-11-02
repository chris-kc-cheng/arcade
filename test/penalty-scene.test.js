const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.resolve(__dirname, '../src/penalty-scene.mjs')).href);
const near = (actual, expected, message, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not ${expected}`);

test('the pitch uses the dimensions in the Laws of the Game', async () => {
  const { FIFA } = await load();
  assert.equal(FIFA.goalWidth, 7.32); assert.equal(FIFA.goalHeight, 2.44);
  assert.equal(FIFA.goalAreaDepth, 5.5); assert.equal(FIFA.penaltyAreaDepth, 16.5);
  assert.equal(FIFA.penaltyMark, 11); assert.equal(FIFA.arcRadius, 9.15);
  assert.ok(FIFA.lineWidth <= 0.12 && FIFA.postWidth <= 0.12, 'lines and posts are at most 12 cm wide');
  assert.equal(FIFA.markDiameter, 0.22); assert.ok(FIFA.ballDiameter >= 0.216 && FIFA.ballDiameter <= 0.223, 'a size 5 ball is about 22 cm');
});

test('the goal area, penalty area, penalty mark and crescent are where FIFA puts them', async () => {
  const { pitchMarkings, FIFA } = await load();
  const { lines, arcAngle } = pitchMarkings(), half = FIFA.goalWidth / 2;
  const extent = points => ({ xs: points.map(p => p[0]), zs: points.map(p => p[1]) });
  // The goal area is 5.5 m from each post and 5.5 m deep.
  const front6 = extent(lines.goalAreaFront);
  near(Math.min(...front6.xs), -(half + 5.5), 'goal area left'); near(Math.max(...front6.xs), half + 5.5, 'goal area right');
  front6.zs.forEach(z => near(z, 5.5, 'goal area front line'));
  extent(lines.goalAreaLeft).xs.forEach(x => near(x, -(half + 5.5), 'goal area side')); near(Math.max(...extent(lines.goalAreaLeft).zs), 5.5, 'goal area depth');
  // The penalty area is 16.5 m from each post and 16.5 m deep.
  const front18 = extent(lines.penaltyAreaFront);
  near(Math.min(...front18.xs), -(half + 16.5), 'penalty area left'); near(Math.max(...front18.xs), half + 16.5, 'penalty area right');
  front18.zs.forEach(z => near(z, 16.5, 'penalty area front line'));
  near(Math.max(...extent(lines.penaltyAreaRight).zs), 16.5, 'penalty area depth'); extent(lines.penaltyAreaRight).xs.forEach(x => near(x, half + 16.5, 'penalty area side'));
  // The penalty arc has a 9.15 m radius from the mark (11 m out), and is drawn only outside the penalty area.
  for (const [x, z] of lines.penaltyArc) {
    near(Math.hypot(x, z - FIFA.penaltyMark), 9.15, 'every arc point is 9.15 m from the mark', 1e-9);
    assert.ok(z >= 16.5 - 1e-9, `the arc must not enter the penalty area (z=${z})`);
  }
  const arc = lines.penaltyArc;
  near(arc[0][1], 16.5, 'the arc starts on the 16.5 m line'); near(arc.at(-1)[1], 16.5, 'the arc ends on the 16.5 m line');
  near(Math.max(...arc.map(p => p[1])), 11 + 9.15, 'the arc reaches 20.15 m from the goal line'); near(arc[0][0], -arc.at(-1)[0], 'the arc is symmetrical');
  near(arcAngle * 180 / Math.PI, Math.acos(5.5 / 9.15) * 180 / Math.PI, 'the arc spans the angle where it meets the area line');
});

test('the ball starts on the penalty mark, 11 m out on the line through the middle of the goal, and ends in the goal', async () => {
  const { ballAt, zoneTargets, zoneAreas, spot, project, FIFA } = await load();
  for (const zone of Object.keys(zoneTargets)) {
    const start = ballAt(zone, 0), end = ballAt(zone, 1), [x0, y0, x1, y1] = zoneAreas[zone];
    near(start.x, 0, 'starts on the centre line'); near(start.z, 11, 'starts at the penalty mark'); near(start.y, FIFA.ballDiameter / 2, 'sits on the grass');
    near(end.z, 0, 'arrives at the goal line');
    assert.ok(end.x >= x0 && end.x <= x1 && end.y >= y0 && end.y <= y1, `${zone}: the kick ends inside its zone of the goal`);
    assert.ok(Math.abs(end.x) < FIFA.goalWidth / 2 && end.y < FIFA.goalHeight, `${zone}: and between the posts and under the bar`);
  }
  near(spot().x, project(0, 0, 11).x, 'the mark is drawn on the centre line');
});

test('the five zones tile the goal mouth, with the centre zone covering the middle third', async () => {
  const { zoneAreas, FIFA } = await load();
  const half = FIFA.goalWidth / 2;
  let area = 0;
  for (const [x0, y0, x1, y1] of Object.values(zoneAreas)) { assert.ok(x0 >= -half && x1 <= half && y0 >= 0 && y1 <= FIFA.goalHeight); area += (x1 - x0) * (y1 - y0); }
  near(area, FIFA.goalWidth * FIFA.goalHeight, 'zones cover the whole mouth with no gaps or overlaps', 1e-9);
  const [cx0, , cx1] = zoneAreas.center; near(cx1 - cx0, FIFA.goalWidth / 3, 'the centre zone is a third of the width');
});

test('perspective: things nearer the camera are bigger, the picture is symmetrical, and lines converge towards the goal', async () => {
  const { project, FIFA } = await load();
  assert.ok(project(0, 0, 0).scale < project(0, 0, 11).scale && project(0, 0, 11).scale < project(0, 0, 16.5).scale);
  near(project(-5, 1, 8).x + project(5, 1, 8).x, 1000, 'mirror images about the centre of the picture', 1e-6);
  const width = z => project(FIFA.goalWidth / 2 + FIFA.penaltyAreaDepth, 0, z).x - project(-(FIFA.goalWidth / 2 + FIFA.penaltyAreaDepth), 0, z).x;
  assert.ok(width(16.5) > width(0), 'the penalty area is wider on screen near the camera than at the goal line');
  assert.ok(project(0, 0, 0).y < project(0, 0, 11).y && project(0, 0, 11).y < project(0, 0, 16.5).y, 'the goal line is highest, then the mark, then the 18-yard line');
});

test('the tracker marks a goal with O and a save with X, and sudden death adds slots', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/penalty-view.jsx'), 'utf8');
  assert.match(source, /value === true \? 'O' : value === false \? 'X' : ''/);
  assert.match(source, /Math\.max\(5,/);
  assert.match(source, /aria-label=\{`Kick \$\{i \+ 1\}: \$\{label\}`\}/);
  const server = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
  assert.match(server, /const goal = target !== dive;/, 'a kick is a goal unless the keeper dived to the zone it was aimed at');
});
