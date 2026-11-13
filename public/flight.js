// Flight simulator page: reads OpenStreetMap, flies a small plane in 3D and shares only the plane's position.
(() => {
  const $ = selector => document.querySelector(selector);
  const P = FlightPhysics, OSM = FlightOSM, R = FlightRender;
  const clientId = (() => { let id = sessionStorage.getItem('arcade-client'); if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('arcade-client', id); } return id; })();
  const SCALES = [1, 2, 5, 10, 50, 100], FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const streaming = { pending: new Map(), failed: new Map(), last: 0 }, ZOOMS = [2000, 6000, 20000, 60000], FLAPS = [0, 10, 20, 30];
  let zoom = 1, mapAt = 0, hudRead = null, hudAt = 0;
  let scene, world, renderer, plane, socket, selfId = '', others = [], scale = 1, cameraMode = 'chase', last = 0, shareAt = 0, reconnect, reconnectDelay = 500, state = 'loading', loadingToken = 0, notice = '';
  const keys = new Set();
  const hudContext = $('#hud').getContext('2d');

  // ---- reading OpenStreetMap (cached in the browser for a week) ---------------------------------------------------------------
  const database = () => new Promise(resolve => { try { const open = indexedDB.open('arcade-flight', 1); open.onupgradeneeded = () => open.result.createObjectStore('osm'); open.onsuccess = () => resolve(open.result); open.onerror = () => resolve(null); } catch { resolve(null); } });
  const cached = async key => { const db = await database(); if (!db) return null; return new Promise(resolve => { const request = db.transaction('osm').objectStore('osm').get(key); request.onsuccess = () => resolve(request.result && Date.now() - request.result.at < 7 * 864e5 ? request.result.json : null); request.onerror = () => resolve(null); }); };
  const remember = async (key, json) => { const db = await database(); if (db) try { db.transaction('osm', 'readwrite').objectStore('osm').put({ at: Date.now(), json }, key); } catch { /* the cache is only an optimisation */ } };
  async function fetchOverpass(query) {
    const hit = await cached(query); if (hit) return hit;
    const controllers = [];
    const attempt = base => { const controller = new AbortController(); controllers.push(controller); setTimeout(() => controller.abort(), 120000);
      return fetch(`${base}?data=${encodeURIComponent(query)}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(String(response.status)); const json = await response.json(); if (!Array.isArray(json.elements)) throw new Error('no elements'); return json; }); };
    const json = await Promise.any(OSM.MIRRORS.map(attempt)); controllers.forEach(controller => controller.abort());
    remember(query, json); return json;
  }
  const progress = (text, fraction) => { $('#loadingText').textContent = text; $('#loadingBar').style.width = `${Math.round(fraction * 100)}%`; };
  const nextFrame = () => new Promise(resolve => setTimeout(resolve, 20));
  const preferred = () => { const wanted = new URLSearchParams(location.search).get('airport') || localStorage.getItem('flight-airport'); return OSM.AIRPORTS[wanted] ? wanted : OSM.DEFAULT_AIRPORT; };

  async function loadScene(code) {
    const label = OSM.AIRPORTS[code].label;
    try {
      let count = 0;
      const spy = async query => { count++; progress(count === 1 ? `Reading OpenStreetMap: ${label} airport…` : `Reading OpenStreetMap: buildings and the shore around ${label} (cached after the first visit)…`, count === 1 ? 0.15 : 0.3); return fetchOverpass(query); };
      return { scene: await OSM.load(spy, code), note: '' };
    } catch (error) {
      console.warn('OpenStreetMap could not be read:', error);
      return { scene: OSM.fallbackScene(code), note: 'Offline map: OpenStreetMap could not be reached' };
    }
  }

  // ---- the plane -------------------------------------------------------------------------------------------------------------
  function respawn(notify = true) {
    const a = OSM.finalApproach(scene);
    plane = P.approach({ x: a.x, z: a.z, heading: a.heading, distance: scene.distance });
    $('#crash').hidden = true; state = 'flying'; syncThrottle();
    if (notify && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'respawn' }));
  }
  function setFlaps(notches) { if (!plane) return; plane.flaps = Math.max(0, Math.min(3, notches)); $('#flapsValue').textContent = `${FLAPS[plane.flaps]}°`; }
  function syncThrottle() { setFlaps(plane.flaps || 0); const percent = Math.round(plane.throttle * 100); $('#throttle').value = percent; $('#throttleValue').textContent = `${percent}%`; }

  // ---- controls ---------------------------------------------------------------------------------------------------------------
  const KEYMAP = { KeyW: 'noseDown', ArrowUp: 'noseDown', KeyS: 'noseUp', ArrowDown: 'noseUp', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'rudderLeft', KeyE: 'rudderRight', ShiftLeft: 'moreThrottle', ShiftRight: 'moreThrottle', PageUp: 'moreThrottle', Equal: 'moreThrottle', KeyZ: 'lessThrottle', PageDown: 'lessThrottle', Minus: 'lessThrottle', Space: 'brake', KeyB: 'brake' };
  const held = action => [...keys].some(code => KEYMAP[code] === action);
  function setScale(value) {
    scale = value;
    document.querySelectorAll('[data-scale]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.scale) === value)));
  }
  function setCamera(mode) { cameraMode = mode; $('#camera').setAttribute('aria-pressed', String(mode === 'cockpit')); }
  function toggleHelp(force) { const open = force ?? $('#keys').hidden; $('#keys').hidden = !open; $('#help').setAttribute('aria-pressed', String(open)); }
  const focusView = () => $('#view').focus({ preventScroll: true });
  addEventListener('keydown', event => {
    // Typing in a text box or using the shared top bar is never flying; buttons, the throttle slider and the airport list are fine.
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('.arcade-topbar,.arcade-debug-panel') || event.target.matches?.('input:not(#throttle),textarea,[contenteditable="true"]')) return;
    if (event.target.id === 'airport' && /^(Arrow|Page|Home|End)/.test(event.code)) return;
    const digit = /^Digit([1-6])$/.exec(event.code);
    if (digit) { setScale(SCALES[Number(digit[1]) - 1]); event.preventDefault(); return; }
    if (event.code === 'KeyC') { setCamera(cameraMode === 'chase' ? 'cockpit' : 'chase'); return; }
    if (event.code === 'KeyH') { toggleHelp(); return; }
    if ((event.code === 'KeyF' || event.code === 'KeyV') && plane) { if (!event.repeat) setFlaps((plane.flaps || 0) + (event.code === 'KeyF' ? 1 : -1)); return; }
    if ((event.code === 'KeyR' || event.code === 'Enter') && state !== 'loading') { respawn(); return; }
    if (KEYMAP[event.code]) { keys.add(event.code); event.preventDefault(); }
  });
  addEventListener('keyup', event => keys.delete(event.code));
  addEventListener('blur', () => keys.clear());
  document.querySelectorAll('[data-scale]').forEach(button => button.onclick = () => { setScale(Number(button.dataset.scale)); focusView(); });
  $('#camera').onclick = () => { setCamera(cameraMode === 'chase' ? 'cockpit' : 'chase'); focusView(); };
  $('#help').onclick = () => { toggleHelp(); focusView(); };
  $('#flapsUp').onclick = () => { setFlaps((plane?.flaps || 0) - 1); focusView(); }; $('#flapsDown').onclick = () => { setFlaps((plane?.flaps || 0) + 1); focusView(); };
  $('#zoomIn').onclick = () => { zoom = Math.max(0, zoom - 1); focusView(); }; $('#zoomOut').onclick = () => { zoom = Math.min(ZOOMS.length - 1, zoom + 1); focusView(); };
  $('#again').onclick = () => respawn();
  $('#reset').onclick = () => { if (state !== 'loading') respawn(); };
  $('#throttle').oninput = event => { if (plane) { plane.throttle = Number(event.target.value) / 100; $('#throttleValue').textContent = `${event.target.value}%`; } };
  $('#airport').onchange = event => { localStorage.setItem('flight-airport', event.target.value); openAirport(event.target.value); focusView(); };

  // The stick is "forward is nose down": W / Up pushes forward. At high simulation speeds the controls are softened so the plane
  // stays flyable while time is compressed.
  function pilotInput() {
    const gain = 1 / Math.max(1, scale / 2);
    const axis = (positive, negative) => (held(positive) ? 1 : 0) - (held(negative) ? 1 : 0);
    return {
      elevator: axis('noseUp', 'noseDown') * gain, aileron: axis('right', 'left') * gain, rudder: axis('rudderRight', 'rudderLeft') * gain,
      throttleRate: axis('moreThrottle', 'lessThrottle') * 0.5 / scale, brake: held('brake')
    };
  }

  // ---- sharing the plane's position -------------------------------------------------------------------------------------------
  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?room=flight&client=${encodeURIComponent(clientId)}`);
    socket.onopen = () => { reconnectDelay = 500; const name = sessionStorage.getItem('arcade-name'); if (name) socket.send(JSON.stringify({ type: 'setName', name })); $('#reset').disabled = state === 'loading'; };
    socket.onclose = () => { $('#reset').disabled = true; others = []; clearTimeout(reconnect); reconnect = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(5000, reconnectDelay * 2); };
    socket.onmessage = event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'platformPresence') { renderArcadePresence(message.players); return; }
      if (message.type === 'switchGame' && message.path !== location.pathname) { location.assign(message.path); return; }
      if (message.type === 'flightState') { selfId = message.selfId; others = scene ? message.planes.filter(other => other.id !== selfId).map(other => { const [x, z] = scene.toLocal(other.lat, other.lon); return { ...other, x, z, y: other.alt - scene.airport.elevation }; }).filter(other => Math.hypot(other.x, other.z) < 60000) : []; }
    };
  }
  function sharePosition(now) {
    if (!scene || !plane || state !== 'flying' || socket?.readyState !== WebSocket.OPEN || now - shareAt < 100) return;
    shareAt = now;
    const { lat, lon } = scene.toGeo(plane.x, plane.z);
    socket.send(JSON.stringify({ type: 'pose', lat, lon, alt: plane.y + scene.airport.elevation, heading: plane.heading, pitch: plane.pitch, roll: plane.roll, throttle: plane.throttle }));
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------------------
  function basis(p) { const r = R.mat.multiply(R.mat.rotateY(p.heading), R.mat.multiply(R.mat.rotateX(-p.pitch), R.mat.rotateZ(-p.roll))); return { right: [r[0], r[1], r[2]], up: [r[4], r[5], r[6]], forward: [r[8], r[9], r[10]] }; }
  function camera() {
    const b = basis(plane), p = [plane.x, plane.y + 1.1, plane.z];
    if (cameraMode === 'cockpit') return { position: [p[0] + b.up[0] * 0.55 + b.forward[0] * 0.6, p[1] + b.up[1] * 0.55 + b.forward[1] * 0.6, p[2] + b.up[2] * 0.55 + b.forward[2] * 0.6], forward: b.forward, up: b.up, fov: 1.15 };
    const flat = [Math.sin(plane.heading), 0, Math.cos(plane.heading)];
    const position = [p[0] - flat[0] * 20, p[1] + 5.5, p[2] - flat[2] * 20];
    return { position, forward: R.norm([p[0] + flat[0] * 30 - position[0], p[1] + 2 - position[1], p[2] + flat[2] * 30 - position[2]]), up: [0, 1, 0], fov: 1.05 };
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!scene || !plane || state === 'loading') return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    if (state === 'flying') {
      const input = pilotInput();
      P.advance(plane, input, dt * scale, world); if (input.throttleRate) syncThrottle();
      if (plane.crashed) { state = 'crashed'; $('#crashText').textContent = plane.crashed; $('#crash').hidden = false; }
    }
    sharePosition(now); streamTiles(now);
    const planes = [{ x: plane.x, y: plane.y, z: plane.z, heading: plane.heading, pitch: plane.pitch, roll: plane.roll, body: [0.8, 0.1, 0.12], accent: [0.1, 0.2, 0.45], scale: 1 }];
    for (const other of others) planes.push({ x: other.x, y: other.y, z: other.z, heading: other.heading, pitch: other.pitch, roll: other.roll, body: hexColor(other.color), accent: [0.1, 0.2, 0.45], scale: 1 });
    if (cameraMode === 'cockpit') planes.shift();
    const viewProj = renderer.draw(camera(), planes, {});
    drawHud(viewProj); if (now - mapAt > 90) { mapAt = now; drawMap(); }
  }
  const hexColor = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

  function drawHud(viewProj) {
    const canvas = $('#hud'), ratio = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) { canvas.width = Math.floor(w * ratio); canvas.height = Math.floor(h * ratio); }
    const c = hudContext; c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, w, h);
    // The numbers are refreshed four times a second so they are readable; the horizon moves every frame.
    const live = P.readout(plane); if (!hudRead || performance.now() - hudAt > 250) { hudRead = live; hudAt = performance.now(); }
    const r = { ...live, knots: hudRead.knots, feet: hudRead.feet, fpm: hudRead.fpm, degrees: hudRead.degrees };
    // Plain, clear text: a sans-serif face with a soft dark shadow so it reads over sky, water and city alike.
    const text = (value, x, y, { align = 'left', color = '#fff', size = 16, weight = 600 } = {}) => {
      c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 5; c.shadowOffsetY = 1; c.fillStyle = color; c.fillText(value, x, y); c.shadowBlur = 0; c.shadowOffsetY = 0;
    };
    for (const other of others) { const p = renderer.project(viewProj, other.x, other.y + 6, other.z); if (p && p[2] < 8000) text(other.name, p[0], p[1], { align: 'center', color: other.color, size: 14, weight: 700 }); }
    // The horizon instrument is see-through: only a ring, the horizon line and the pitch ladder are drawn, so it never hides the view.
    const cx = w / 2, cy = h - 110, radius = 74, ladder = 3.4;
    c.save(); c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.clip();
    c.translate(cx, cy); c.rotate(-plane.roll); const shift = r.pitch * ladder;
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 3; c.strokeStyle = '#ffffff'; c.lineWidth = 2;
    for (let d = -30; d <= 30; d += 5) { if (!d) continue; const y = shift - d * ladder, half = d % 10 ? 9 : 18; c.beginPath(); c.moveTo(-half, y); c.lineTo(half, y); c.stroke(); if (d % 10 === 0) { c.font = `600 11px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText(String(Math.abs(d)), half + 6, y); } }
    c.lineWidth = 2.5; c.beginPath(); c.moveTo(-radius * 2, shift); c.lineTo(radius * 2, shift); c.stroke(); c.restore();
    // The ring is blue above the horizon and brown below it, so the roll angle is visible without filling the circle.
    c.save(); c.translate(cx, cy); c.rotate(-plane.roll); const horizonY = Math.max(-radius, Math.min(radius, shift)), angle = Math.asin(horizonY / radius);
    c.lineWidth = 5; c.strokeStyle = 'rgba(90,160,235,0.85)'; c.beginPath(); c.arc(0, 0, radius, Math.PI + angle, -angle); c.stroke();
    c.strokeStyle = 'rgba(175,125,80,0.85)'; c.beginPath(); c.arc(0, 0, radius, -angle, Math.PI + angle); c.stroke(); c.restore();
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 3; c.strokeStyle = '#ffd23f'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx - 36, cy); c.lineTo(cx - 12, cy); c.lineTo(cx, cy + 9); c.lineTo(cx + 12, cy); c.lineTo(cx + 36, cy); c.stroke(); c.shadowBlur = 0;
    // Readouts.
    const warn = plane.stalled ? '#ff6b6b' : '#fff', label = { color: '#cfd9e8', size: 12, weight: 700 };
    const sub = { color: '#dbe5f3', size: 14, weight: 600 }, feet = Math.max(0, r.feet), metres = Math.round(feet / 3.28084), fpmValue = Math.round(r.fpm / 10) * 10;
    text('SPEED', 24, h - 134, label); text(`${Math.round(r.knots)} kt`, 24, h - 110, { color: warn, size: 24, weight: 700 }); text(`${Math.round(r.knots * 1.852)} km/h`, 24, h - 87, sub);
    text('HEADING', 24, h - 56, label); text(`${String(Math.round(r.degrees) % 360).padStart(3, '0')}°`, 24, h - 32, { size: 24, weight: 700 });
    text('ALTITUDE', w - 24, h - 134, { ...label, align: 'right' }); text(`${Math.round(feet).toLocaleString()} ft`, w - 24, h - 110, { align: 'right', size: 24, weight: 700 }); text(`${metres.toLocaleString()} m`, w - 24, h - 87, { ...sub, align: 'right' });
    text('VERTICAL SPEED', w - 24, h - 56, { ...label, align: 'right' }); text(`${fpmValue} fpm`, w - 24, h - 32, { align: 'right', size: 24, weight: 700, color: r.fpm < -700 ? '#ffb347' : '#fff' }); text(`${(fpmValue / 196.85).toFixed(1)} m/s`, w - 24, h - 9, { ...sub, align: 'right' });
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 60, h - 26, 120, 8); c.fillStyle = '#ffd23f'; c.fillRect(cx - 60, h - 26, 120 * plane.throttle, 8); text('THROTTLE', cx, h - 40, { align: 'center', ...label });
    const toThreshold = Math.hypot(plane.x - scene.runway.threshold[0], plane.z - scene.runway.threshold[1]);
    text(`${scene.airport.icao} runway ${scene.runway.ref.split('/')[0]}  ·  ${(toThreshold / 1852).toFixed(1)} nm / ${(toThreshold / 1000).toFixed(1)} km`, 14, 74, { size: 18, weight: 700 });
    if (plane.flaps) text(`FLAPS ${FLAPS[plane.flaps]}°`, 14, scale > 1 ? 122 : 98, { color: '#9be7a5', size: 16, weight: 700 });
    if (scale > 1) text(`${scale}× speed`, 14, 98, { color: '#ffd23f', size: 16, weight: 700 });
    if (notice) text(notice, w / 2, h - 150, { align: 'center', color: '#ffd9a0', size: 14 });
    if (plane.stalled) text('STALL', cx, 110, { align: 'center', color: '#ff6b6b', size: 30, weight: 800 });
    if (plane.onGround) text(plane.brake ? 'On the ground · brakes' : 'On the ground', cx, 110, { align: 'center', color: '#9be7a5', size: 20 });
    if (plane.y < 60 && !plane.onGround && plane.verticalSpeed < -4) text('SINK RATE', cx, 140, { align: 'center', color: '#ffb347', size: 22, weight: 800 });
  }


  // ---- more map as the plane flies on --------------------------------------------------------------------------------------
  // Cells of OpenStreetMap around the plane, and ahead of it, are read a couple at a time; ones far behind are dropped again.
  function streamTiles(now) {
    if (!scene || !world || scene.source !== 'openstreetmap' || state === 'loading' || now - streaming.last < 400) return;
    streaming.last = now;
    const reach = Math.min(14000, Math.max(3000, plane.speed * 14)), ahead = [Math.sin(plane.heading), Math.cos(plane.heading)], wanted = [[plane.x, plane.z]];
    for (const f of [1, 0.5]) wanted.push([plane.x + ahead[0] * reach * f, plane.z + ahead[1] * reach * f]);
    for (let k = 0; k < 8; k++) wanted.push([plane.x + Math.cos(k * Math.PI / 4) * 3200, plane.z + Math.sin(k * Math.PI / 4) * 3200]);
    const token = loadingToken;
    for (const [x, z] of wanted) {
      if (streaming.pending.size >= 2 || world.covered(x, z)) continue;
      const [i, j] = OSM.tileCell(scene, x, z), key = OSM.tileKey(i, j);
      if (streaming.pending.has(key) || world.tiles.has(key) || (streaming.failed.get(key) || 0) > now) continue;
      streaming.pending.set(key, true);
      OSM.loadTile(fetchOverpass, scene, world, i, j).then(tile => {
        streaming.pending.delete(key); if (token !== loadingToken) return;
        world.addTile(tile); const mesh = OSM.tileParts(tile); renderer.setTile(tile.key, mesh.ground, mesh.solid); evictTiles();
      }).catch(error => { streaming.pending.delete(key); streaming.failed.set(key, performance.now() + 20000); console.warn('More map could not be read:', error); });
    }
  }
  function evictTiles() {
    const far = tile => Math.hypot((tile.rect[0] + tile.rect[2]) / 2 - plane.x, (tile.rect[1] + tile.rect[3]) / 2 - plane.z);
    const extra = [...world.tiles.values()].filter(tile => tile !== world.home).sort((a, b) => far(b) - far(a));
    while (extra.length > 12) { const tile = extra.shift(); world.removeTile(tile.key); renderer.removeTile(tile.key); }
  }

  // ---- the 2D map in the top right corner ----------------------------------------------------------------------------------
  const mapContext = $('#map').getContext('2d');
  function drawMap() {
    if (!scene || !plane) return;
    const canvas = $('#map'), ratio = Math.min(2, window.devicePixelRatio || 1), size = canvas.clientWidth;
    if (!size) return;
    if (canvas.width !== Math.floor(size * ratio)) { canvas.width = canvas.height = Math.floor(size * ratio); }
    const c = mapContext, span = ZOOMS[zoom], k = size / span, half = size / 2;
    const px = x => half + (x - plane.x) * k, py = z => half - (z - plane.z) * k;
    const COLORS = OSM.COLORS, css = rgb => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
    c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, size, size);
    c.save(); c.beginPath(); c.rect(0, 0, size, size); c.clip();
    c.fillStyle = css(COLORS.land); c.fillRect(0, 0, size, size);
    const view = [plane.x - span / 2, plane.z - span / 2, plane.x + span / 2, plane.z + span / 2];
    const near = box => box[2] >= view[0] && box[0] <= view[2] && box[3] >= view[1] && box[1] <= view[3];
    const trace = ring => { c.moveTo(px(ring[0][0]), py(ring[0][1])); for (let i = 1; i < ring.length; i++) c.lineTo(px(ring[i][0]), py(ring[i][1])); c.closePath(); };
    const tiles = [...world.tiles.values()].sort((a, b) => (a === world.home) - (b === world.home));
    for (const tile of tiles) {
      if (tile.water) {
        const [x0, z0, x1, z1] = tile.waterRect || tile.rect; c.fillStyle = css(COLORS.water); c.fillRect(px(x0), py(z1), (x1 - x0) * k, (z1 - z0) * k);
        c.fillStyle = css(COLORS.island); c.beginPath(); for (const land of tile.water.islands) trace(land); c.fill();
      }
      c.fillStyle = css(COLORS.water);
      for (const pond of tile.ponds || []) if (near(pond.box)) { c.beginPath(); trace(pond.ring); c.fill(); c.fillStyle = css(COLORS.island); for (const hole of pond.holes) { c.beginPath(); trace(hole); c.fill(); } c.fillStyle = css(COLORS.water); }
    }
    // Runways and taxiways, then buildings (skipped when zoomed far out), as footprints.
    c.strokeStyle = css(COLORS.taxiway); c.lineWidth = Math.max(1, 12 * k); c.lineJoin = 'round'; c.beginPath(); for (const t of scene.taxiways) { c.moveTo(px(t[0][0]), py(t[0][1])); for (const q of t.slice(1)) c.lineTo(px(q[0]), py(q[1])); } c.stroke();
    c.strokeStyle = '#2b2d33'; for (const r of [scene.runway, ...scene.otherRunways]) { c.lineWidth = Math.max(2, r.width * k); c.beginPath(); c.moveTo(px(r.points[0][0]), py(r.points[0][1])); for (const q of r.points.slice(1)) c.lineTo(px(q[0]), py(q[1])); c.stroke(); }
    if (span <= 20000) { c.fillStyle = 'rgba(105,108,116,0.9)'; for (const tile of tiles) for (const b of tile.buildings) if (near(b.box)) c.fillRect(px(b.box[0]), py(b.box[3]), Math.max(1, (b.box[2] - b.box[0]) * k), Math.max(1, (b.box[3] - b.box[1]) * k)); }
    // Planes: yours is the yellow arrow in the middle; others are coloured arrows with their names, kept on the rim when off the map.
    for (const other of others) {
      const dx = (other.x - plane.x) * k, dz = -(other.z - plane.z) * k, dist = Math.hypot(dx, dz), limit = half - 10, back = dist > limit ? limit / dist : 1, x = half + dx * back, y = half + dz * back;
      c.fillStyle = other.color; c.strokeStyle = '#0b1424'; c.lineWidth = 2; c.save(); c.translate(x, y); c.rotate(other.heading);
      c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.stroke(); c.fill(); c.restore();
      c.font = `700 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#fff'; c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 3; c.fillText(other.name, Math.max(24, Math.min(size - 24, x)), y + (y > size - 22 ? -12 : 15)); c.shadowBlur = 0;
    }
    c.save(); c.translate(half, half); c.rotate(plane.heading); c.fillStyle = '#ffd23f'; c.strokeStyle = '#0b1424'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.stroke(); c.fill(); c.restore();
    c.restore();
    c.font = `700 11px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#0b1424'; c.fillText('N ↑', 8, 16);
    c.textAlign = 'right'; c.fillText(span >= 10000 ? `${span / 2000} km` : `${span / 2} m`, size - 8, size - 8);
    if (streaming.pending.size) { c.textAlign = 'left'; c.fillText('Loading map…', 8, size - 8); }
  }

  // ---- start up ---------------------------------------------------------------------------------------------------------------
  async function openAirport(code) {
    const token = ++loadingToken;
    state = 'loading'; $('#loading').hidden = false; $('#crash').hidden = true; $('#airport').value = code; progress(`Reading OpenStreetMap: ${OSM.AIRPORTS[code].label}…`, 0.05);
    const { scene: loaded, note } = await loadScene(code);
    if (token !== loadingToken) return;
    scene = loaded; progress('Building the 3D scene…', 0.8); await nextFrame();
    world = OSM.createWorld(scene);
    const mesh = OSM.meshParts(scene); renderer.clearTiles(); renderer.setScene(mesh.ground, mesh.solid); notice = note; others = []; streaming.pending.clear(); streaming.failed.clear();
    window.flightState = () => ({ world, sceneObject: scene, scene: { source: scene.source, code: scene.code, buildings: scene.buildings.length, airport: scene.airport, tiles: world.tiles.size, loading: streaming.pending.size, runway: { ref: scene.runway.ref, headingDegrees: scene.runway.heading * 180 / Math.PI, length: scene.runway.length } }, plane, others, state });
    respawn(true); $('#loading').hidden = true; $('#reset').disabled = socket?.readyState !== WebSocket.OPEN; focusView();
  }
  async function start() {
    connect();
    try { renderer = new R.Renderer($('#view')); } catch (error) { progress(`${error.message} The flight simulator needs WebGL.`, 0); return; }
    requestAnimationFrame(frame);
    await openAirport(preferred());
  }
  start();
})();
