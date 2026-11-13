const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const Physics = require('../public/flight-physics.js');
const OSM = require('../public/flight-osm.js');
const flight = require('../lib/flight.js');

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (±${tolerance})`);
const FLAT = { surface: () => 'runway', obstacle: () => null };
const degrees = radians => radians * 180 / Math.PI;

// ---- the flight model ------------------------------------------------------------------------------------------------------

test('the stick works like a real one: forward (W / Up) points the nose down, back (S / Down) points it up', () => {
  const run = elevator => { const plane = Physics.approach({ x: 0, z: 0, heading: Math.PI / 2 }); const start = plane.pitch; Physics.advance(plane, { elevator }, 2, FLAT); return degrees(plane.pitch - start); };
  assert.ok(run(-1) < -8, 'W / Up (elevator -1) pitches the nose down');
  assert.ok(run(1) > 8, 'S / Down (elevator +1) pitches the nose up');
  assert.ok(Math.abs(run(0)) < 1.5, 'a centred stick holds the attitude');
  const source = fs.readFileSync(path.resolve(__dirname, '../public/flight.js'), 'utf8');
  assert.match(source, /KeyW: 'noseDown', ArrowUp: 'noseDown', KeyS: 'noseUp', ArrowDown: 'noseUp'/);
  assert.match(source, /elevator: axis\('noseUp', 'noseDown'\) \* gain/);
});

test('banking turns the plane, and a trimmed plane settles into a gentle glide', () => {
  const plane = Physics.approach({ x: 0, z: 0, heading: Math.PI / 2 });
  Physics.advance(plane, { elevator: 0 }, 40, FLAT);
  assert.ok(degrees(plane.gamma) > -4 && degrees(plane.gamma) < -1.5, `a hands-off glide of about 3 degrees, got ${degrees(plane.gamma).toFixed(1)}`);
  near(plane.speed, 40, 5, 'and about 40 m/s');
  const turning = Physics.approach({ x: 0, z: 0, heading: Math.PI / 2 }); const before = turning.heading;
  Physics.advance(turning, { aileron: 1 }, 6, FLAT);
  assert.ok(turning.roll > 0.5, 'right aileron banks right'); assert.ok(turning.heading > before + 0.2, 'and turns the plane to the right');
});

test('pulling too hard stalls the wing, and the plane sinks', () => {
  const plane = Physics.create({ y: 800, speed: 30, gamma: 0, pitch: 0.1, throttle: 0.3, onGround: false });
  Physics.advance(plane, { elevator: 1 }, 6, FLAT);
  assert.equal(plane.stalled, true); assert.ok(plane.aoa > Physics.PLANE.stallAlpha);
  assert.ok(plane.gamma < 0.1, 'it cannot keep climbing in a stall');
});

test('throttle changes the speed and the climb', () => {
  const run = throttle => { const plane = Physics.create({ y: 500, speed: 45, pitch: 0.09, throttle, onGround: false }); Physics.advance(plane, { elevator: 0 }, 20, FLAT); return plane; };
  assert.ok(run(1).verticalSpeed > run(0).verticalSpeed + 3, 'full power climbs better than idle');
});

test('time compression gives the same flight in fewer, larger frames', () => {
  const a = Physics.approach({ x: 0, z: 0, heading: 1 }), b = Physics.approach({ x: 0, z: 0, heading: 1 });
  Physics.advance(a, { elevator: 0 }, 60, FLAT);                        // one 60 s frame, as at 100x
  for (let i = 0; i < 600; i++) Physics.advance(b, { elevator: 0 }, 0.1, FLAT); // sixty seconds in tenths
  near(a.x, b.x, 30, 'position x'); near(a.y, b.y, 4, 'height'); near(a.speed, b.speed, 0.5, 'speed');
});

// A pilot that flies the glide slope, flares and lands.
function fly(plane, world, target, seconds = 400) {
  let t = 0;
  while (!plane.onGround && !plane.crashed && t < seconds) {
    const along = (target.x - plane.x) * Math.sin(target.heading) + (target.z - plane.z) * Math.cos(target.heading);
    const wanted = 15 + Math.tan(3 * Math.PI / 180) * Math.max(0, along), flaring = plane.y < 12;
    const gammaCommand = flaring ? Math.asin(-0.7 / Math.max(plane.speed, 20)) : -3 * Math.PI / 180 - Math.max(-0.035, Math.min(0.035, (plane.y - wanted) * 0.0016));
    const elevator = Math.max(-1, Math.min(1, (gammaCommand - plane.gamma) * 9));
    Physics.advance(plane, { elevator, throttleRate: flaring ? -1 : plane.speed < 40 ? 0.3 : -0.3 }, 0.05, world); t += 0.05;
  }
  return plane;
}

test('a stable approach lands on the runway and rolls to a stop', () => {
  const target = { x: 0, z: 0, heading: Math.PI / 2 };
  const world = { surface: x => x > -50 && x < 1500 ? 'runway' : 'water', obstacle: () => null };
  const plane = fly(Physics.approach({ ...target, distance: 5200 }), world, target);
  assert.equal(plane.crashed, null, plane.crashed || ''); assert.equal(plane.onGround, true); assert.equal(plane.surface, 'runway');
  for (let i = 0; i < 6000 && plane.speed > 0.3; i++) Physics.advance(plane, { brake: true }, 0.05, world);
  assert.ok(plane.speed < 0.5 && !plane.crashed, 'the brakes stop it on the runway');
});

test('a hard landing, a dive, the water and a building are all crashes', () => {
  assert.match(Physics.advance(Physics.create({ y: 8, speed: 40, gamma: -0.4, pitch: -0.3, onGround: false }), { elevator: -1 }, 5, FLAT).crashed, /Hard landing|nose/);
  const water = { surface: () => 'water', obstacle: () => null };
  assert.match(Physics.advance(Physics.create({ y: 20, speed: 38, gamma: -0.1, pitch: 0, onGround: false }), {}, 20, water).crashed, /water/);
  const tower = { surface: () => 'land', obstacle: (x, y) => x > 100 && y < 80 ? { height: 80 } : null };
  assert.match(Physics.advance(Physics.create({ x: 0, y: 40, speed: 50, heading: Math.PI / 2, pitch: 0.05, gamma: 0, onGround: false }), {}, 20, tower).crashed, /building/);
});

test('a plane can take off from the runway: full power, then stick back at rotation speed', () => {
  const plane = Physics.create({ heading: Math.PI / 2, throttle: 1 });
  const world = { surface: () => 'runway', obstacle: () => null };
  let t = 0; while (plane.onGround && t < 60) { Physics.advance(plane, { elevator: plane.speed > Physics.PLANE.rotateSpeed ? 1 : 0, throttleRate: 1 }, 0.05, world); t += 0.05; }
  assert.equal(plane.onGround, false, 'it leaves the ground'); assert.ok(plane.speed > 24 && plane.speed < 40, `at a sensible speed (${plane.speed.toFixed(1)})`); assert.ok(plane.x > 150 && plane.x < 1100, 'within the runway length');
});

// ---- reading OpenStreetMap -------------------------------------------------------------------------------------------------

// Real OpenStreetMap geometry for runway 08/26 (way 5687568) and 06/24 (way 7769081) at CYTZ, as the Overpass API returns it.
const geometry = nodes => nodes.map(([lat, lon]) => ({ lat, lon }));
const AIRPORT_JSON = { elements: [
  { type: 'relation', id: 85471, tags: { aeroway: 'aerodrome', icao: 'CYTZ', name: 'Billy Bishop Toronto City Airport', ele: '77' } },
  { type: 'way', id: 5687568, tags: { aeroway: 'runway', ref: '08/26', width: '30', length: '1219' }, geometry: geometry([[43.6309823, -79.3890786], [43.6304526, -79.3912335], [43.6292862, -79.395978], [43.628486, -79.399233], [43.627654, -79.4026174], [43.6274725, -79.4033557]]) },
  { type: 'way', id: 7769081, tags: { aeroway: 'runway', ref: '06/24', width: '30' }, geometry: geometry([[43.6301953, -79.390473], [43.6294148, -79.3917333], [43.6268769, -79.3959096], [43.6258795, -79.3975586]]) },
  { type: 'way', id: 7769085, tags: { aeroway: 'taxiway', ref: 'D' }, geometry: geometry([[43.6301953, -79.390473], [43.6308365, -79.392651]]) }
] };

test('the airport, its elevation and its runways come from the OpenStreetMap answer', () => {
  const airport = OSM.parseAirport(AIRPORT_JSON);
  assert.equal(airport.icao, 'CYTZ'); assert.equal(airport.name, 'Billy Bishop Toronto City Airport'); assert.equal(airport.elevation, 77); assert.equal(airport.osmId, 'relation/85471');
  assert.equal(airport.runways.length, 2); assert.equal(airport.taxiways.length, 1);
  assert.equal(OSM.mainRunway(airport).ref, '08/26');
  assert.throws(() => OSM.parseAirport({ elements: [] }), /No runway/);
  assert.match(OSM.airportQuery(), /icao"="CYTZ"/);
  assert.match(OSM.buildingsQuery({ lat: 43.629, lon: -79.396 }, OSM.AIRPORTS.CYTZ.region), /way\["building"\]\(43\.61\d+,-79\.46\d+,43\.65\d+,-79\.37\d+\)/);
});

test('the scene starts on final approach for runway 08 from the west, lined up with the OpenStreetMap runway', () => {
  const scene = OSM.buildScene({ airport: OSM.parseAirport(AIRPORT_JSON), buildings: [], water: null });
  near(degrees(scene.runway.heading), 71.2, 0.8, 'the runway heading (true), which is runway 08 magnetic');
  near(scene.runway.length, 1214, 25, 'the runway is about 1,2 km long'); assert.ok(scene.runway.threshold[0] < scene.runway.far[0], 'landing runs from the western end to the eastern end');
  const approach = OSM.finalApproach(scene), plane = Physics.approach({ ...approach, distance: 5200 });
  assert.ok(plane.x < scene.runway.threshold[0] - 4500, 'the plane starts about 5 km to the west of the runway'); near(plane.y, 15 + 5200 * Math.tan(3 * Math.PI / 180), 1, 'on a 3 degree glide path');
  near(Math.atan2(plane.x - approach.x, plane.z - approach.z), scene.runway.heading - Math.PI, 0.01, 'on the extended centre line');
  assert.ok(Math.sin(plane.heading) > 0.9, 'heading east');
  const geo = scene.toGeo(scene.runway.threshold[0], scene.runway.threshold[1]);
  near(geo.lat, 43.6274725, 0.0002, 'the threshold maps back to its OpenStreetMap latitude'); near(geo.lon, -79.4033557, 0.0003, 'and longitude');
});

test('building heights come from OpenStreetMap tags, then storeys, then a stable guess', () => {
  assert.equal(OSM.buildingHeight({ height: '120' }, 1), 120);
  assert.equal(OSM.buildingHeight({ height: '35,5 m' }, 1), 35.5);
  near(OSM.buildingHeight({ 'building:levels': '10' }, 1), 33.5, 0.01, 'ten storeys');
  const guess = OSM.buildingHeight({}, 4242); assert.equal(OSM.buildingHeight({}, 4242), guess); assert.ok(guess >= 6 && guess <= 15);
  const { toLocal } = OSM.projector({ lat: 43.63, lon: -79.4 });
  const json = { elements: [
    { type: 'way', id: 1, tags: { building: 'yes', height: '30' }, geometry: geometry([[43.6300, -79.4000], [43.6300, -79.3995], [43.6304, -79.3995], [43.6304, -79.4000], [43.6300, -79.4000]]) },
    { type: 'way', id: 2, tags: { building: 'shed' }, geometry: geometry([[43.6310, -79.4000], [43.63101, -79.4000], [43.63101, -79.39999], [43.6310, -79.4000]]) }
  ] };
  const buildings = OSM.parseBuildings(json, toLocal);
  assert.equal(buildings.length, 1, 'a tiny shed is skipped'); assert.equal(buildings[0].height, 30); assert.equal(buildings[0].ring.length, 8, 'four corners, the repeated first node dropped');
});

test('footprints are triangulated exactly, even concave ones, and containment tests agree', () => {
  const area = tris => { let a = 0; for (let i = 0; i < tris.length; i += 6) a += Math.abs((tris[i + 2] - tris[i]) * (tris[i + 5] - tris[i + 1]) - (tris[i + 4] - tris[i]) * (tris[i + 3] - tris[i + 1])) / 2; return a; };
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]], lShape = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 30], [0, 30]];
  near(area(OSM.triangulate(square)), 100, 1e-9, 'a square'); near(area(OSM.triangulate(lShape)), 20 * 10 + 10 * 20, 1e-9, 'an L shape (concave)');
  near(area(OSM.triangulate([...lShape].reverse())), 400, 1e-9, 'either winding');
  assert.equal(OSM.inside(lShape, 5, 20), true); assert.equal(OSM.inside(lShape, 15, 20), false, 'the notch of the L is outside'); assert.equal(OSM.inside(square.flat(), 5, 5), true);
});

test('the world answers what the plane can touch: runway, land, water and buildings', () => {
  const scene = OSM.buildScene({ airport: OSM.parseAirport(AIRPORT_JSON), buildings: [{ id: 9, height: 50, color: [1, 1, 1], ring: [1000, 1000, 1040, 1000, 1040, 1040, 1000, 1040] }], water: { polygon: [[-9000, -400], [9000, -400], [9000, -9000], [-9000, -9000]], islands: [[[-300, -300], [900, -300], [900, -100], [-300, -100]]] } });
  const world = OSM.createWorld(scene);
  assert.equal(world.surface(...scene.runway.threshold), 'runway'); assert.equal(world.surface(0, 0), 'runway', 'the middle of the runway');
  assert.equal(world.surface(-3000, -2000), 'water'); assert.equal(world.surface(500, -200), 'land', 'an island inside the lake is land'); assert.equal(world.surface(3000, 2000), 'land');
  assert.ok(world.obstacle(1020, 20, 1020), 'inside the footprint and below the roof'); assert.equal(world.obstacle(1020, 60, 1020), null, 'above the roof'); assert.equal(world.obstacle(1100, 20, 1020), null, 'beside it');
});

test('the sea is the whole box and the land is drawn over it: a shore that crosses the box edge several times still puts land on the right side', () => {
  const rect = [0, 0, 100, 100];
  // A shore running west to east with land to the north. It leaves and re-enters over the west and east edges, like Toronto's does.
  const shore = [[-10, 10], [10, 12], [-10, 14], [-10, 40], [10, 45], [60, 50], [90, 55], [110, 58], [90, 62], [110, 66]];
  const land = OSM.landRings([shore], rect);
  assert.ok(land.length >= 1);
  const isLand = (x, z) => land.some(ring => OSM.inside(ring, x, z));
  assert.equal(isLand(50, 90), true, 'north of the shore is land'); assert.equal(isLand(50, 10), false, 'south of the shore is sea'); assert.equal(isLand(80, 30), false); assert.equal(isLand(30, 80), true);
});

test('a closed coastline is an island, an open one is closed along the edge of the box, and tiny wiggles are smoothed away', () => {
  const rect = [0, 0, 100, 100];
  const island = [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]];
  const rings = OSM.landRings([island, [[-5, 80], [50, 70], [105, 80]]], rect);
  const isLand = (x, z) => rings.some(ring => OSM.inside(ring, x, z));
  assert.equal(isLand(50, 50), true, 'the island'); assert.equal(isLand(50, 95), true, 'the mainland above the open shore'); assert.equal(isLand(50, 20), false, 'the sea between');
});

test('Lake Ontario water: the harbour and the lake are water, the mainland and the islands are land', () => {
  const origin = { lat: 43.629, lon: -79.396 }, { toLocal } = OSM.projector(origin), region = OSM.AIRPORTS.CYTZ.region;
  const way = nodes => ({ type: 'way', geometry: nodes.map(([lat, lon]) => ({ lat, lon })) });
  // Mainland shore west to east, with the harbour inlet cut into it, and an island south of it.
  const outer = { elements: [way([[43.6360, -79.47], [43.6340, -79.42], [43.6330, -79.40], [43.6385, -79.40], [43.6385, -79.38], [43.6330, -79.38], [43.6350, -79.35]])] };
  const inner = { elements: [way([[43.6215, -79.41], [43.6310, -79.40], [43.6310, -79.37], [43.6215, -79.37], [43.6215, -79.41]])] };
  const water = OSM.parseWater([outer, inner], toLocal, origin, region, 'CYTZ');
  const world = OSM.createWorld({ buildings: [], runway: { points: [[0, 0], [1, 0]], width: 1 }, otherRunways: [], taxiways: [], water });
  const at = (lat, lon) => world.surface(...toLocal(lat, lon));
  assert.equal(at(43.6420, -79.39), 'land', 'downtown'); assert.equal(at(43.6350, -79.39), 'water', 'the harbour cut into the shore, between the city and the island');
  assert.equal(at(43.6300, -79.43), 'water', 'the lake off the shore'); assert.equal(at(43.6260, -79.39), 'land', 'the island'); assert.equal(at(43.616, -79.39), 'water', 'the open lake south of it');
  assert.ok(OSM.waterQueries(origin, region, 'CYTZ').length === 2 && /way\(r\.lake:"inner"\)/.test(OSM.waterQueries(origin, region, 'CYTZ')[1]));
});

test('Hong Kong and Haneda: OpenStreetMap runways split into several ways are joined, and the approach comes from the right side', () => {
  assert.deepEqual(Object.keys(OSM.AIRPORTS).sort(), ['CYTZ', 'EGLC', 'RJTT', 'VHHH', 'VHHV']);
  const joined = OSM.joinChains([[[1, 1], [2, 2]], [[3, 3], [2, 2]], [[3, 3], [4, 4]]]);
  assert.equal(joined.length, 1); assert.deepEqual(joined[0].map(p => p[0]), [1, 2, 3, 4]);
  const expected = { CYTZ: { heading: 71.2, ref: '08/26', from: 'west' }, VHHH: { heading: 70.8, ref: '07R/25L', from: 'west' }, RJTT: { heading: 330, ref: '16L/34R', from: 'south' } };
  for (const [code, want] of Object.entries(expected)) {
    const scene = OSM.fallbackScene(code);
    assert.equal(scene.code, code); assert.equal(scene.runway.ref, want.ref); near(degrees(scene.runway.heading), want.heading, 1.2, `${code} heading`);
    const plane = Physics.approach({ ...OSM.finalApproach(scene), distance: scene.distance });
    if (want.from === 'west') assert.ok(plane.x < scene.runway.threshold[0] - 4000, `${code}: arrives from the west`); else assert.ok(plane.z < scene.runway.threshold[1] - 4000, `${code}: arrives from the south`);
    const world = OSM.createWorld(scene);
    assert.equal(world.surface(...scene.runway.threshold), 'runway', `${code}: the threshold is on the runway`); assert.equal(world.surface(plane.x, plane.z), 'water', `${code}: the approach starts over the water`);
    const landing = Physics.approach({ ...OSM.finalApproach(scene), distance: scene.distance });
    assert.equal(world.obstacle(landing.x, landing.y, landing.z), null);
  }
  // The area read is grown to hold the whole approach, whichever way the runway points.
  const airport = OSM.parseAirport(AIRPORT_JSON), region = OSM.regionFor(airport, 'CYTZ');
  assert.ok(region.south < OSM.AIRPORTS.CYTZ.region.south - 0.01, 'a 5 km final at 071 degrees starts well south of the runway');
  assert.match(OSM.airportQuery('VHHH'), /icao"="VHHH"/); assert.match(OSM.airportQuery('RJTT'), /icao"="RJTT"/); assert.match(OSM.waterQueries({ lat: 22, lon: 113 }, OSM.AIRPORTS.VHHH.region, 'VHHH')[0], /natural"="coastline"/);
});

test('meshes are made from the scene and the fallback keeps the real runway', () => {
  const scene = OSM.fallbackScene();
  assert.equal(scene.source, 'snapshot'); near(degrees(scene.runway.heading), 71.2, 0.8, 'the snapshot runway is the OpenStreetMap runway');
  const mesh = OSM.buildMesh(scene); assert.equal(mesh.length % 9, 0); assert.ok(mesh.length / 9 > 5000, 'there is geometry'); assert.ok(mesh.every(Number.isFinite));
});

// ---- sharing positions -----------------------------------------------------------------------------------------------------

const POSE = { type: 'pose', lat: 43.627, lon: -79.45, alt: 200, heading: 1.2, pitch: 0.05, roll: 0.1, throttle: 0.3 };

test('only well-formed poses on Earth are accepted, with nothing but position and attitude kept', () => {
  assert.deepEqual(flight.cleanFlightMessage({ ...POSE, score: 9999, admin: true }), { ...POSE, model: 'plane' });
  assert.equal(flight.cleanFlightMessage({ ...POSE, model: 'airbus' }).model, 'airbus'); assert.equal(flight.cleanFlightMessage({ ...POSE, model: 'tank<script>' }).model, 'plane', 'the vehicle label is one of a fixed list');
  for (const bad of [null, [], {}, { type: 'fly' }, { ...POSE, lat: 'x' }, { ...POSE, lat: 95 }, { ...POSE, lon: 200 }, { ...POSE, alt: 20000 }, { ...POSE, alt: NaN }, { ...POSE, heading: 99 }, { ...POSE, throttle: 2 }, { ...POSE, pitch: Infinity }]) assert.equal(flight.cleanFlightMessage(bad), null);
  assert.deepEqual(flight.cleanFlightMessage({ type: 'respawn', extra: 1 }), { type: 'respawn' });
});

test('a pose must be physically reachable: teleporting is rejected, the fastest time compression is not', () => {
  const a = { lat: 43.627, lon: -79.45, alt: 200 };
  assert.equal(flight.plausible(null, a, 0), true);
  assert.equal(flight.plausible(a, { ...a, lon: -79.449 }, 100), true, 'about 80 m in a tenth of a second at 25 m per ... fine');
  assert.equal(flight.plausible(a, { lat: 43.627, lon: -79.45 + 100 * 85 * 0.1 / 80000, alt: 200 }, 100), true, 'a plane at 100x flies 850 m in a tenth of a second');
  assert.equal(flight.plausible(a, { lat: 43.7, lon: -79.2, alt: 200 }, 100), false, 'twenty kilometres in a tenth of a second is a teleport');
  assert.equal(flight.plausible(a, { lat: 43.7, lon: -79.2, alt: 200 }, 10000), true, 'but fine after ten seconds');
});

test('pilots see each other, the server relays only positions, and bad or impossible poses are ignored', async t => {
  const { server, wss } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => { clients.forEach(client => client.terminate()); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  let arcade = '';
  const join = async label => {
    const states = [], client = new WebSocket(`ws://127.0.0.1:${server.address().port}/?room=flight&client=${label}&game=/flight${arcade ? `&arcade=${arcade}` : ''}`);
    clients.push(client);
    client.on('message', raw => { const message = JSON.parse(raw); if (message.type === 'arcadeRooms' && !arcade) arcade = message.currentRoom; if (message.type === 'flightState') states.push(message); });
    await new Promise(resolve => client.once('open', resolve));
    await waitFor(() => states.length > 0 && arcade);
    return { client, states, last: () => states.at(-1) };
  };
  const one = await join('pilot-aaaa1111'), two = await join('pilot-bbbb2222');
  one.client.send(JSON.stringify({ ...POSE, score: 1, role: 'admin' }));
  await waitFor(() => two.last().planes.length === 1);
  const seen = two.last().planes[0];
  assert.deepEqual(Object.keys(seen).sort(), ['alt', 'color', 'heading', 'id', 'lat', 'lon', 'model', 'name', 'pitch', 'roll', 'throttle']);
  near(seen.lat, POSE.lat, 1e-9, 'the shared latitude'); assert.equal(two.last().selfId !== seen.id, true);
  // A teleport and a malformed pose do not move the plane; a valid nearby one does.
  await new Promise(resolve => setTimeout(resolve, 60));
  one.client.send(JSON.stringify({ ...POSE, lat: 43.9, lon: -78.9 })); one.client.send(JSON.stringify({ ...POSE, lat: 'north' }));
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(two.last().planes[0].lat, POSE.lat, 'the impossible pose was ignored');
  await new Promise(resolve => setTimeout(resolve, 60));
  one.client.send(JSON.stringify({ ...POSE, lon: -79.4499 }));
  await waitFor(() => two.last().planes[0].lon === -79.4499);
  // Respawning removes the plane until it reports again; disconnecting removes it from presence right away.
  one.client.send(JSON.stringify({ type: 'respawn' }));
  await waitFor(() => two.last().planes.length === 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  one.client.send(JSON.stringify(POSE)); await waitFor(() => two.last().planes.length === 1);
  one.client.terminate();
  await waitFor(() => two.last().planes.length === 0);
});

async function waitFor(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for condition');
}

test('flaps add lift and drag, so the plane flies slower for the same sink', () => {
  const settle = flaps => { const plane = Physics.approach({ x: 0, z: 0, heading: 0, distance: 3000 }); plane.flaps = flaps; Physics.advance(plane, {}, 25, FLAT); return plane; };
  const clean = settle(0), dirty = settle(3);
  assert.ok(dirty.verticalSpeed <= clean.verticalSpeed + 0.1 || dirty.speed < clean.speed, 'flaps change the glide');
  assert.ok(Math.abs(dirty.speed - clean.speed) > 0.2 || Math.abs(dirty.gamma - clean.gamma) > 0.002, 'flaps have an effect');
});

test('open water from OpenStreetMap (ponds, harbours, lagoons, rivers) is water, and islands in it are land', () => {
  const k = 1 / 111320;
  const ring = [[0, 0], [0, 400], [400, 400], [400, 0], [0, 0]].map(([x, z]) => ({ lat: 43 + z * k, lon: -79 + x * k / Math.cos(43 * Math.PI / 180) }));
  const hole = [[150, 150], [150, 250], [250, 250], [250, 150], [150, 150]].map(([x, z]) => ({ lat: 43 + z * k, lon: -79 + x * k / Math.cos(43 * Math.PI / 180) }));
  const { toLocal } = OSM.projector({ lat: 43, lon: -79 });
  const ponds = OSM.parsePonds({ elements: [
    { type: 'way', id: 1, geometry: ring, tags: { natural: 'water' } },
    { type: 'relation', id: 2, members: [{ type: 'way', role: 'outer', geometry: ring.map(p => ({ lat: p.lat + 0.01, lon: p.lon })) }, { type: 'way', role: 'inner', geometry: hole.map(p => ({ lat: p.lat + 0.01, lon: p.lon })) }, { type: 'way', role: 'outer', geometry: [null, ...ring.slice(1)] }] },
    { type: 'way', id: 3, geometry: ring.slice(0, 3), tags: { natural: 'water' } }
  ] }, toLocal);
  assert.equal(ponds.length, 2, 'two closed rings: the way and the relation (the open way and the broken member are skipped)');
  const scene = OSM.fallbackScene('CYTZ'); scene.ponds = [{ ring: [[-500, 900], [-500, 1300], [-100, 1300], [-100, 900]], holes: [[[-400, 1000], [-400, 1100], [-300, 1100], [-300, 1000]]], box: [-500, 900, -100, 1300] }];
  const world = OSM.createWorld(scene);
  assert.equal(world.surface(-450, 950), 'water'); assert.equal(world.surface(-350, 1050), 'land', 'an island in the water is land');
  assert.match(OSM.pondsQuery({ lat: 35, lon: 139 }, OSM.AIRPORTS.RJTT.region), /natural"="water"[\s\S]*riverbank[\s\S]*basin/);
});

test('more map is read in cells as the plane flies on, and cells can be dropped again', async () => {
  const scene = OSM.fallbackScene('CYTZ'), world = OSM.createWorld(scene), [i, j] = OSM.tileCell(scene, scene.rect[0] - 1000, 0);
  assert.ok(world.covered(0, 0)); assert.ok(!world.covered(scene.rect[0] - 1000, 0), 'beyond the first region nothing is known yet');
  assert.ok(i < 0 || j < 0 || OSM.tileRect(scene, i, j)[0] <= scene.rect[0] - 1000);
  const rect = OSM.tileRect(scene, i, j), queries = [];
  const centre = scene.toGeo((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2), corner = (dx, dz) => ({ lat: centre.lat + dz, lon: centre.lon + dx });
  const fetchJson = async query => { queries.push(query); return { elements: query.includes('building') ? [{ type: 'way', id: 987654, tags: { building: 'yes', height: '30' }, geometry: [corner(0, 0), corner(0, 0.0004), corner(0.0004, 0.0004), corner(0.0004, 0), corner(0, 0)] }] : [] }; };
  const tile = await OSM.loadTile(fetchJson, scene, world, i, j);
  assert.equal(queries.length, 4, 'buildings, open water and the two shore queries'); assert.equal(tile.buildings.length, 1);
  world.addTile(tile); assert.ok(world.covered((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)); assert.ok(world.tiles.has(tile.key));
  const b = tile.buildings[0]; assert.ok(world.obstacle(b.box[0] + 1, 10, b.box[1] + 1));
  const parts = OSM.tileParts(tile); assert.ok(parts.solid.length > 0 && parts.solid.every(Number.isFinite));
  world.removeTile(tile.key); assert.ok(!world.covered((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)); assert.equal(world.obstacle(b.box[0] + 1, 10, b.box[1] + 1), null);
  world.removeTile('home'); assert.ok(world.tiles.has('home'), 'the first region stays');
});

test('a cell with no shoreline is sea when its neighbours are sea', async () => {
  const scene = OSM.fallbackScene('CYTZ'), world = OSM.createWorld(scene), [x0, , x1, z1] = scene.rect;
  const [i, j] = OSM.tileCell(scene, (x0 + x1) / 2, z1 + 1500);
  const tile = await OSM.loadTile(async () => ({ elements: [] }), scene, world, i, j), rect = OSM.tileRect(scene, i, j);
  const south = world.surface((rect[0] + rect[2]) / 2, rect[1] - 40);
  assert.equal(Boolean(tile.water), south === 'water');
});

test('the flight page has a map, one row of controls and flaps, and no map-data footnote', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8');
  assert.match(html, /id="map"/); assert.match(html, /id="flapsDown"/); assert.doesNotMatch(html, /title="Map data|buildings"/);
  assert.match(fs.readFileSync(path.join(__dirname, '../public/flight.css'), 'utf8'), /flex-wrap:nowrap/);
});

test('a closed island that starts inside the box but crosses its edge is one piece of land, not a ring around everything', () => {
  const rect = [0, 0, 1000, 1000];
  // A counter-clockwise island centred on the south edge, written starting at a point inside the box.
  const island = [[300, 300], [200, 100], [100, -200], [500, -300], [900, -200], [800, 100], [700, 300], [500, 400], [300, 300]];
  const rings = OSM.landRings([island], rect);
  assert.equal(rings.length, 1);
  const inside = (x, z) => OSM.inside(rings[0], x, z);
  assert.ok(inside(500, 100), 'the island is land'); assert.ok(!inside(50, 800), 'the open sea is not'); assert.ok(!inside(950, 950));
});

test('the land base is its own mesh, drawn before streamed tiles so it never covers their sea', () => {
  const parts = OSM.meshParts(OSM.fallbackScene('VHHH'));
  assert.equal(parts.base.length, 6 * 9, 'one big land square'); assert.ok(parts.ground.length > 0 && parts.solid.length > 0);
  assert.ok(parts.base.every((v, i) => i % 9 !== 1 || v < 0), 'the base lies below all other ground');
  assert.equal(OSM.buildMesh(OSM.fallbackScene('VHHH')).length, parts.base.length + parts.ground.length + parts.solid.length);
});

test('jet mode: no stall and no limits, so loops, rolls and inverted flight all work', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  const jet = () => { const plane = Physics.spawn('jet', { x: 0, z: 0, heading: 0, distance: 2000, crossing: 800 }); plane.y = 1500; plane.speed = 120; plane.vel = [0, 0, 120]; plane.throttle = 0.7; return plane; };
  const loop = jet(); let upsideDown = false, vertical = false;
  for (let t = 0; t < 12; t += 0.025) { Physics.step(loop, { elevator: t < 5 ? 1 : 0 }, 0.025, FLY); if (Math.abs(loop.roll) > 2.5) upsideDown = true; if (loop.pitch > 1.4) vertical = true; }
  assert.ok(upsideDown && vertical && !loop.crashed, 'a loop goes up, over the top inverted and comes down');
  const roll = jet(); let last = roll.roll, total = 0;
  for (let t = 0; t < 4; t += 0.025) { Physics.step(roll, { aileron: 1 }, 0.025, FLY); let d = roll.roll - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; total += d; last = roll.roll; }
  assert.ok(total > 2 * Math.PI, 'a full barrel roll (right wing down) and more'); assert.ok(roll.y > 1400, 'and it keeps its height');
  const axes = Physics.axesFrom(1.2, 0.4, -0.7), angles = Physics.anglesOf(axes);
  near(angles.heading, 1.2, 1e-9, 'heading'); near(angles.pitch, 0.4, 1e-9, 'pitch'); near(angles.roll, -0.7, 1e-9, 'roll');
  const dive = jet(); dive.y = 100; dive.pitch = -1; Physics.startJet(Object.assign(dive, { gamma: -1 })); Physics.advance(dive, {}, 10, { surface: () => 'land', obstacle: () => null });
  assert.ok(dive.crashed, 'a jet still hits the ground');
});

test('drone mode never crashes: buildings stop it, the ground holds it, water is fine, and it flies like a drone', () => {
  const wall = { surface: () => 'water', obstacle: (x, y, z) => (Math.abs(x) < 60 && z > 100 && z < 200 && y < 300 ? {} : null) };
  const drone = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); drone.x = 0; drone.z = 0; drone.y = 50; drone.heading = 0;
  Physics.advance(drone, { throttleRate: 0.5 }, 3, wall); Physics.advance(drone, {}, 20, wall);
  assert.ok(drone.z <= 100 && !drone.crashed, 'a wall of buildings stops it without a crash');
  Physics.advance(drone, { climb: -1 }, 20, wall); assert.ok(drone.y >= 1 && !drone.crashed, 'it settles above the ground or water');
  const up = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); const y0 = up.y; Physics.advance(up, { climb: 1 }, 2, wall); assert.ok(up.y > y0 + 10, 'up goes up');
  const turn = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); Physics.advance(turn, { yaw: 1 }, 1, wall); assert.ok(turn.heading > 1, 'right turns right');
  const slide = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); const x0 = slide.x; slide.heading = 0; Physics.advance(slide, { strafe: 1 }, 2, wall); assert.ok(slide.x > x0 + 10 && Math.abs(slide.heading) < 1e-9, 'D slides right without turning');
  const look = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); Physics.advance(look, { view: 1 }, 1, wall); assert.ok(look.view > 0.9, 'W tilts the camera up');
});

test('the page switches between the Cessna, the jet and the drone, with drone keys as asked', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8'), js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(html, /id="mode"[\s\S]*value="jet"[\s\S]*value="drone"/);
  assert.match(js, /DRONE_KEYMAP = \{ ArrowUp: 'climb', ArrowDown: 'descend', ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', KeyA: 'strafeLeft', KeyD: 'strafeRight', KeyW: 'forward', KeyS: 'backward', KeyI: 'viewUp', KeyK: 'viewDown'/);
});

test('the speed setting scales distance only: turning, pitching and rolling are the same at 1x and 50x', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  for (const mode of ['plane', 'jet']) {
    const make = () => { const plane = Physics.spawn(mode, { x: 0, z: 0, heading: 0, distance: 2000, crossing: 800 }); plane.y = 3000; return plane; };
    const slow = make(), fast = make(), input = { elevator: 0.6, aileron: 0.5 };
    Physics.advance(slow, input, 3, FLY, 0.025, 1); Physics.advance(fast, input, 3, FLY, 0.025, 50);
    near(fast.pitch, slow.pitch, 0.03, `${mode} pitch`); near(Math.abs(fast.roll), Math.abs(slow.roll), 0.05, `${mode} roll`);
    const start = make(), dSlow = Math.hypot(slow.x - start.x, slow.z - start.z), dFast = Math.hypot(fast.x - start.x, fast.z - start.z);
    assert.ok(dFast > dSlow * 30, `${mode} covers far more ground at 50x (${dFast.toFixed(0)} vs ${dSlow.toFixed(0)} m)`);
  }
  const drone = scale => { const plane = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); plane.x = 0; plane.z = 0; Physics.advance(plane, { yaw: 1, forward: 1 }, 2, FLY, 0.025, scale); return plane; };
  near(drone(50).heading, drone(1).heading, 1e-6, 'the drone turns at the same rate'); assert.ok(Math.hypot(drone(50).x, drone(50).z) > 20 * Math.hypot(drone(1).x, drone(1).z));
});

test('the jet view is fixed to the aircraft like a cockpit and can look around', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(js, /if \(flightMode === 'jet'\) \{[^\n]*fixed to the aircraft/); assert.match(js, /pointermove/); assert.match(js, /lookLeft/); assert.doesNotMatch(js, /1 \/ Math\.max\(1, scale \/ 2\)/);
});

test('the vehicle can be switched in mid-flight without moving, and each one keeps flying', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  const fresh = mode => { const plane = Physics.spawn(mode, { x: 0, z: 0, heading: 1, distance: 2000, crossing: 800 }); plane.y = 1500; Physics.advance(plane, {}, 2, FLY); return plane; };
  const order = ['plane', 'jet', 'drone', 'plane', 'drone', 'jet', 'plane'];
  const plane = fresh('plane');
  for (let i = 1; i < order.length; i++) {
    const before = { x: plane.x, y: plane.y, z: plane.z, heading: plane.heading };
    Physics.switchMode(plane, order[i]);
    assert.equal(plane.mode, order[i]); near(plane.x, before.x, 1e-9, 'x'); near(plane.z, before.z, 1e-9, 'z'); assert.ok(plane.y >= before.y - 1e-9, 'never lower'); near(plane.heading, before.heading, 1e-9, 'heading');
    Physics.advance(plane, order[i] === 'jet' ? { elevator: 0.2 } : {}, 3, FLY);
    assert.ok(!plane.crashed, `${order[i]} flies on after the switch`); assert.ok(Number.isFinite(plane.x + plane.y + plane.z + plane.speed));
  }
  const loop = fresh('jet'); Physics.advance(loop, { elevator: 1 }, 1.5, FLY); Physics.switchMode(loop, 'plane'); assert.equal(loop.mode, 'plane'); assert.equal(loop.axes, null);
  const dead = fresh('plane'); dead.crashed = 'x'; Physics.switchMode(dead, 'drone'); assert.equal(dead.mode, 'plane', 'a crashed vehicle is not switched (the page starts over instead)');
  const ground = Physics.spawn('plane', { x: 0, z: 0, heading: 0, distance: 2000 }); ground.onGround = true; ground.y = 0; ground.speed = 0; Physics.switchMode(ground, 'jet'); assert.equal(ground.mode, 'jet'); assert.ok(ground.onGround, 'a plane on the runway stays on it as a jet');
});

test('after a crash the same vehicle is put back in the same place, higher, flying', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  for (const mode of ['plane', 'jet', 'drone']) {
    const plane = Physics.spawn(mode, { x: 0, z: 0, heading: 2, distance: 2000, crossing: 800 }); plane.y = 500; plane.crashed = 'You flew into a building.'; plane.speed = 0; plane.x = 123; plane.z = -456; plane.heading = 2.3;
    Physics.recover(plane, 400);
    assert.equal(plane.crashed, null); assert.equal(plane.mode, mode); near(plane.x, 123, 1e-9, 'x'); near(plane.z, -456, 1e-9, 'z'); near(plane.heading, 2.3, 1e-9, 'heading'); assert.equal(plane.y, 400);
    Physics.advance(plane, {}, 5, FLY); assert.ok(!plane.crashed && plane.y > 100, `${mode} flies on after recovering`);
  }
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(js, /crashedFor >= 3\) recoverHere\(\)/);
});

test('the Airbus A320 flies like an airliner: a steady 3 degree approach at about 148 knots, lands, takes off, and has real dimensions', () => {
  const RUNWAY = { surface: () => 'runway', obstacle: () => null };
  const plane = Physics.spawn('airbus', { x: 0, z: 0, heading: 0, distance: 5200 });
  assert.equal(plane.mode, 'airbus'); near(plane.speed * 1.944, 148, 4, 'approach speed (knots)'); assert.equal(plane.flaps, 3, 'approach flaps');
  Physics.advance(plane, {}, 20, RUNWAY); near(degrees(plane.gamma), -3, 0.4, 'glide angle held with the stick centred'); near(plane.speed * 1.944, 148, 6, 'speed held');
  Physics.advance(plane, {}, 80, RUNWAY, 0.025); assert.ok(plane.onGround && !plane.crashed, `lands softly: ${plane.crashed}`);
  const roll = Physics.create({ mode: 'airbus', onGround: true, throttle: 1, flaps: 1, heading: 0 });
  let t = 0; while (roll.onGround && t < 120) { Physics.step(roll, { elevator: roll.speed > Physics.AIRBUS.rotateSpeed ? 1 : 0 }, 0.05, RUNWAY); t += 0.05; }
  assert.ok(!roll.onGround && !roll.crashed && t < 60, 'takes off'); assert.ok(roll.z > 800 && roll.z < 2800, `a realistic takeoff roll (${Math.round(roll.z)} m)`);
  assert.ok(Physics.AIRBUS.mass / Physics.AIRBUS.wingArea > 400 && Physics.AIRBUS.wingArea > 100, 'an airliner wing loading');
});

test('the vehicles are smooth lofted models with real dimensions, not boxes', () => {
  const Models = require('../public/flight-models.js');
  const size = model => Models.extent(Models.build(model, [0.8, 0.1, 0.1], [0.1, 0.2, 0.45]));
  const cessna = size('plane'), airbus = size('airbus'), jet = size('jet'), drone = size('drone');
  near(cessna.size[2], 8.2, 0.6, 'Cessna length'); near(cessna.size[0], 11, 0.4, 'Cessna span'); near(cessna.size[1], 2.9, 0.4, 'Cessna height');
  near(airbus.size[2], 37.6, 1.2, 'A320 length'); near(airbus.size[0], 36, 0.7, 'A320 span'); near(airbus.size[1], 11.8, 0.8, 'A320 height');
  near(jet.size[2], 15, 1.5, 'jet length'); near(jet.size[0], 9.6, 0.8, 'jet span'); near(drone.size[0] * 0.14, 0.65, 0.08, 'drone is about 0.65 m across at the drawn 1/7 scale');
  for (const model of Models.MODELS) {
    const data = Models.build(model, [0.8, 0.1, 0.1], [0.1, 0.2, 0.45]);
    assert.equal(data.length % 27, 0, `${model}: whole triangles`); assert.ok(data.length / 27 > 600, `${model} has many more faces than a box model`); assert.ok(data.every(Number.isFinite), `${model}: finite numbers`);
    let curved = 0, flat = new Set(); for (let i = 0; i < data.length; i += 9) { const key = [data[i + 3], data[i + 4], data[i + 5]].map(v => v.toFixed(2)).join(','); flat.add(key); }
    assert.ok(flat.size > 300, `${model}: smooth shading uses many different normals (${flat.size}), a box model has six`);
    for (let i = 0; i < data.length; i += 9) assert.ok(Math.abs(Math.hypot(data[i + 3], data[i + 4], data[i + 5]) - 1) < 1e-6, `${model}: unit normals`);
  }
  assert.ok(Models.extent(Models.build('airbus', [1, 0, 0], [0, 0, 1])).min[1] > -4.5, 'the gear is about 3.8 m below the fuselage centre');
});

test('approach advice: phase, flaps, target speed and the throttle that holds it, near an airport only', () => {
  const at = (mode, distance, extra = {}) => Physics.advice(Physics.create({ mode, onGround: false, y: 300, speed: 40, ...extra }), { distance, height: 300 });
  const cessna = [30000, 7000, 4000, 1500].map(d => at('plane', d));
  assert.deepEqual(cessna.map(a => a.phase), ['Cruise', 'Slow down', 'Approach', 'Final']); assert.deepEqual(cessna.map(a => a.flaps), [0, 1, 2, 3]);
  assert.ok(cessna[0].kt > cessna[3].kt, 'it slows down as it gets closer'); assert.ok(cessna.every(a => a.throttle > 0 && a.throttle < 1));
  const airbus = [30000, 12000, 7000, 4000, 1500].map(d => at('airbus', d)); assert.deepEqual(airbus.map(a => a.flaps), [0, 1, 2, 3, 4]); assert.equal(airbus.at(-1).phase, 'Short final');
  // the throttle really is the one that holds the speed on that path: with the advised throttle the energy balance is zero
  const final = at('plane', 1500), spec = Physics.PLANE, v = final.kt / 1.943844, q = 0.5 * spec.rho * v * v, cl = spec.mass * 9.81 * Math.cos(3 * Math.PI / 180) / (q * spec.wingArea);
  const drag = q * spec.wingArea * (spec.cd0 + 3 * spec.flapCd + spec.k * cl * cl), thrust = final.throttle * Math.min(spec.staticThrust, spec.power / v);
  near(thrust - drag + spec.mass * 9.81 * Math.sin(3 * Math.PI / 180), 0, 5, 'newtons of thrust left over');
  assert.ok(Physics.advice(Physics.create({ mode: 'plane', onGround: false, y: 300 }), { distance: 1500, height: 300, glide: 5.5 }).throttle < final.throttle, 'a steeper approach (London City) needs less power');
  assert.equal(Physics.advice(Physics.create({ mode: 'jet', onGround: false }), { distance: 1000 }), null, 'no advice for the jet or the drone');
  assert.equal(at('plane', 1000, { y: 5 }) && Physics.advice(Physics.create({ mode: 'plane', onGround: false, y: 5 }), { distance: 1000, height: 5 }).phase, 'Flare');
  assert.equal(Physics.advice(Physics.create({ mode: 'plane', onGround: true, speed: 0 }), { distance: 0 }).phase, 'Takeoff'); assert.equal(Physics.advice(Physics.create({ mode: 'plane', onGround: true, speed: 20 }), { distance: 0 }).phase, 'Rollout');
  assert.equal(Physics.advice(Physics.create({ mode: 'plane', onGround: false }), { distance: 3000, height: 400, departing: true }).phase, 'Departure');
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8');
  assert.match(html, /id="autoThrottle"[\s\S]*id="autoFlaps"/); assert.match(js, /toCentre > 16000 \|\| plane\.y > 3000\) return null/); assert.match(js, /scene\.place \|\| !hasFlaps/);
  assert.match(js, /manualAt\.throttle/); assert.match(js, /manualAt\.flaps/);
});

test('London City (from the east, 5.5 degrees) and Victoria Harbour (from the west, a place with no runway) are available', () => {
  const eglc = OSM.fallbackScene('EGLC'), place = OSM.fallbackScene('VHHV');
  assert.equal(eglc.glide, 5.5); assert.equal(eglc.place, false); near(degrees(eglc.runway.heading), 273, 4, 'landing towards the west, runway 27'); assert.equal(eglc.water, null, 'no sea at London City');
  assert.equal(place.place, true); const start = OSM.finalApproach(place); near(degrees(start.heading), 78, 1e-6, 'flying east'); assert.ok(start.x < -5000, 'starting west of the harbour'); assert.equal(place.start.alt, 420);
  assert.equal(OSM.waterQueries({ lat: 51.5, lon: 0 }, OSM.AIRPORTS.EGLC.region, 'EGLC').length, 0); assert.match(OSM.waterQueries({ lat: 22.29, lon: 114.17 }, OSM.AIRPORTS.VHHV.region, 'VHHV')[0], /coastline/);
  const p = Physics.spawn('plane', { x: start.x, z: start.z, heading: start.heading, distance: 0, glide: 0, crossing: 420, speed: 52, throttle: 0.5, flaps: 0 });
  near(p.y, 420, 1e-9, 'starts at cruise height'); near(p.gamma, 0, 1e-9, 'level'); assert.equal(p.flaps, 0);
  // a river that crosses the box is closed between its two banks
  const k = 1 / 111320, geo = (x, z) => ({ lat: 51.5 + z * k, lon: 0 + x * k / Math.cos(51.5 * Math.PI / 180) });
  const bank = z => [-3000, -1000, 1000, 3000].map(x => geo(x, z)), { toLocal } = OSM.projector({ lat: 51.5, lon: 0 });
  const river = OSM.parsePonds({ elements: [{ type: 'relation', id: 5, members: [{ type: 'way', role: 'outer', geometry: [null, ...bank(100).slice(1, 3), null] }, { type: 'way', role: 'outer', geometry: [null, ...bank(-200).slice(1, 3), null] }] }] }, toLocal);
  assert.equal(river.length, 1); assert.ok(OSM.inside(river[0].ring, 0, -50), 'between the banks is water'); assert.ok(!OSM.inside(river[0].ring, 0, 400), 'beyond the bank is not');
});

test('the Cessna propeller is its own part that spins, and the wings and tail join the body', () => {
  const Models = require('../public/flight-models.js');
  const prop = Models.propeller('plane'); assert.ok(prop && prop.data.length > 0); near(prop.pivot[2], 3.8, 1e-9, 'pivot at the nose'); assert.equal(Models.propeller('airbus'), null);
  const body = Models.build('plane', [1, 0, 0], [0, 0, 1]); let rootAcrossCentre = 0; for (let i = 0; i < body.length; i += 9) if (Math.abs(body[i]) < 1e-6 && body[i + 1] > 0.6 && body[i + 1] < 1.0 && Math.abs(body[i + 2] - 0.5) < 0.9) rootAcrossCentre++;
  assert.ok(rootAcrossCentre > 4, 'the wing root reaches the centreline, sunk into the cabin roof');
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8'), render = fs.readFileSync(path.join(__dirname, '../public/flight-render.js'), 'utf8');
  assert.match(js, /spin: spinSelf/); assert.match(render, /plane\.spin/);
});

test('any airport can be flown into by its 3 or 4 character code, on its longest runway, with its full name', async () => {
  assert.equal(OSM.resolveCode(' ytz '), 'CYTZ'); assert.equal(OSM.resolveCode('lcy'), 'EGLC'); assert.equal(OSM.resolveCode('kjfk'), 'KJFK'); assert.equal(OSM.resolveCode('KJ'), ''); assert.equal(OSM.resolveCode('TOOLONG'), ''); assert.equal(OSM.resolveCode('a b'), '');
  assert.match(OSM.airportQuery('JFK'), /iata"="JFK"/); assert.match(OSM.airportQuery('KJFK'), /icao"="KJFK"/);
  const node = (lat, lon) => ({ lat, lon });
  const json = lat => ({ elements: [
    { type: 'way', id: 1, tags: { aeroway: 'aerodrome', icao: 'ZZZZ', iata: 'ZZZ', name: 'Zed Regional Airport', 'name:en': 'Zed Regional Airport (English)', ele: '120 m' }, geometry: [node(lat, 10), node(lat, 10.01), node(lat + 0.01, 10.01)] },
    { type: 'way', id: 2, tags: { aeroway: 'runway', ref: '04/22' }, geometry: [node(lat, 10), node(lat + 0.004, 10.004)] },
    { type: 'way', id: 3, tags: { aeroway: 'runway', ref: '09/27' }, geometry: [node(lat, 10), node(lat + 0.0005, 10.03)] }] });
  for (const [lat, wanted] of [[48, 270], [10, 90]]) {      // outside the tropics land towards the west, inside them towards the east
    delete OSM.AIRPORTS.ZZZ; delete OSM.AIRPORTS.ZZZZ;
    const queries = [], scene = await OSM.load(async query => { queries.push(query); return /airport/.test(query) && !/building|coastline|water/.test(query) ? json(lat) : { elements: [] }; }, 'ZZZ');
    assert.match(queries[0], /iata"="ZZZ"/); assert.equal(scene.airport.name, 'Zed Regional Airport (English)'); assert.equal(scene.airport.icao, 'ZZZZ'); assert.equal(scene.airport.iata, 'ZZZ'); assert.equal(scene.airport.elevation, 120);
    assert.equal(scene.runway.ref, '09/27', 'the longest runway'); near(degrees(scene.runway.heading), wanted, 8, `landing heading at latitude ${lat}`);
    assert.equal(scene.code, 'ZZZ'); const tile = await OSM.loadTile(async () => ({ elements: [] }), scene, OSM.createWorld(scene), 3, 0); assert.equal(tile.key, '3,0', 'streaming works for a code that was typed');
  }
  delete OSM.AIRPORTS.ZZZ; delete OSM.AIRPORTS.ZZZZ;
  await assert.rejects(() => OSM.load(async () => ({ elements: [] }), 'QQQ'), /No runway/); assert.equal(OSM.AIRPORTS.QQQ, undefined, 'a code that does not exist leaves nothing behind');
  const html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8'), js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(html, /<input id="airport" type="text" list="airportList"/); assert.match(js, /scene\.airport\.name/); assert.match(js, /No airport with the code/);
});

test('airports can be searched by name: Nominatim candidates, codes read from the OpenStreetMap elements, code shown beside the name', () => {
  assert.match(OSM.searchUrl('heathrow'), /^https:\/\/nominatim\.openstreetmap\.org\/search\?q=heathrow\+airport&format=jsonv2/); assert.match(OSM.searchUrl('Kennedy Airport'), /q=Kennedy\+Airport&/);
  const result = (type, id, name, extra = {}) => ({ category: 'aeroway', type: 'aerodrome', osm_type: type, osm_id: id, name, address: { city: 'London', country: 'United Kingdom' }, ...extra });
  const found = OSM.parseSearch([result('relation', 14001268, 'Heathrow Airport'), result('way', 5, 'Tiny Strip', { extratags: { icao: 'EGXX', iata: 'TNY' } }), result('way', 5, 'Tiny Strip again'), { category: 'highway', type: 'bus_stop', osm_type: 'node', osm_id: 9, name: 'Heathrow Central' }, { category: 'aeroway', type: 'terminal', osm_type: 'way', osm_id: 11, name: 'Terminal 5' }]);
  assert.deepEqual(found.map(r => r.name), ['Heathrow Airport', 'Tiny Strip']); assert.equal(found[1].code, 'EGXX'); assert.equal(found[1].iata, 'TNY'); assert.equal(found[0].code, ''); assert.equal(found[0].where, 'London, United Kingdom');
  assert.equal(OSM.enrichQuery(found), '[out:json][timeout:25];(rel(14001268););out tags;', 'only the airports without a code are looked up');
  const codes = OSM.applyTags(found, { elements: [{ type: 'relation', id: 14001268, tags: { icao: 'EGLL', iata: 'LHR', name: 'London Heathrow Airport' } }] });
  assert.deepEqual(codes.map(r => [r.name, r.icao, r.iata, r.code]), [['London Heathrow Airport', 'EGLL', 'LHR', 'EGLL'], ['Tiny Strip', 'EGXX', 'TNY', 'EGXX']]);
  assert.deepEqual(OSM.applyTags([{ osmType: 'way', osmId: 1, name: 'No code', code: '' }], { elements: [] }), [], 'airports without any code are not offered');
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(js, /notFound: \(\) => searchByName\(text\)/); assert.match(js, /codes\.textContent = \[r\.icao, r\.iata\]/);
});

test('the drone has no throttle and stays where it is when no key is pressed, including after switching to it and after a respawn', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  const drone = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); drone.x = 0; drone.z = 0; const y0 = drone.y;
  Physics.advance(drone, {}, 10, FLY); assert.ok(Math.hypot(drone.x, drone.z) < 0.01 && Math.abs(drone.y - y0) < 0.01, 'no key: it does not move');
  Physics.advance(drone, { throttleRate: 1 }, 4, FLY); assert.ok(Math.hypot(drone.x, drone.z) < 0.01 && drone.throttle === 0, 'throttle input is ignored');
  const flyer = Physics.spawn('jet', { x: 0, z: 0, heading: 0, distance: 2000, crossing: 500 }); Physics.switchMode(flyer, 'drone'); const at = { x: flyer.x, z: flyer.z }; Physics.advance(flyer, {}, 5, FLY);
  assert.ok(Math.hypot(flyer.x - at.x, flyer.z - at.z) < 0.01, 'switching to the drone from a flying jet leaves it hovering');
  const moving = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); Physics.advance(moving, { forward: 1 }, 3, FLY); const z1 = moving.z; Physics.advance(moving, {}, 4, FLY);
  assert.ok(moving.z - z1 < 8, 'it stops soon after the key is released'); const z2 = moving.z; Physics.advance(moving, {}, 4, FLY); assert.ok(Math.abs(moving.z - z2) < 0.05, 'and then stays put');
  const crashed = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); crashed.crashed = 'x'; Physics.recover(crashed, 300); assert.equal(crashed.vf, 0, 'hovering after a respawn');
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(js, /querySelector\('\.throttle'\)\.hidden = flightMode === 'drone'/); assert.doesNotMatch(js.match(/const DRONE_KEYMAP = \{[^}]*\}/)[0], /Throttle/);
});

test('drone W / S go forward and backward and I / K tilt the camera', () => {
  const FLY = { surface: () => 'land', obstacle: () => null }, make = () => { const plane = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); plane.x = 0; plane.z = 0; return plane; };
  const fwd = make(), back = make();
  Physics.advance(fwd, { forward: 1 }, 4, FLY); Physics.advance(back, { forward: -1 }, 4, FLY);
  assert.ok(fwd.z > 50, `W flies forward (${Math.round(fwd.z)} m in 4 s)`); assert.ok(back.z < -30 && back.vf < 0, 'S flies backward'); assert.ok(fwd.z > -back.z, 'forward is faster than backward');
  const look = make(); Physics.advance(look, { view: 1 }, 1, FLY); assert.ok(look.view > 0.9);
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8'); const keys = js.match(/const DRONE_KEYMAP = \{[^}]*\}/)[0];
  assert.match(keys, /KeyW: 'forward'/); assert.match(keys, /KeyS: 'backward'/); assert.match(keys, /KeyI: 'viewUp'/); assert.match(keys, /KeyK: 'viewDown'/);
});
