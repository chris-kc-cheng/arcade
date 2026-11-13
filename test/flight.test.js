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
  assert.deepEqual(Object.keys(OSM.AIRPORTS).sort(), ['CYTZ', 'EGLC', 'RJTT', 'VHHH', 'VICTORIA']);
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

test('jet: a real flight model with progressive controls, 9 g and Mach limits of the physics, and loops, rolls and inverted flight', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  const jet = (speed, throttle, y = 3000) => { const plane = Physics.spawn('jet', { x: 0, z: 0, heading: 0, distance: 2000, crossing: 800 }); plane.y = y; plane.speed = speed; plane.vel = [0, 0, speed]; plane.axes = Physics.axesFrom(0, 0, 0); plane.throttle = throttle; return plane; };
  // the stick is progressive: a key press ramps in, it is not an instant full deflection
  const ramp = jet(200, 0.75); Physics.step(ramp, { elevator: 1 }, 0.025, FLY); assert.ok(ramp.elevator > 0 && ramp.elevator < 0.1, 'the first instant gives a small deflection'); Physics.advance(ramp, { elevator: 1 }, 0.5, FLY); assert.ok(ramp.elevator > 0.9);
  const level = jet(150, 0.7); Physics.advance(level, {}, 20, FLY); near(level.g, 1, 0.05, 'stick released holds 1 g'); assert.ok(Math.abs(level.y - 3000) < 120 && Math.abs(level.gamma) < 0.03, 'and the flight path');
  const loop = jet(250, 0.75); let gmax = 0, upsideDown = false, vertical = false;
  for (let t = 0; t < 25; t += 0.025) { Physics.step(loop, { elevator: 1 }, 0.025, FLY); gmax = Math.max(gmax, loop.g); if (Math.abs(loop.roll) > 2.5) upsideDown = true; if (loop.pitch > 1.4) vertical = true; }
  assert.ok(upsideDown && vertical && !loop.crashed, 'a loop goes up, over the top inverted and comes down'); assert.ok(gmax > 5 && gmax <= 9.2, `the pull is limited to 9 g (${gmax.toFixed(1)})`); assert.ok(loop.speed < 200, 'the loop cost energy');
  const roll = jet(200, 0.75); let last = roll.roll, total = 0;
  for (let t = 0; t < 2; t += 0.025) { Physics.step(roll, { aileron: 1 }, 0.025, FLY); let d = roll.roll - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; total += d; last = roll.roll; }
  assert.ok(total > 2 * Math.PI, 'a full roll in two seconds (right wing down)'); assert.ok(roll.y > 2900, 'keeping its height');
  const slow = jet(55, 0, 3000), fast = jet(220, 0.75); Physics.advance(slow, { elevator: 0.3 }, 1, FLY); Physics.advance(fast, { elevator: 0.3 }, 1, FLY); assert.ok(Math.abs(slow.pitch - 0) < Math.abs(fast.pitch) + 0.5, 'less authority slow');
  const brake = jet(200, 0.3), free = jet(200, 0.3); Physics.advance(brake, { brake: true }, 10, FLY); Physics.advance(free, {}, 10, FLY); assert.ok(brake.speed < free.speed - 4, 'the air brake slows the jet');
  const hi = jet(300, 1, 8000); Physics.advance(hi, {}, 80, FLY, 0.05); assert.ok(hi.mach > 1.0 && hi.mach < 2.6, `afterburner takes it supersonic (Mach ${hi.mach.toFixed(2)})`);
  const mil = jet(250, 0.75, 3000), ab = jet(250, 1, 3000); Physics.advance(mil, {}, 10, FLY); Physics.advance(ab, {}, 10, FLY); assert.ok(ab.speed > mil.speed + 20, 'afterburner adds thrust above 75% throttle');
  const axes = Physics.axesFrom(1.2, 0.4, -0.7), angles = Physics.anglesOf(axes);
  near(angles.heading, 1.2, 1e-9, 'heading'); near(angles.pitch, 0.4, 1e-9, 'pitch'); near(angles.roll, -0.7, 1e-9, 'roll');
  const dive = jet(200, 0.5); dive.y = 100; dive.pitch = -1; Physics.startJet(Object.assign(dive, { gamma: -1 })); Physics.advance(dive, {}, 10, FLY); assert.ok(dive.crashed, 'a jet still hits the ground');
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
  near(jet.size[2], 15, 1.5, 'jet length'); near(jet.size[0], 9.6, 0.8, 'jet span'); near(drone.size[0], 0.21, 0.05, 'the drone is about 0.2 m across, like a DJI Avata');
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
  const eglc = OSM.fallbackScene('EGLC'), place = OSM.fallbackScene('VICTORIA');
  assert.equal(eglc.glide, 5.5); assert.equal(eglc.place, false); near(degrees(eglc.runway.heading), 273, 4, 'landing towards the west, runway 27'); assert.equal(eglc.water, null, 'no sea at London City');
  assert.equal(place.place, true); const start = OSM.finalApproach(place); near(degrees(start.heading), 78, 1e-6, 'flying east'); assert.ok(start.x < -5000, 'starting west of the harbour'); assert.equal(place.start.alt, 420);
  assert.equal(OSM.waterQueries({ lat: 51.5, lon: 0 }, OSM.AIRPORTS.EGLC.region, 'EGLC').length, 0); assert.match(OSM.waterQueries({ lat: 22.29, lon: 114.17 }, OSM.AIRPORTS.VICTORIA.region, 'VICTORIA')[0], /coastline/);
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
  const prop = Models.propeller('plane'); assert.ok(prop && prop.data.length > 0); near(prop.rotors[0].pivot[2], 3.8, 1e-9, 'pivot at the nose'); assert.equal(Models.propeller('airbus'), null);
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

test('night mode: airport lights come from OpenStreetMap where it has them, basic runway lights otherwise, and blink only where real lights do', () => {
  const lights = scene => { const { data, papi } = OSM.buildLights(scene), list = []; for (let i = 0; i < data.length; i += 10) list.push({ x: data[i], y: data[i + 1], z: data[i + 2], rgb: [data[i + 3], data[i + 4], data[i + 5]], period: data[i + 6], offset: data[i + 7], duty: data[i + 8], size: Math.round(data[i + 9] * 100) / 100 }); return { list, papi }; };
  const base = OSM.fallbackScene('CYTZ'), plain = lights(base);
  assert.ok(plain.list.length > 40, 'a lit runway gets edge, threshold and end lights'); assert.ok(plain.list.some(l => l.rgb[1] > 0.9 && l.rgb[0] < 0.3), 'green threshold'); assert.ok(plain.list.some(l => l.rgb[0] > 0.9 && l.rgb[1] < 0.2), 'red end');
  assert.ok(plain.list.filter(l => l.size !== 2.2).every(l => l.period === 0), 'no blinking where the data lists no flashing lights (only the red lights on towers blink)'); assert.equal(plain.papi.length, 0, 'no PAPI that OpenStreetMap does not list');
  const dark = { ...base, runway: { ...base.runway, lit: 'no' }, otherRunways: base.otherRunways.map(r => ({ ...r, lit: 'no' })) }; assert.equal(lights(dark).list.filter(l => l.size !== 2.2).length, 0, 'lit=no means no runway lights');
  // approach lights listed by OpenStreetMap: the ones on the centreline beyond 150 m flash in sequence towards the runway
  const h = base.runway.heading, d = [Math.sin(h), Math.cos(h)], t = base.runway.threshold, at = s => ({ kind: 'als', tags: {}, x: t[0] - d[0] * s, z: t[1] - d[1] * s });
  const withAls = lights({ ...base, navaids: [at(100), at(300), at(600), at(900), { ...at(600), x: at(600).x + d[1] * 30 * -1, z: at(600).z + d[0] * 30 }, { kind: 'papi', tags: { description: 'PAPI 27 LEFT' }, x: t[0] + 50, z: t[1] }, { kind: 'rwe', tags: { 'light:colour': 'red' }, x: 5, z: 5 }] });
  const als = withAls.list.filter(l => l.size === 0.9);
  assert.equal(als.length, 5); assert.equal(als.filter(l => l.period > 0).length, 3, 'three centreline lights beyond 150 m flash'); assert.equal(als[0].period, 0, 'the one at 100 m and the off-centre one are steady');
  const flashing = als.filter(l => l.period > 0).sort((a, b) => a.offset - b.offset); assert.ok(flashing[0].offset < flashing[2].offset, 'the sequence runs along the approach');
  assert.equal(withAls.papi.length, 1); assert.ok(withAls.list.some(l => l.rgb[0] > 0.9 && l.rgb[1] < 0.2 && l.size === 0.7), 'a listed red edge light is drawn red, and the synthetic runway lights are skipped when edge lights are listed');
  assert.equal(withAls.list.filter(l => l.size === 0.7 && l.rgb[0] > 0.9 && l.rgb[1] > 0.9).length, 0, 'no invented edge lights beside the real ones');
  // PAPI: white above the slope, red below
  const papi = [{ x: t[0] + 300 * d[0], z: t[1] + 300 * d[1], description: 'PAPI 08 LEFT' }], count = (y) => { const out = OSM.papiLights(base, papi, [t[0] - d[0] * 1000, y, t[1] - d[1] * 1000], '08'); let white = 0; for (let i = 0; i < out.length; i += 10) if (out[i + 4] > 0.9 && out[i + 3] > 0.9 && out[i + 5] > 0.7) white++; return [out.length / 10, white]; };
  assert.deepEqual(count(100), [4, 4], 'high: all white'); assert.deepEqual(count(30), [4, 0], 'low: all red'); const onPath = count(1300 * Math.tan(3 * Math.PI / 180)); assert.equal(onPath[1], 2, 'on the glide path: two white, two red');
  assert.deepEqual(OSM.papiLights(base, papi, [t[0] + d[0] * 800, 100, t[1] + d[1] * 800], '08'), [], 'not shown from behind the unit');
  // red blinking obstruction lights on tall buildings only
  const towers = OSM.obstructionLights([{ id: 1, height: 250, ring: [0, 0, 10, 0, 10, 10, 0, 10] }, { id: 2, height: 40, ring: [0, 0, 10, 0, 10, 10, 0, 10] }]); assert.equal(towers.length, 10); assert.ok(towers[6] > 0 && towers[3] > 0.9 && towers[4] < 0.2, 'blinking and red');
  const Models = require('../public/flight-models.js'); for (const model of Models.MODELS) { const nav = Models.navLights(model); assert.ok(nav.some(n => n[1][0] > 0.9 && n[1][1] < 0.2) && nav.some(n => n[1][1] > 0.9 && n[1][0] < 0.3) && nav.some(n => n[2] > 0), `${model}: red and green navigation lights and a strobe`); }
  const render = fs.readFileSync(path.join(__dirname, '../public/flight-render.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8'), js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(render, /uNight/); assert.match(render, /gl_PointSize/); assert.match(html, /id="night"/); assert.match(js, /KeyN/); assert.match(js, /flight-night/);
  assert.equal(Models.propeller('drone').data.length / 27 < 400, true, 'the drone rotor is just blades now, with no disc'); assert.ok(Models.extent(Models.build('drone', [1, 0, 0], [0, 1, 0])).size[0] < 0.25, 'the drone has no prop guards');
});

test('Victoria Harbour is a place with no made-up code: it is found by name and shown by name; the Airbus wears Cathay Pacific colours', () => {
  assert.equal(OSM.resolveCode('Victoria Harbour'), 'VICTORIA'); assert.equal(OSM.resolveCode('hong kong  victoria harbor'), 'VICTORIA'); assert.equal(OSM.resolveCode('VHHV'), 'VHHV', 'the old invented code is now just an unknown code');
  assert.ok(OSM.AIRPORTS.VICTORIA.place && !/^V[A-Z]{3}$/.test(OSM.AIRPORTS.VICTORIA.label)); assert.equal(OSM.AIRPORTS.VHHV, undefined);
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8'); assert.match(js, /const shownAs = code => \{ const o = OSM\.AIRPORTS\[code\]; return o && o\.place \? o\.label : code; \}/);
  const Models = require('../public/flight-models.js'), data = Models.build('airbus', [1, 0, 0], [0, 0, 1]);
  const has = (r, g, b) => { for (let i = 0; i < data.length; i += 9) if (Math.abs(data[i + 6] - r) < 0.02 && Math.abs(data[i + 7] - g) < 0.02 && Math.abs(data[i + 8] - b) < 0.02) return true; return false; };
  assert.ok(has(0.0, 0.4, 0.34), 'Cathay green tail'); assert.ok(has(0.86, 0.93, 0.9), 'brushwing strokes'); assert.ok(!has(1, 0, 0), 'the pilot colour is not used on the Airbus');
});

test('airport search also matches the city or region: "Osaka" finds Kansai (KIX) although its name has no Osaka', () => {
  const places = OSM.parsePlaces([{ category: 'place', type: 'city', name: 'Osaka', lat: '34.69', lon: '135.50' }, { category: 'highway', name: 'Osaka Street', lat: '1', lon: '1' }, { category: 'boundary', type: 'administrative', name: 'Osaka Prefecture', lat: '34.7', lon: '135.52' }, { category: 'place', name: 'Kyoto', lat: '35.01', lon: '135.77' }]);
  assert.deepEqual(places.map(p => p.name), ['Osaka', 'Kyoto'], 'places only, close duplicates dropped, at most two'); assert.match(OSM.searchPlaceUrl("Osaka'; drop"), /q=Osaka\+drop|q=Osaka%27\+drop|q=Osaka%27%3B/);
  const query = OSM.airportsQuery('Osaka', places); assert.match(query, /\["iata"\]\(around:70000,34\.6900,135\.5000\)/); assert.match(query, /\["name:en"~"Osaka",i\]/); assert.match(query, /\["name"~"Osaka",i\]/); assert.equal(OSM.airportsQuery('', []), '');
  const json = { elements: [
    { type: 'way', id: 1, center: { lat: 34.43, lon: 135.24 }, tags: { aeroway: 'aerodrome', icao: 'RJBB', iata: 'KIX', name: 'Kansai International Airport', 'name:en': 'Kansai International Airport' } },
    { type: 'way', id: 2, center: { lat: 34.78, lon: 135.44 }, tags: { aeroway: 'aerodrome', icao: 'RJOO', iata: 'ITM', name: 'Osaka International Airport', 'name:en': 'Osaka Itami Airport' } },
    { type: 'node', id: 3, lat: 34.63, lon: 135.22, tags: { aeroway: 'aerodrome', iata: 'UKB', name: 'Kobe Airport' } }, { type: 'node', id: 4, lat: 0, lon: 0, tags: { aeroway: 'aerodrome', name: 'No code field' } }] };
  const found = OSM.parseAirportElements(json, places, 'Osaka');
  assert.deepEqual(found.map(r => r.code).sort(), ['RJBB', 'RJOO', 'UKB']); assert.ok(found.find(r => r.code === 'RJOO').matched && !found.find(r => r.code === 'RJBB').matched);
  assert.match(found.find(r => r.code === 'RJBB').where, /\d+ km from Osaka/); assert.equal(found.find(r => r.code === 'UKB').iata, 'UKB');
  const merged = OSM.mergeSearch([{ code: 'RJOO', icao: 'RJOO', iata: 'ITM', name: 'Itami', matched: true, km: 0 }], found);
  assert.deepEqual(merged.map(r => r.code), ['RJOO', 'UKB', 'RJBB'], 'name matches first, then the nearest airports; one entry per code'); assert.equal(merged.length, 3);
  assert.equal(OSM.parseAirportElements({ elements: json.elements }, [{ name: 'Kansai', lat: 34.5, lon: 135.2 }], 'kansai').find(r => r.code === 'RJBB').matched, true, 'the name search matches too');
});

test('an invalid airport code never breaks the game: it goes to the default, Hong Kong International (VHHH)', () => {
  assert.equal(OSM.FALLBACK_AIRPORT, 'VHHH'); assert.ok(OSM.AIRPORTS.VHHH, 'and it is a built-in airport, so it works even offline');
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8');
  assert.match(js, /OSM\.resolveCode\(wanted\) \|\| OSM\.FALLBACK_AIRPORT/); assert.match(js, /if \(!scene\) \{ goToFallback\(error\); return; \}/); assert.match(js, /await goToFallback\(`No airport matches/);
  assert.match(js, /async function goToFallback\(reason\)[^\n]*openAirport\(OSM\.FALLBACK_AIRPORT\)/);
});

test('autopilot: off by default; once on it steers to a heading and flies to an altitude without stalling, for every aircraft', () => {
  const FLY = { surface: () => 'land', obstacle: () => null };
  const fly = (mode, speed, throttle, y, headingDeg, altitudeChange, seconds) => {
    const plane = Physics.spawn(mode, { x: 0, z: 0, heading: 0, distance: 2000, crossing: 800 }); Object.assign(plane, { y, speed, throttle, gamma: 0, flaps: 0, pitch: 0.05, heading: 0, onGround: false });
    if (mode === 'jet') { plane.vel = [0, 0, speed]; plane.axes = Physics.axesFrom(0, 0, 0); }
    const target = { heading: headingDeg * Math.PI / 180, alt: y + altitudeChange }; let stalled = false, bank = 0;
    for (let t = 0; t < seconds; t += 0.025) { Physics.step(plane, Physics.autopilot(plane, target), 0.025, FLY); stalled = stalled || plane.stalled; bank = Math.max(bank, Math.abs(plane.roll)); }
    return { plane, target, stalled, bank };
  };
  for (const [mode, args] of [['plane', [50, 0.65, 1000, 90, 200, 240]], ['plane', [50, 0.4, 1200, -60, -150, 240]], ['airbus', [110, 0.4, 3000, 120, 300, 240]], ['jet', [200, 0.75, 3000, 170, 500, 120]]]) {
    const { plane, target, stalled, bank } = fly(mode, ...args);
    assert.ok(!plane.crashed && !stalled, `${mode}: no crash or stall`); near(Math.abs(Physics.wrapAngle(plane.heading - target.heading)) * 180 / Math.PI, 0, 3, `${mode} heading`); near(plane.y, target.alt, 15, `${mode} altitude`);
    assert.ok(bank < (mode === 'jet' ? 1.4 : 0.55), `${mode}: a gentle bank for the airliner and light plane (${(bank * 57.3).toFixed(0)} degrees)`);
  }
  const level = Physics.spawn('plane', { x: 0, z: 0, heading: 0, distance: 2000 }); level.onGround = true; assert.equal(Physics.autopilot(level, { heading: 1, alt: 100 }), null, 'nothing to do on the ground');
  const drone = Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }); drone.y = 50; for (let t = 0; t < 40; t += 0.025) Physics.step(drone, { ...Physics.autopilot(drone, { heading: 1, alt: 120 }) }, 0.025, FLY);
  near(drone.y, 120, 3, 'the drone holds an altitude'); near(Physics.wrapAngle(drone.heading), 1, 0.05, 'and a heading');
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8');
  assert.match(html, /id="autoPilot"[\s\S]*id="autoThrottle"/); assert.doesNotMatch(html, /id="ap"/); assert.match(js, /let night = false, ap = \{ on: false/); assert.match(js, /KeyP/); assert.match(js, /if \(ap\.on\) applyAutopilot\(input, dt\)/); assert.match(js, /setAutopilot\(false\);/);
});

test('autopilot landing: the Cessna and the Airbus fly back to the runway from anywhere, line up, flare, touch down softly on the centreline and stop', () => {
  const runway = { x: 0, z: 0, heading: 71 * Math.PI / 180, length: 1500, width: 30, glide: 3 }, d = [Math.sin(runway.heading), Math.cos(runway.heading)], r = [Math.cos(runway.heading), -Math.sin(runway.heading)];
  const frame = (x, z) => [x * d[0] + z * d[1], x * r[0] + z * r[1]];
  const world = { obstacle: () => null, surface: (x, z) => { const [s, c] = frame(x, z); return Math.abs(c) < runway.width / 2 + 3 && s > -30 && s < runway.length + 30 ? 'runway' : 'land'; } };
  const land = (mode, start) => {
    const plane = Physics.spawn(mode, { x: 0, z: 0, heading: 0, distance: 2000 }); Object.assign(plane, { x: start.x, z: start.z, y: start.y, heading: start.heading, speed: start.speed, throttle: 0.5, flaps: 0, gamma: 0, pitch: 0.05, onGround: false });
    const memo = {}; let flapAt = 0, touch = null, phases = new Set();
    for (let t = 0; t < 1200; t += 0.025) {
      const cmd = Physics.autoland(plane, runway, memo); if (!cmd) break; phases.add(cmd.phase);
      plane.throttle += Math.max(-0.0075, Math.min(0.0075, cmd.throttle - plane.throttle)); if (t - flapAt > 1.5 && (plane.flaps || 0) !== cmd.flaps) { plane.flaps = (plane.flaps || 0) + Math.sign(cmd.flaps - (plane.flaps || 0)); flapAt = t; }
      const wasAir = !plane.onGround, sink = -plane.verticalSpeed; Physics.step(plane, { elevator: cmd.elevator, aileron: cmd.aileron, rudder: cmd.rudder, brake: cmd.brake }, 0.025, world);
      if (wasAir && plane.onGround && !touch) { const [s, c] = frame(plane.x, plane.z); touch = { s, c, sink }; }
      if (plane.crashed || cmd.done) break;
    }
    return { plane, touch, phases, end: frame(plane.x, plane.z) };
  };
  const startsFor = mode => { const v = mode === 'plane' ? 45 : 80, home = [-5200 * d[0], -5200 * d[1]]; return [{ x: home[0], z: home[1], y: 15 + Math.tan(3 * Math.PI / 180) * 5200, heading: runway.heading, speed: v }, { x: 6000, z: 5000, y: 1500, heading: 0.5, speed: v * 1.1 }, { x: 4000 * d[0] - 3000, z: 4000 * d[1] + 3000, y: 800, heading: runway.heading + Math.PI, speed: v }]; };
  for (const mode of ['plane', 'airbus']) for (const [i, start] of startsFor(mode).entries()) {
    const { plane, touch, phases, end } = land(mode, start), label = `${mode} start ${i + 1}`;
    assert.ok(!plane.crashed, `${label}: no crash (${plane.crashed})`); assert.ok(touch, `${label}: it touched down`); assert.ok(Math.abs(touch.c) < 12, `${label}: on the centreline (${Math.round(touch.c)} m off)`);
    assert.ok(touch.s > 0 && touch.s < runway.length * 0.6, `${label}: touched down on the runway, not before it or too far down (${Math.round(touch.s)} m)`); assert.ok(touch.sink < 3.6, `${label}: softly (${touch.sink.toFixed(1)} m/s)`);
    assert.ok(plane.onGround && plane.speed < 3 && end[0] < runway.length, `${label}: stopped on the runway (${Math.round(end[0])} m)`); for (const phase of ['FINAL', 'FLARE', 'ROLLOUT']) assert.ok(phases.has(phase), `${label}: ${phase}`);
  }
  assert.equal(Physics.autoland(Physics.spawn('jet', { x: 0, z: 0, heading: 0, distance: 2000 }), runway), null, 'the jet is not landed for you'); assert.equal(Physics.autoland(Physics.spawn('drone', { x: 0, z: 0, heading: 0, distance: 2000 }), runway), null);
  const js = fs.readFileSync(path.join(__dirname, '../public/flight.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/flight.html'), 'utf8');
  assert.match(html, /id="autoPilot"[\s\S]*id="autoThrottle"/); assert.doesNotMatch(html, /autoLand/, 'one button: no separate landing switch'); assert.match(js, /P\.autoland\(plane, runwayInfo\(\), ap\.memo\)/); assert.match(js, /AUTOLAND/);
});
