// OpenStreetMap reading and scene geometry for the flight simulator (a UMD module: used by the page and by the tests).
// Map data (c) OpenStreetMap contributors, ODbL. The airport, its runways and taxiways, the buildings and the shore are all read
// from OpenStreetMap through the Overpass API; nothing about an airport is hard coded except a small snapshot of its runway used
// when every Overpass server is unreachable, which the page reports as such.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.FlightOSM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EARTH = 6371008.8;
  const MIRRORS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

  // The airports to fly into. `runways` lists the runway to land on in order of preference (the first one OpenStreetMap has) and
  // `from` is the side the approach comes from, which picks the landing end. `region` is how far, in degrees around the runway,
  // buildings and the shore are read; `around` is the radius in metres for runways, taxiways and aprons.
  const AIRPORTS = {
    CYTZ: { icao: 'CYTZ', label: 'Toronto Billy Bishop', runways: ['08/26'], from: 'west', distance: 5200, around: 2200, water: 'lake', maxBuildings: 30000, region: { south: -0.0142, north: 0.0258, west: -0.0738, east: 0.0212 } },
    VHHH: { icao: 'VHHH', label: 'Hong Kong International', runways: ['07R/25L', '07L/25R', '07C/25C'], from: 'west', distance: 6500, around: 7500, water: 'coastline', maxBuildings: 20000, region: { south: -0.045, north: 0.05, west: -0.075, east: 0.06 } },
    RJTT: { icao: 'RJTT', label: 'Tokyo Haneda', runways: ['16L/34R', '16R/34L', '05/23', '04/22'], from: 'south', distance: 6500, around: 6500, water: 'coastline', maxBuildings: 30000, region: { south: -0.075, north: 0.02, west: -0.045, east: 0.045 } }
  };
  // London City: a steep 5.5 degree approach from the east along the Thames and the docks (no coastline, so no sea; the water is
  // read as open water). Victoria Harbour is a place to look around, not an airport: the flight starts over the sea west of Hong Kong
  // Island, heading east into the harbour, so it has no runway (just a placeholder at its centre).
  AIRPORTS.EGLC = { icao: 'EGLC', label: 'London City', runways: ['09/27'], from: 'east', distance: 4600, glide: 5.5, around: 1800, water: 'none', maxBuildings: 30000, region: { south: -0.03, north: 0.03, west: -0.06, east: 0.09 } };
  AIRPORTS.VHHV = { icao: 'VHHV', label: 'Hong Kong Victoria Harbour', place: { lat: 22.2925, lon: 114.168 }, start: { lat: 22.2862, lon: 114.092, heading: 78, alt: 420 }, runways: [], from: 'west', distance: 0, around: 0, water: 'coastline', maxBuildings: 30000, region: { south: -0.045, north: 0.05, west: -0.1, east: 0.06 } };
  const DEFAULT_AIRPORT = 'CYTZ';
  // Any airport can be flown into by typing its ICAO (4 character) or IATA (3 character) code: OpenStreetMap is asked for the aerodrome
  // with that tag, the longest runway is used, and it is approached from the end that points into the usual wind (westerlies outside the
  // tropics, so landing towards the west; easterly trade winds within 30 degrees of the equator, so landing towards the east).
  const ALIASES = { YTZ: 'CYTZ', HKG: 'VHHH', HND: 'RJTT', LCY: 'EGLC' };
  const SUGGESTIONS = [['KJFK', 'New York John F. Kennedy'], ['KLAX', 'Los Angeles'], ['KSFO', 'San Francisco'], ['EGLL', 'London Heathrow'], ['LFPG', 'Paris Charles de Gaulle'], ['EDDF', 'Frankfurt'], ['OMDB', 'Dubai'], ['WSSS', 'Singapore Changi'], ['YSSY', 'Sydney'], ['RKSI', 'Seoul Incheon'], ['ZBAA', 'Beijing Capital'], ['LSZH', 'Zurich']];
  const resolveCode = input => { const code = String(input || '').trim().toUpperCase(); return /^[A-Z0-9]{3,4}$/.test(code) ? (ALIASES[code] || code) : ''; };
  // Searching by name uses Nominatim, OpenStreetMap's own search service, which returns aerodromes with their ICAO / IATA tags
  // (`extratags`). Only aerodromes that have a code are offered, because the airport is then opened through the same code lookup.
  const searchUrl = text => { const q = /airport|aerodrome|airfield|airstrip/i.test(text) ? text : `${text} airport`; return `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '20', extratags: '1', addressdetails: '1', 'accept-language': 'en' })}`; };
  // Nominatim often leaves the codes out of `extratags`, so the candidates (aerodromes) are kept with their OpenStreetMap ids and the
  // missing codes are read from the elements themselves with one Overpass request (enrichQuery / applyTags).
  const OVERPASS_TYPE = { node: 'node', way: 'way', relation: 'rel' };
  function parseSearch(results) {
    const seen = new Set(), found = [];
    for (const r of Array.isArray(results) ? results : []) {
      if (!(r.category === 'aeroway' || r.class === 'aeroway') || r.type !== 'aerodrome' || !OVERPASS_TYPE[r.osm_type]) continue;
      const key = `${r.osm_type}/${r.osm_id}`; if (seen.has(key)) continue; seen.add(key);
      const tags = r.extratags || {}, a = r.address || {}, where = [a.city || a.town || a.village || a.municipality || a.county || a.state, a.country].filter(Boolean).join(', ');
      found.push({ osmType: r.osm_type, osmId: r.osm_id, name: tags['name:en'] || r.name || (r.display_name || '').split(',')[0] || '', where, ...codesOf(tags) });
    }
    return found.slice(0, 12);
  }
  function codesOf(tags) {
    const icao = String(tags.icao || '').toUpperCase(), iata = String(tags.iata || '').toUpperCase(), okIcao = /^[A-Z0-9]{4}$/.test(icao) ? icao : '', okIata = /^[A-Z0-9]{3}$/.test(iata) ? iata : '';
    return { icao: okIcao, iata: okIata, code: okIcao || okIata };
  }
  const enrichQuery = list => { const parts = list.filter(r => !r.code).map(r => `${OVERPASS_TYPE[r.osmType]}(${r.osmId});`); return parts.length ? `[out:json][timeout:25];(${parts.join('')});out tags;` : ''; };
  // Fill in the missing codes from the Overpass answer and keep only the airports that have one.
  function applyTags(list, json) {
    const byId = new Map(((json && json.elements) || []).map(e => [`${e.type}/${e.id}`, e.tags || {}]));
    return list.map(r => { if (r.code) return r; const tags = byId.get(`${r.osmType}/${r.osmId}`) || {}; return { ...r, ...codesOf(tags), name: tags['name:en'] || tags.name || r.name }; }).filter(r => r.code);
  }
  const dynamicConfig = code => ({ icao: code, label: code, runways: [], from: 'heading', landHeading: 270, distance: 5200, glide: 3, around: 3500, water: 'coastline', maxBuildings: 30000, dynamic: true, region: { south: -0.035, north: 0.035, west: -0.06, east: 0.06 } });
  const config = code => AIRPORTS[code] || AIRPORTS[DEFAULT_AIRPORT];

  // ---- queries ------------------------------------------------------------------------------------------------------------
  const airportQuery = (code = DEFAULT_AIRPORT) => { const known = AIRPORTS[code], id = known ? known.icao : code, key = id.length === 3 ? 'iata' : 'icao', around = known ? known.around : 3500; return `[out:json][timeout:60];nwr["${key}"="${id}"]->.airport;(.airport;way["aeroway"~"^(runway|taxiway|apron)$"](around.airport:${around}););out tags geom;`; };
  const bounds = (origin, region) => ({ south: origin.lat + region.south, west: origin.lon + region.west, north: origin.lat + region.north, east: origin.lon + region.east });
  const box = (origin, region) => { const b = bounds(origin, region); return `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`; };
  const buildingsQuery = (origin, region) => `[out:json][timeout:120];way["building"](${box(origin, region)});out tags geom;`;
  // The shore as complete ways. For Lake Ontario that is the outer ways (the mainland shore) and the inner ways (the islands) of
  // the lake relation that cross the box; elsewhere it is OpenStreetMap's coastline.
  const waterQueries = (origin, region, code) => config(code).water === 'none' ? [] : config(code).water === 'lake'
    ? ['outer', 'inner'].map(role => `[out:json][timeout:60];rel["natural"="water"]["name"="Lake Ontario"](${box(origin, region)})->.lake;way(r.lake:"${role}")(${box(origin, region)});out geom;`)
    : [`[out:json][timeout:60];way["natural"="coastline"](${box(origin, region)});out geom;`];

  // Inland water drawn on top of the land: lakes, ponds, harbours, rivers and reservoirs. Closed ways come whole; relations are
  // read only for the parts inside the box (their members outside it arrive as null nodes and are dropped). Lake Ontario itself is
  // the shore above, so it is left out here.
  const pondsQuery = (origin, region) => `[out:json][timeout:90];(way["natural"="water"](${box(origin, region)});way["waterway"="riverbank"](${box(origin, region)});way["landuse"~"^(basin|reservoir)$"](${box(origin, region)}););out geom;rel["natural"="water"]["name"!="Lake Ontario"](${box(origin, region)});out geom(${box(origin, region)});`;

  // ---- geography ----------------------------------------------------------------------------------------------------------
  function projector(origin) {
    const k = Math.PI / 180 * EARTH, cos = Math.cos(origin.lat * Math.PI / 180);
    return { toLocal: (lat, lon) => [(lon - origin.lon) * k * cos, (lat - origin.lat) * k], toGeo: (x, z) => ({ lat: origin.lat + z / k, lon: origin.lon + x / (k * cos) }) };
  }
  const bearing = (from, to) => (Math.atan2(to[0] - from[0], to[1] - from[1]) + 2 * Math.PI) % (2 * Math.PI);
  const centroid = nodes => { const first = nodes[0], last = nodes.at(-1); return { lat: (first[0] + last[0]) / 2, lon: (first[1] + last[1]) / 2 }; };

  // ---- reading the airport ------------------------------------------------------------------------------------------------
  const points = geometry => (geometry || []).filter(Boolean).map(p => [p.lat, p.lon]);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  // OpenStreetMap often splits one runway or shoreline into several ways: join the ones that meet end to end.
  function joinChains(chains) {
    const list = chains.map(chain => [...chain]);
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        let joined = null;
        if (same(a.at(-1), b[0])) joined = [...a, ...b.slice(1)]; else if (same(a.at(-1), b.at(-1))) joined = [...a, ...[...b].reverse().slice(1)];
        else if (same(a[0], b.at(-1))) joined = [...b, ...a.slice(1)]; else if (same(a[0], b[0])) joined = [...[...b].reverse(), ...a.slice(1)];
        if (joined) { list.splice(j, 1); list[i] = joined; merged = true; break outer; }
      }
    }
    return list;
  }
  // A place has no runway: a zero-width placeholder at its centre keeps the rest of the code (origin, projection) working.
  function placeAirport(code) {
    const o = config(code);
    return { icao: o.icao, name: o.label, elevation: 0, osmId: 'place', runways: [{ ref: '-', width: 0, nodes: [[o.place.lat, o.place.lon], [o.place.lat, o.place.lon + 0.00001]] }], taxiways: [], aprons: [] };
  }
  function parseAirport(json, code = DEFAULT_AIRPORT) {
    const elements = json.elements || [], icao = config(code).icao, aerodrome = elements.find(e => e.tags && (e.tags.icao === icao || e.tags.iata === icao) && (e.tags.aeroway === 'aerodrome' || e.tags.name || e.tags.icao || e.tags.iata));
    const ways = kind => elements.filter(e => e.type === 'way' && e.tags && e.tags.aeroway === kind && e.geometry);
    const byRef = new Map();
    for (const e of ways('runway')) { const ref = e.tags.ref || `way${e.id}`; if (!byRef.has(ref)) byRef.set(ref, { ref, width: Number(e.tags.width) || 0, chains: [] }); const entry = byRef.get(ref); entry.width = entry.width || Number(e.tags.width) || 0; entry.chains.push(points(e.geometry)); }
    const runways = [...byRef.values()].map(r => ({ ref: r.ref, width: r.width || 45, nodes: joinChains(r.chains.filter(c => c.length >= 2)).sort((a, b) => b.length - a.length)[0] })).filter(r => r.nodes && r.nodes.length >= 2);
    if (!aerodrome || !runways.length) { const error = new Error(`No runway for ${icao} in the OpenStreetMap answer`); error.code = 'not-found'; throw error; }
    return {
      icao: aerodrome.tags.icao || icao, iata: aerodrome.tags.iata || '', name: aerodrome.tags['name:en'] || aerodrome.tags.name || icao, elevation: parseFloat(aerodrome.tags.ele) || 0, osmId: `${aerodrome.type}/${aerodrome.id}`, runways,
      taxiways: ways('taxiway').map(e => ({ id: e.id, nodes: points(e.geometry) })).filter(t => t.nodes.length >= 2),
      aprons: ways('apron').map(e => ({ id: e.id, nodes: points(e.geometry) })).filter(a => a.nodes.length >= 4)
    };
  }
  // The runway to land on: the first of the airport's preferred runways that OpenStreetMap has, otherwise the longest.
  function mainRunway(airport, code = DEFAULT_AIRPORT) {
    const length = r => Math.hypot((r.nodes.at(-1)[0] - r.nodes[0][0]) * 111320, (r.nodes.at(-1)[1] - r.nodes[0][1]) * 111320 * Math.cos(r.nodes[0][0] * Math.PI / 180));
    for (const ref of config(code).runways) { const found = airport.runways.find(r => r.ref === ref); if (found) return found; }
    return [...airport.runways].sort((a, b) => length(b) - length(a))[0];
  }

  // ---- reading buildings and water ----------------------------------------------------------------------------------------
  function hash(id) { let h = (id * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; return (h ^ (h >>> 13)) >>> 0; }
  const number = value => { const n = parseFloat(String(value || '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  // Height in metres from `height`, else `building:levels` at 3.2 m a floor, else a plausible height for the building's id.
  function buildingHeight(tags, id) {
    const direct = number(tags.height), levels = number(tags['building:levels']);
    if (direct > 0) return Math.min(direct, 640);
    if (levels > 0) return Math.min(levels * 3.2 + 1.5, 640);
    return 6 + (hash(id) % 900) / 100;
  }
  const TONES = [[0.74, 0.72, 0.68], [0.66, 0.68, 0.72], [0.8, 0.76, 0.7], [0.62, 0.64, 0.66], [0.78, 0.8, 0.82], [0.7, 0.62, 0.56]];
  function parseBuildings(json, toLocal, limit = Infinity) {
    const out = [];
    for (const e of json.elements || []) {
      if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue;
      const ring = [];
      for (const p of e.geometry) { if (!p) { ring.length = 0; break; } ring.push(toLocal(p.lat, p.lon)); }
      if (ring.length < 4) continue;
      ring.pop();                                           // the last node repeats the first
      let area = 0; for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; area += x1 * z2 - x2 * z1; }
      if (Math.abs(area) / 2 < 18) continue;               // sheds and booths add triangles but no picture
      if (area < 0) ring.reverse();                         // counter-clockwise seen from above
      out.push({ id: e.id, height: buildingHeight(e.tags || {}, e.id), color: TONES[hash(e.id) % TONES.length], ring: ring.flat().map(v => Math.round(v * 10) / 10) });
    }
    // A very dense city is thinned to the buildings nearest the airport, so the scene stays light enough to draw.
    if (out.length > limit) { const near = b => Math.hypot(b.ring[0], b.ring[1]); out.sort((a, b) => near(a) - near(b)); out.length = limit; }
    return out;
  }
  // Pieces of a shoreline within the box (outside nodes arrive as null) as runs of consecutive known points.
  function runsOf(geometry) { const runs = []; let current = []; for (const p of geometry || []) { if (p) current.push(p); else { if (current.length > 1) runs.push(current); current = []; } } if (current.length > 1) runs.push(current); return runs; }
  // Lake Ontario: the sea is the whole box and the land is drawn on top of it. The mainland shore (outer ways) runs west to east
  // with the land on its north side, so it is closed along the north edge of the box; the islands (inner ways) are closed rings.
  function parseLake(results, toLocal, origin, region) {
    const [outerJson, innerJson] = results, b = bounds(origin, region), sw = toLocal(b.south, b.west), ne = toLocal(b.north, b.east), rect = [sw[0], sw[1], ne[0], ne[1]];
    const ways = json => ((json && json.elements) || []).filter(e => e.type === 'way' && e.geometry && e.geometry.length > 1).map(e => points(e.geometry));
    const outer = ways(outerJson);
    if (!outer.length) return null;
    const toXZ = chain => chain.map(([lat, lon]) => toLocal(lat, lon));
    const shore = joinChains(outer).map(chain => { const line = decimate(toXZ(chain), 25); return line[0][0] > line.at(-1)[0] ? line.reverse() : line; });
    const islands = joinChains(ways(innerJson)).map(chain => decimate(toXZ(chain), 20)).filter(ring => ring.length > 3);
    return { polygon: rectangle(rect), islands: [...landRings(shore, rect), ...islands] };
  }

  // The sea from OpenStreetMap's coastline (land is on the left of each way). The sea is the whole box, and the land is drawn on top
  // of it: closed coastlines are islands, and the ones that cross the edge of the box are closed along that edge.
  const rectangle = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  function decimate(line, spacing) { const out = [line[0]]; for (let i = 1; i < line.length - 1; i++) if (Math.hypot(line[i][0] - out.at(-1)[0], line[i][1] - out.at(-1)[1]) >= spacing) out.push(line[i]); out.push(line.at(-1)); return out; }
  // Part of the segment a-b inside the rectangle [x0, z0, x1, z1] (Liang-Barsky), or null.
  function clipSegment(a, b, [x0, z0, x1, z1]) {
    let t0 = 0, t1 = 1; const dx = b[0] - a[0], dz = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dz, a[1] - z0], [dz, z1 - a[1]]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dz], [a[0] + t1 * dx, a[1] + t1 * dz], t0, t1];
  }
  // Position of a point on the rectangle's edge, counter-clockwise from its south-west corner.
  function around(p, [x0, z0, x1, z1]) {
    const w = x1 - x0, h = z1 - z0, tol = 1e-6 * Math.max(w, h);
    if (Math.abs(p[1] - z0) < tol) return p[0] - x0;
    if (Math.abs(p[0] - x1) < tol) return w + (p[1] - z0);
    if (Math.abs(p[1] - z1) < tol) return w + h + (x1 - p[0]);
    return 2 * w + h + (z1 - p[1]);
  }
  function landRings(chains, rect) {
    const [x0, z0, x1, z1] = rect, w = x1 - x0, h = z1 - z0, perimeter = 2 * (w + h), corners = [[0, [x0, z0]], [w, [x1, z0]], [w + h, [x1, z1]], [2 * w + h, [x0, z1]]];
    const rings = [], pieces = [];
    for (let chain of chains) {
      const closed = same(chain[0], chain.at(-1));
      if (closed) { // an island: clip to the box when it crosses an edge
        const outside = chain.findIndex(p => p[0] < x0 || p[0] > x1 || p[1] < z0 || p[1] > z1);
        if (outside < 0) { let area = 0; for (let i = 0; i + 1 < chain.length; i++) area += chain[i][0] * chain[i + 1][1] - chain[i + 1][0] * chain[i][1]; if (area > 0) rings.push(chain.slice(0, -1)); continue; }
        // It crosses an edge: start it at a point outside the box, so every piece inside begins and ends on the edge.
        chain = [...chain.slice(outside, -1), ...chain.slice(0, outside), chain[outside]];
      }
      let piece = null;
      for (let i = 0; i + 1 < chain.length; i++) {
        const clipped = clipSegment(chain[i], chain[i + 1], rect);
        if (!clipped) { if (piece) { pieces.push(piece); piece = null; } continue; }
        const [from, to, t0, t1] = clipped;
        if (!piece || t0 > 0) { if (piece) pieces.push(piece); piece = [from]; }
        piece.push(to); if (t1 < 1) { pieces.push(piece); piece = null; }
      }
      if (piece) pieces.push(piece);
    }
    // Join the open pieces into rings by walking the edge of the box counter-clockwise from where each piece leaves it, to the next
    // place a piece enters, or back to where this ring began (a shore that crosses an edge more than once makes several pieces).
    const usable = pieces.filter(piece => piece.length > 1);
    const starts = usable.map((piece, index) => ({ index, t: around(piece[0], rect) })), taken = new Set();
    const ahead = (from, to) => (to - from + perimeter) % perimeter || perimeter;
    for (const first of usable.keys()) {
      if (taken.has(first)) continue;
      const ring = [], origin = around(usable[first][0], rect); let current = first;
      for (let guard = 0; guard <= usable.length; guard++) {
        taken.add(current); ring.push(...usable[current]);
        const exit = around(usable[current].at(-1), rect);
        let best = { span: ahead(exit, origin), index: -1 };
        for (const s of starts) if (!taken.has(s.index) && ahead(exit, s.t) < best.span) best = { span: ahead(exit, s.t), index: s.index };
        for (const [t, corner] of corners.map(([c, p]) => [ahead(exit, c) === perimeter ? 0 : (c - exit + perimeter) % perimeter, p]).sort((x, y) => x[0] - y[0])) if (t > 1e-9 && t < best.span) ring.push(corner);
        if (best.index < 0) break; current = best.index;
      }
      if (ring.length > 3) rings.push(ring);
    }
    return rings;
  }
  function parseCoast(json, toLocal, origin, region) {
    const b = bounds(origin, region), sw = toLocal(b.south, b.west), ne = toLocal(b.north, b.east), rect = [sw[0], sw[1], ne[0], ne[1]];
    const ways = (json.elements || []).filter(e => e.type === 'way' && e.geometry && e.geometry.length > 1).map(e => points(e.geometry));
    if (!ways.length) return null;
    const chains = joinChains(ways).map(chain => decimate(chain.map(([lat, lon]) => toLocal(lat, lon)), 25));
    const rings = landRings(chains, rect);
    return { polygon: rectangle(rect), islands: rings };
  }
  // `results` holds the Overpass answers to waterQueries, in order.
  const parseWater = (results, toLocal, origin, region, code) => config(code).water === 'none' ? null : config(code).water === 'lake' ? parseLake(results, toLocal, origin, region) : parseCoast(results[0], toLocal, origin, region);

  // Rings of open water from the pondsQuery answer: [{ ring: [[x, z], ...], holes: [ring, ...], box: [x0, z0, x1, z1] }].
  function parsePonds(json, toLocal) {
    const ring = chain => { if (!chain || chain.length < 4) return null; const line = decimate(chain.map(([lat, lon]) => toLocal(lat, lon)), 6); if (same(line[0], line.at(-1))) line.pop(); return line.length >= 3 ? line : null; };
    const closed = chain => chain.length > 3 && same(chain[0], chain.at(-1));
    const extent = r => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; };
    const out = [], add = (outer, holes) => out.push({ ring: outer, holes, box: extent(outer) });
    for (const e of (json && json.elements) || []) {
      if (e.type === 'way') { if (!e.geometry || !e.geometry.every(Boolean)) continue; const chain = points(e.geometry), r = closed(chain) ? ring(chain) : null; if (r) add(r, []); continue; }
      if (e.type !== 'relation' || !e.members) continue;
      // Members partly outside the box arrive with null nodes: keep the runs inside it, join them end to end, and keep the closed rings.
      // A river that crosses the whole box leaves two open banks: they are closed into one ring across the box (nearest ends together).
      const joined = role => joinChains(e.members.filter(m => m.type === 'way' && m.role === role && m.geometry).flatMap(m => runsOf(m.geometry).map(points)));
      const holes = joined('inner').filter(closed).map(ring).filter(Boolean), outers = joined('outer'), rings = outers.filter(closed);
      const open = outers.filter(c => !closed(c));
      if (open.length === 2) { const [a, b] = open, gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]); rings.push(gap(a.at(-1), b[0]) <= gap(a.at(-1), b.at(-1)) ? [...a, ...b] : [...a, ...[...b].reverse()]); }
      for (const outer of rings) { const r = ring(outer); if (r) add(r, holes.filter(h => inside(r, h[0][0], h[0][1]))); }
    }
    return out;
  }

  // ---- the scene ----------------------------------------------------------------------------------------------------------
  // The two ends of a runway in local metres, ordered threshold first: the landing end is on the side the approach comes from.
  function landingEnds(runway, code, toLocal) {
    let pts = runway.nodes.map(([lat, lon]) => toLocal(lat, lon));
    if (config(code).landHeading != null) {   // land towards the wanted heading (into the usual wind)
      const diff = Math.abs((((bearing(pts[0], pts.at(-1)) * 180 / Math.PI - config(code).landHeading) % 360) + 540) % 360 - 180);
      return diff > 90 ? [...pts].reverse() : pts;
    }
    const key = { west: p => p[0], east: p => -p[0], south: p => p[1], north: p => -p[1] }[config(code).from];
    if (key(pts[0]) > key(pts.at(-1))) pts = [...pts].reverse();
    return pts;
  }
  // The area to read: the airport's usual region, grown to hold the whole approach path (a runway at 071 degrees puts the start of
  // a 5 km final nearly 2 km off to the side of the runway's middle).
  function regionFor(airport, code) {
    if (config(code).place) return { ...config(code).region };
    const options = config(code), runway = mainRunway(airport, code), origin = centroid(runway.nodes), { toLocal, toGeo } = projector(origin);
    const pts = landingEnds(runway, code, toLocal), heading = bearing(pts[0], pts.at(-1));
    const start = toGeo(pts[0][0] - Math.sin(heading) * options.distance, pts[0][1] - Math.cos(heading) * options.distance), margin = 0.012, region = { ...options.region };
    region.south = Math.min(region.south, start.lat - origin.lat - margin); region.north = Math.max(region.north, start.lat - origin.lat + margin);
    region.west = Math.min(region.west, start.lon - origin.lon - margin); region.east = Math.max(region.east, start.lon - origin.lon + margin);
    return region;
  }
  // The runway is written either way round in OpenStreetMap. The landing end is the one on the side the approach comes from.
  function buildScene({ airport, buildings, water, ponds, region }, source = 'openstreetmap', code = airport.icao) {
    const scene_region = region || config(code).region;
    const options = config(code), runway = mainRunway(airport, code), origin = centroid(runway.nodes);
    const { toLocal, toGeo } = projector(origin);
    const line = nodes => nodes.map(([lat, lon]) => toLocal(lat, lon));
    const runwayPoints = landingEnds(runway, code, toLocal);
    const bb = bounds(origin, scene_region), sw = toLocal(bb.south, bb.west), ne = toLocal(bb.north, bb.east);
    const threshold = runwayPoints[0], far = runwayPoints.at(-1);
    const place = Boolean(options.place), at = place ? toLocal(options.start.lat, options.start.lon) : null;
    return {
      place, glide: options.glide || 3, start: place ? { x: at[0], z: at[1], heading: options.start.heading * Math.PI / 180, alt: options.start.alt } : null,
      source, region: scene_region, code: options.icao, label: options.label, distance: options.distance, origin, toLocal, toGeo, airport: { icao: airport.icao, iata: airport.iata || '', name: airport.name, elevation: airport.elevation, osmId: airport.osmId },
      runway: { ref: runway.ref, width: runway.width, points: runwayPoints, threshold, far, heading: bearing(threshold, far), length: Math.hypot(far[0] - threshold[0], far[1] - threshold[1]) },
      otherRunways: airport.runways.filter(r => r !== runway).map(r => ({ ref: r.ref, width: r.width, points: line(r.nodes) })),
      taxiways: airport.taxiways.map(t => line(t.nodes)), aprons: airport.aprons.map(a => line(a.nodes)),
      buildings: buildings || [], water: water || null, ponds: ponds || [], rect: [sw[0], sw[1], ne[0], ne[1]], tileGrid: { south: scene_region.south, west: scene_region.west }
    };
  }
  // Everything is read from OpenStreetMap: the airport first (it fixes the origin), then buildings and water around it.
  async function load(fetchJson, code = DEFAULT_AIRPORT) {
    const dynamic = !AIRPORTS[code]; if (dynamic) AIRPORTS[code] = dynamicConfig(code);
    let airport; try { airport = config(code).place ? placeAirport(code) : parseAirport(await fetchJson(airportQuery(code)), code); } catch (error) { if (dynamic) delete AIRPORTS[code]; throw error; }
    if (dynamic) { const o = AIRPORTS[code], middle = centroid(mainRunway(airport, code).nodes); o.label = airport.name; o.landHeading = Math.abs(middle.lat) < 30 ? 90 : 270; }
    const origin = centroid(mainRunway(airport, code).nodes), { toLocal } = projector(origin), region = regionFor(airport, code);
    const [buildingJson, pondJson, ...waterJson] = await Promise.all([fetchJson(buildingsQuery(origin, region)), fetchJson(pondsQuery(origin, region)).catch(() => null), ...waterQueries(origin, region, code).map(query => fetchJson(query).catch(() => null))]);
    let water = null; try { water = waterJson.some(Boolean) ? parseWater(waterJson, toLocal, origin, region, code) : null; } catch (error) { water = null; }
    let ponds = []; try { ponds = parsePonds(pondJson, toLocal); } catch (error) { ponds = []; }
    return buildScene({ airport, buildings: parseBuildings(buildingJson, toLocal, config(code).maxBuildings), water, ponds, region }, 'openstreetmap', code);
  }

  // ---- geometry -----------------------------------------------------------------------------------------------------------
  // Point in polygon for a flat ring [x0, z0, x1, z1, ...] or a list of [x, z] pairs.
  function inside(ring, x, z) {
    const flat = typeof ring[0] === 'number', n = flat ? ring.length / 2 : ring.length;
    let result = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = flat ? ring[2 * i] : ring[i][0], zi = flat ? ring[2 * i + 1] : ring[i][1], xj = flat ? ring[2 * j] : ring[j][0], zj = flat ? ring[2 * j + 1] : ring[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) result = !result;
    }
    return result;
  }
  // Ear clipping: triangles [ax, az, bx, bz, cx, cz, ...] covering a simple polygon given as [[x, z], ...]. Only reflex corners are
  // tested against each candidate ear, which keeps long shorelines fast.
  function triangulate(ring) {
    const n = ring.length; if (n < 3) return [];
    let area = 0; for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const index = Array.from({ length: n }, (_, i) => i); if (area < 0) index.reverse();
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const within = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    const out = []; let guard = 0;
    const reflexAt = i => { const m = index.length; return cross(ring[index[(i + m - 1) % m]], ring[index[i]], ring[index[(i + 1) % m]]) <= 1e-9; };
    while (index.length > 3 && guard++ < n * 4) {
      const reflex = []; for (let i = 0; i < index.length; i++) if (reflexAt(i)) reflex.push(ring[index[i]]);
      let clipped = false;
      for (let i = 0; i < index.length && !clipped; i++) {
        const a = ring[index[(i + index.length - 1) % index.length]], b = ring[index[i]], c = ring[index[(i + 1) % index.length]];
        if (cross(a, b, c) <= 1e-9) continue;
        if (reflex.some(p => p !== a && p !== b && p !== c && within(p, a, b, c))) continue;
        out.push(a[0], a[1], b[0], b[1], c[0], c[1]); index.splice(i, 1); clipped = true;
      }
      if (!clipped) index.splice(0, 1);                       // a degenerate sliver: drop a point and carry on
    }
    if (index.length === 3) out.push(...index.flatMap(k => ring[k]));
    return out;
  }
  // A strip of the given width along a polyline, as triangles [x, z, ...].
  function ribbon(pointsList, width) {
    const out = [];
    for (let i = 0; i + 1 < pointsList.length; i++) {
      const [x1, z1] = pointsList[i], [x2, z2] = pointsList[i + 1], length = Math.hypot(x2 - x1, z2 - z1) || 1, nx = -(z2 - z1) / length * width / 2, nz = (x2 - x1) / length * width / 2;
      out.push(x1 + nx, z1 + nz, x1 - nx, z1 - nz, x2 + nx, z2 + nz, x2 + nx, z2 + nz, x1 - nx, z1 - nz, x2 - nx, z2 - nz);
    }
    return out;
  }
  const distanceToSegment = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0; return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };

  // What the plane can touch: a spatial grid of buildings, and the kind of ground at any point. More map (tiles) can be added as
  // the plane flies on and removed again behind it.
  function createWorld(scene) {
    const CELL = 100, grid = new Map(), key = (cx, cz) => `${cx},${cz}`, ids = new Set(), tiles = new Map();
    const index = (building, add) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < building.ring.length; i += 2) { minX = Math.min(minX, building.ring[i]); maxX = Math.max(maxX, building.ring[i]); minZ = Math.min(minZ, building.ring[i + 1]); maxZ = Math.max(maxZ, building.ring[i + 1]); }
      building.box = [minX, minZ, maxX, maxZ];
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = key(cx, cz);
        if (add) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(building); } else { const list = grid.get(k); if (list) { const at = list.indexOf(building); if (at >= 0) list.splice(at, 1); if (!list.length) grid.delete(k); } }
      }
    };
    const rectOf = water => { const xs = water.polygon.map(p => p[0]), zs = water.polygon.map(p => p[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
    const home = { key: 'home', rect: scene.rect || null, buildings: scene.buildings || [], water: scene.water || null, ponds: scene.ponds || [] };
    const register = tile => {
      if (tile !== home) tile.buildings = tile.buildings.filter(b => !ids.has(b.id));
      for (const b of tile.buildings) { ids.add(b.id); index(b, true); }
      if (tile.water) tile.waterRect = rectOf(tile.water);
      tiles.set(tile.key, tile);
    };
    register(home);
    const hard = [[scene.runway.points, scene.runway.width / 2 + 3], ...(scene.otherRunways || []).map(r => [r.points, r.width / 2 + 3]), ...(scene.taxiways || []).map(t => [t, 9])];
    const onHard = (x, z) => hard.some(([pts, half]) => { for (let i = 0; i + 1 < pts.length; i++) if (distanceToSegment(x, z, pts[i], pts[i + 1]) <= half) return true; return false; });
    const within = (rect, x, z) => x >= rect[0] && x <= rect[2] && z >= rect[1] && z <= rect[3];
    return {
      home, tiles,
      obstacle(x, y, z) {
        const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!cell) return null;
        for (const b of cell) if (y <= b.height && x >= b.box[0] && x <= b.box[2] && z >= b.box[1] && z <= b.box[3] && inside(b.ring, x, z)) return b;
        return null;
      },
      // Whether map data has been read for this point.
      covered(x, z) { for (const tile of tiles.values()) if (tile.rect && within(tile.rect, x, z)) return true; return !home.rect; },
      addTile(tile) { if (!tiles.has(tile.key)) register(tile); return tile; },
      removeTile(tileKey) { const tile = tiles.get(tileKey); if (!tile || tile === home) return; for (const b of tile.buildings) { ids.delete(b.id); index(b, false); } tiles.delete(tileKey); },
      surface(x, z) {
        if (onHard(x, z)) return 'runway';
        for (const tile of tiles.values()) for (const pond of tile.ponds || []) if (within(pond.box, x, z) && inside(pond.ring, x, z) && !pond.holes.some(hole => inside(hole, x, z))) return 'water';
        for (const tile of tiles.values()) { const water = tile.water; if (water && within(tile.waterRect, x, z) && inside(water.polygon, x, z) && !water.islands.some(island => inside(island, x, z))) return 'water'; }
        return 'land';
      }
    };
  }

  // ---- more map as the plane flies on -------------------------------------------------------------------------------------
  // The ground beyond the first region is read in cells of a fixed size laid out from the region's corner, a few at a time.
  const TILE = { lat: 0.03, lon: 0.04 }, TILE_BUILDINGS = 12000;
  const tileKey = (i, j) => `${i},${j}`;
  function tileCell(scene, x, z) { const g = scene.tileGrid, { lat, lon } = scene.toGeo(x, z); return [Math.floor((lon - scene.origin.lon - g.west) / TILE.lon), Math.floor((lat - scene.origin.lat - g.south) / TILE.lat)]; }
  function tileRegion(scene, i, j) { const g = scene.tileGrid; return { south: g.south + j * TILE.lat, north: g.south + (j + 1) * TILE.lat, west: g.west + i * TILE.lon, east: g.west + (i + 1) * TILE.lon }; }
  function tileRect(scene, i, j) { const b = bounds(scene.origin, tileRegion(scene, i, j)), sw = scene.toLocal(b.south, b.west), ne = scene.toLocal(b.north, b.east); return [sw[0], sw[1], ne[0], ne[1]]; }
  // A cell with no coastline in it is all sea or all land: the same as the already known ground next to it.
  function inheritsSea(world, rect) {
    const [x0, z0, x1, z1] = rect, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, edge = 40;
    const votes = [[x0 - edge, mz], [x1 + edge, mz], [mx, z0 - edge], [mx, z1 + edge]].filter(([x, z]) => world.covered(x, z)).map(([x, z]) => world.surface(x, z) === 'water');
    return votes.length > 0 && votes.filter(Boolean).length * 2 > votes.length;
  }
  async function loadTile(fetchJson, scene, world, i, j) {
    const region = tileRegion(scene, i, j), rect = tileRect(scene, i, j), { origin, code, toLocal } = scene;
    const [buildingJson, pondJson, ...waterJson] = await Promise.all([fetchJson(buildingsQuery(origin, region)), fetchJson(pondsQuery(origin, region)).catch(() => null), ...waterQueries(origin, region, code).map(query => fetchJson(query).catch(() => null))]);
    let water = null; try { water = waterJson.some(Boolean) ? parseWater(waterJson, toLocal, origin, region, code) : null; } catch (error) { water = null; }
    if (!water && inheritsSea(world, rect)) water = { polygon: rectangle(rect), islands: [] };
    let ponds = []; try { ponds = parsePonds(pondJson, toLocal); } catch (error) { ponds = []; }
    const mid = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2], buildings = parseBuildings(buildingJson, toLocal, Infinity);
    buildings.sort((a, b) => Math.hypot(a.ring[0] - mid[0], a.ring[1] - mid[1]) - Math.hypot(b.ring[0] - mid[0], b.ring[1] - mid[1])); buildings.length = Math.min(buildings.length, TILE_BUILDINGS);
    return { key: tileKey(i, j), i, j, rect, buildings, water, ponds };
  }

  // The plane on final approach for the runway: before the threshold, lined up with the centre line.
  const finalApproach = scene => scene.place ? { x: scene.start.x, z: scene.start.z, heading: scene.start.heading } : ({ x: scene.runway.threshold[0], z: scene.runway.threshold[1], heading: scene.runway.heading });

  // ---- snapshots used when OpenStreetMap cannot be reached ------------------------------------------------------------------
  // Runway nodes copied from OpenStreetMap (CYTZ ways 5687568 and 7769081; VHHH ways 510284409 and 4956469; RJTT ways 865448352,
  // 322815280 and 510409992). Buildings are generated and the shore is a rough sketch, so the page says it is offline data.
  const SNAPSHOTS = {
    CYTZ: { name: 'Billy Bishop Toronto City Airport', ele: 77, osm: 'relation/85471', runways: [
      ['08/26', 30, [[[43.6309823, -79.3890786], [43.6308773, -79.3895058], [43.63079, -79.3898609], [43.6304526, -79.3912335], [43.6303292, -79.3917356], [43.6302552, -79.3920363], [43.630191, -79.3922976], [43.6301253, -79.3925648], [43.6292862, -79.395978], [43.6291432, -79.3965597], [43.628486, -79.399233], [43.6283928, -79.3996122], [43.627654, -79.4026174], [43.6274725, -79.4033557]]]],
      ['06/24', 30, [[[43.6301953, -79.390473], [43.6298394, -79.3910411], [43.6297104, -79.3912469], [43.6294148, -79.3917333], [43.6294028, -79.391753], [43.6268769, -79.3959096], [43.626341, -79.3967757], [43.6261718, -79.3970491], [43.6258795, -79.3975586]]]]] },
    VHHH: { name: 'Hong Kong International Airport', ele: 9, osm: 'relation/16105017', runways: [
      ['07R/25L', 60, [[[22.296234, 113.897974], [22.296273, 113.898094], [22.296558, 113.899015], [22.296702, 113.899423]], [[22.296702, 113.899423], [22.296755, 113.899588], [22.29766, 113.902396], [22.299294, 113.907462], [22.301239, 113.913495], [22.302845, 113.918475], [22.304866, 113.924742], [22.306556, 113.929986], [22.307469, 113.932816]]]]] },
    EGLC: { name: 'London City Airport', ele: 6, osm: 'way/121158889', runways: [['09/27', 30, [[[51.505524, 0.045733], [51.504921, 0.064982]]]]] },
    VHHV: { name: 'Hong Kong Victoria Harbour', ele: 0, osm: 'place', runways: [['-', 0, [[[22.2925, 114.168], [22.2925, 114.16801]]]]] },
    RJTT: { name: 'Tokyo International Airport (Haneda)', ele: 6, osm: 'relation/17864987', runways: [
      ['16L/34R', 60, [[[35.565866, 139.786559], [35.563502, 139.788242], [35.562858, 139.7887]], [[35.562858, 139.7887], [35.560267, 139.790539], [35.555161, 139.794165], [35.548785, 139.798681], [35.544953, 139.8014], [35.542511, 139.803143]], [[35.539712, 139.805119], [35.540219, 139.804759], [35.542511, 139.803143]]]]] }
  };
  function fallbackScene(code = DEFAULT_AIRPORT) {
    const snap = SNAPSHOTS[config(code).icao] || SNAPSHOTS.CYTZ, options = config(snap === SNAPSHOTS.CYTZ ? DEFAULT_AIRPORT : code);
    const airport = { icao: options.icao, name: snap.name, elevation: snap.ele, osmId: `snapshot of ${snap.osm}`, runways: snap.runways.map(([ref, width, chains]) => ({ ref, width, nodes: joinChains(chains)[0] })), taxiways: [], aprons: [] };
    const runway = mainRunway(airport, options.icao), origin = centroid(runway.nodes), { toLocal } = projector(origin);
    const rng = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
    const buildings = [];
    const town = options.icao === 'CYTZ' ? [43.6345, 43.6515, origin.lon - 0.05, origin.lon + 0.02] : [origin.lat - 0.012, origin.lat + 0.012, origin.lon - 0.03, origin.lon + 0.03];
    for (let i = 0; i < (options.icao === 'CYTZ' ? 700 : 260); i++) {     // a downtown (or terminals and hangars) of generated blocks
      const lat = town[0] + rng() * (town[1] - town[0]), lon = town[2] + rng() * (town[3] - town[2]), [x, z] = toLocal(lat, lon), w = 18 + rng() * 40, d = 18 + rng() * 40, tall = options.icao === 'CYTZ' && rng() < 0.12;
      if (options.icao !== 'CYTZ' && Math.hypot(x, z) < 450) continue;
      buildings.push({ id: i + 1, height: tall ? 80 + rng() * 220 : 10 + rng() * 40, color: TONES[i % TONES.length], ring: [x, z, x + w, z, x + w, z + d, x, z + d].map(v => Math.round(v * 10) / 10) });
    }
    const region = regionFor(airport, options.icao), b = bounds(origin, region), rect = [toLocal(b.south, b.west), toLocal(b.north, b.east)].flat();
    const [minX, minZ, maxX, maxZ] = rect;
    const land = options.icao === 'CYTZ' ? [[43.6245, -79.4130], [43.6314, -79.4040], [43.6320, -79.3880], [43.6290, -79.3790], [43.6235, -79.3790], [43.6215, -79.4000]].map(([lat, lon]) => toLocal(lat, lon)) : [[-2200, -900], [2200, -900], [2200, 900], [-2200, 900]];
    const shore = options.icao === 'CYTZ' ? [[43.6363, -79.4702], [43.6363, -79.4615], [43.629, -79.4226], [43.6311, -79.41], [43.6418, -79.3745]].map(([lat, lon]) => toLocal(lat, lon)) : null;
    // Sea everywhere; the land is the mainland north of the shore plus the island (or a rough block of land around the runway).
    const mainland = shore ? [[minX, shore[0][1]], ...shore, [maxX, shore.at(-1)[1]], [maxX, maxZ], [minX, maxZ]] : null;
    // A place is all sea in the sketch; London City has no sea.
    const water = options.water === 'none' ? null : options.place ? { polygon: rectangle(rect), islands: [] } : { polygon: rectangle(rect), islands: mainland ? [mainland, land] : [land] };
    return buildScene({ airport, buildings, water, region }, 'snapshot', options.icao);
  }

  // ---- meshes -------------------------------------------------------------------------------------------------------------
  // Interleaved vertices: x, y, z, normal x, y, z, red, green, blue. Face culling is off, so winding does not matter.
  const COLORS = { land: [0.36, 0.5, 0.3], water: [0.13, 0.3, 0.48], island: [0.4, 0.52, 0.32], apron: [0.46, 0.47, 0.5], taxiway: [0.4, 0.41, 0.44], runway: [0.2, 0.21, 0.23], paint: [0.92, 0.92, 0.88] };
  const writer = data => ({
    vertex: (x, y, z, nx, ny, nz, c) => data.push(x, y, z, nx, ny, nz, c[0], c[1], c[2]),
    flat(tris, y, color) { for (let i = 0; i < tris.length; i += 2) data.push(tris[i], y, tris[i + 1], 0, 1, 0, color[0], color[1], color[2]); }
  });
  // The flat ground of one piece of map (sea, land, open water), drawn in this order without a depth test so layers never flicker,
  // and its buildings (solid, depth tested).
  function tileParts(tile) {
    const ground = [], solid = [], g = writer(ground), s = writer(solid);
    if (tile.water) { g.flat(triangulate(tile.water.polygon), -0.4, COLORS.water); for (const land of tile.water.islands) g.flat(triangulate(land), -0.3, COLORS.island); }
    for (const pond of tile.ponds || []) { g.flat(triangulate(pond.ring), -0.2, COLORS.water); for (const hole of pond.holes) g.flat(triangulate(hole), -0.1, COLORS.island); }
    for (const b of tile.buildings) {
      const ring = []; for (let i = 0; i < b.ring.length; i += 2) ring.push([b.ring[i], b.ring[i + 1]]);
      const shade = [b.color[0] * 0.92, b.color[1] * 0.92, b.color[2] * 0.92];
      for (let i = 0; i < ring.length; i++) {
        const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length], l = Math.hypot(x2 - x1, z2 - z1) || 1, nx = (z2 - z1) / l, nz = -(x2 - x1) / l;
        s.vertex(x1, 0, z1, nx, 0, nz, shade); s.vertex(x2, 0, z2, nx, 0, nz, shade); s.vertex(x2, b.height, z2, nx, 0, nz, b.color);
        s.vertex(x1, 0, z1, nx, 0, nz, shade); s.vertex(x2, b.height, z2, nx, 0, nz, b.color); s.vertex(x1, b.height, z1, nx, 0, nz, b.color);
      }
      const roof = [b.color[0] * 0.8, b.color[1] * 0.8, b.color[2] * 0.82], tris = triangulate(ring);
      const lift = (b.id % 7) * 0.02;                      // overlapping building parts never share one exact roof height
      for (let i = 0; i < tris.length; i += 2) s.vertex(tris[i], b.height + lift, tris[i + 1], 0, 1, 0, roof);
    }
    return { ground: new Float32Array(ground), solid: new Float32Array(solid) };
  }
  // The first region: land everywhere, its sea, open water and buildings, then the airport's aprons, taxiways, runways and markings.
  function meshParts(scene) {
    const home = tileParts({ water: scene.water, ponds: scene.ponds, buildings: scene.buildings }), land = [], airport = [], l = writer(land), g = writer(airport), big = 40000;
    l.flat([-big, -big, big, -big, big, big, -big, -big, big, big, -big, big], -0.5, COLORS.land);
    for (const apron of scene.aprons) g.flat(triangulate(apron), 0.02, COLORS.apron);
    for (const taxiway of scene.taxiways) g.flat(ribbon(taxiway, 15), 0.04, COLORS.taxiway);
    for (const runway of [scene.runway, ...scene.otherRunways]) g.flat(ribbon(runway.points, runway.width), 0.06, COLORS.runway);
    const [wx, wz] = scene.runway.threshold, dx = Math.sin(scene.runway.heading), dz = Math.cos(scene.runway.heading);
    for (let t = 30; t + 18 < scene.runway.length - 30; t += 40) g.flat(ribbon([[wx + dx * t, wz + dz * t], [wx + dx * (t + 18), wz + dz * (t + 18)]], 0.9), 0.08, COLORS.paint);
    for (let i = -4; i <= 4; i++) { if (!i) continue; const ox = Math.cos(scene.runway.heading) * i * 3, oz = -Math.sin(scene.runway.heading) * i * 3; g.flat(ribbon([[wx + ox + dx * 8, wz + oz + dz * 8], [wx + ox + dx * 40, wz + oz + dz * 40]], 1.2), 0.08, COLORS.paint); }
    return { base: new Float32Array(land), ground: new Float32Array([...home.ground, ...airport]), solid: home.solid };
  }
  // Everything in one array (ground first), for tests and simple uses.
  function buildMesh(scene) { const { base, ground, solid } = meshParts(scene), all = new Float32Array(base.length + ground.length + solid.length); all.set(base); all.set(ground, base.length); all.set(solid, base.length + ground.length); return all; }

  return { AIRPORTS, DEFAULT_AIRPORT, MIRRORS, airportQuery, buildingsQuery, waterQueries, regionFor, landingEnds, projector, bearing, joinChains, parseAirport, mainRunway, parseBuildings, parseWater, parseLake, parseCoast, landRings, buildingHeight, buildScene, load, searchUrl, parseSearch, enrichQuery, applyTags, ALIASES, SUGGESTIONS, resolveCode, inside, triangulate, ribbon, createWorld, finalApproach, fallbackScene, buildMesh, meshParts, tileParts, pondsQuery, parsePonds, TILE, tileCell, tileKey, tileRegion, tileRect, loadTile, COLORS };
});
