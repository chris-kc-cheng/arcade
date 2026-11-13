// Flight simulator page: reads OpenStreetMap, flies a small plane in 3D and shares only the plane's position.
(() => {
  const $ = selector => document.querySelector(selector);
  const P = FlightPhysics, OSM = FlightOSM, R = FlightRender;
  const clientId = (() => { let id = sessionStorage.getItem('arcade-client'); if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('arcade-client', id); } return id; })();
  const SCALES = [1, 2, 5, 10, 50, 100], FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const streaming = { pending: new Map(), failed: new Map(), last: 0 }, ZOOMS = [2000, 6000, 20000, 60000], FLAPS = [0, 10, 20, 30];
  let spinSelf = 0, crashedFor = 0, look = { yaw: 0, pitch: 0 }, zoom = 1, mapAt = 0, hudRead = null, hudAt = 0;
  let scene, world, renderer, plane, socket, selfId = '', others = [], scale = 1, cameraMode = 'chase', last = 0, shareAt = 0, reconnect, reconnectDelay = 500, state = 'loading', loadingToken = 0, notice = '';
  const keys = new Set();
  const hudContext = $('#hud').getContext('2d');

  // ---- reading OpenStreetMap (cached in the browser for a week) ---------------------------------------------------------------
  const database = () => new Promise(resolve => { try { const open = indexedDB.open('arcade-flight', 1); open.onupgradeneeded = () => open.result.createObjectStore('osm'); open.onsuccess = () => resolve(open.result); open.onerror = () => resolve(null); } catch { resolve(null); } });
  const cached = async key => { const db = await database(); if (!db) return null; return new Promise(resolve => { const request = db.transaction('osm').objectStore('osm').get(key); request.onsuccess = () => resolve(request.result && Date.now() - request.result.at < 7 * 864e5 ? request.result.json : null); request.onerror = () => resolve(null); }); };
  const remember = async (key, json) => { const db = await database(); if (db) try { db.transaction('osm', 'readwrite').objectStore('osm').put({ at: Date.now(), json }, key); } catch { /* the cache is only an optimisation */ } };
  async function fetchOverpass(query, timeout = 120000) {
    const hit = await cached(query); if (hit) return hit;
    const controllers = [];
    const attempt = base => { const controller = new AbortController(); controllers.push(controller); setTimeout(() => controller.abort(), timeout);
      return fetch(`${base}?data=${encodeURIComponent(query)}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(String(response.status)); const json = await response.json(); if (!Array.isArray(json.elements)) throw new Error('no elements'); return json; }); };
    const json = await Promise.any(OSM.MIRRORS.map(attempt)); controllers.forEach(controller => controller.abort());
    remember(query, json); return json;
  }
  const progress = (text, fraction) => { $('#loadingText').textContent = text; $('#loadingBar').style.width = `${Math.round(fraction * 100)}%`; };
  const nextFrame = () => new Promise(resolve => setTimeout(resolve, 20));
  const preferred = () => { let saved = null; try { saved = localStorage.getItem('flight-airport'); } catch { /* optional */ } return OSM.resolveCode(new URLSearchParams(location.search).get('airport') || saved) || OSM.DEFAULT_AIRPORT; };
  // The airports offered while typing: the built-in ones, then some well known codes (any 3 or 4 character code can be typed).
  for (const [code, o] of Object.entries(OSM.AIRPORTS)) { const option = document.createElement('option'); option.value = code; option.label = o.label; $('#airportList').append(option); }
  for (const [code, name] of OSM.SUGGESTIONS) { const option = document.createElement('option'); option.value = code; option.label = name; $('#airportList').append(option); }
  let toastTimer = 0; const toast = message => { const box = $('#toast'); box.textContent = message; box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, 6000); };

  async function loadScene(code) {
    const preset = Boolean(OSM.AIRPORTS[code]), label = preset ? OSM.AIRPORTS[code].label : code;
    try {
      let count = 0;
      const spy = async query => { count++; progress(count === 1 ? `Reading OpenStreetMap: ${label} airport…` : `Reading OpenStreetMap: buildings and the shore around ${label} (cached after the first visit)…`, count === 1 ? 0.15 : 0.3); return fetchOverpass(query, count === 1 ? 25000 : 120000); };
      return { scene: await OSM.load(spy, code), note: '' };
    } catch (error) {
      console.warn('OpenStreetMap could not be read:', error);
      if (!preset) return { kind: error.code === 'not-found' ? 'not-found' : 'network', error: error.code === 'not-found' ? `No airport with the code ${code} was found in OpenStreetMap (or it has no runway there).` : `OpenStreetMap could not be reached to look up ${code}.` };
      return { scene: OSM.fallbackScene(code), note: 'Offline map: OpenStreetMap could not be reached' };
    }
  }

  const HELP = {
    airbus: [['W / ↑', 'nose down (stick forward)'], ['S / ↓', 'nose up (stick back)'], ['A / ←', 'bank left'], ['D / →', 'bank right'], ['Q / E', 'rudder left / right'], ['Shift · PgUp', 'more thrust'], ['Z · PgDn', 'less thrust'], ['F / V', 'flaps down / up (UP, 1, 2, 3, FULL)'], ['Space · B', 'wheel brakes'], ['1 – 6', 'speed 1× 2× 5× 10× 50× 100×'], ['C', 'chase / cockpit camera'], ['R', 'respawn on final approach'], ['M', 'switch vehicle (in flight)'], ['H', 'show / hide these keys']],
    plane: [['W / ↑', 'nose down (stick forward)'], ['S / ↓', 'nose up (stick back)'], ['A / ←', 'bank left'], ['D / →', 'bank right'], ['Q / E', 'rudder left / right'], ['Shift · PgUp', 'more throttle'], ['Z · PgDn', 'less throttle'], ['F / V', 'flaps down / up one notch'], ['Space · B', 'wheel brakes'], ['1 – 6', 'speed 1× 2× 5× 10× 50× 100×'], ['C', 'chase / cockpit camera'], ['R', 'respawn on final approach'], ['M', 'switch vehicle (in flight)'], ['H', 'show / hide these keys']],
    jet: [['W / ↑', 'nose down (stick forward)'], ['S / ↓', 'nose up (stick back): hold it for a loop'], ['A / ←', 'roll left: hold it for a barrel roll'], ['D / →', 'roll right'], ['Q / E', 'yaw left / right'], ['Drag · J L I K', 'look around the cockpit'], ['Home · double-click', 'look straight ahead'], ['Shift · PgUp', 'more thrust'], ['Z · PgDn', 'less thrust'], ['Space · B', 'wheel brakes'], ['1 – 6', 'speed 1× 2× 5× 10× 50× 100×'], ['C', 'cockpit / outside camera'], ['R', 'respawn'], ['M', 'switch vehicle (in flight)'], ['H', 'show / hide these keys']],
    drone: [['↑', 'go up'], ['↓', 'go down'], ['←', 'turn left'], ['→', 'turn right'], ['A', 'slide left'], ['D', 'slide right'], ['W', 'forward'], ['S', 'backward'], ['I', 'camera angle up'], ['K', 'camera angle down'], ['—', 'no key: it stays where it is'], ['1 – 6', 'speed 1× 2× 5× 10× 50× 100×'], ['C', 'chase / first-person camera'], ['R', 'back to the start'], ['M', 'switch vehicle (in flight)'], ['H', 'show / hide these keys']]
  };
  const MODES = ['plane', 'airbus', 'jet', 'drone'], MODE_LABEL = { plane: '', airbus: 'A320', jet: 'JET', drone: 'DRONE' };
  // How high the model's centre is above the ground (the gear), how big it is drawn, and the flap settings of each aircraft.
  const GEAR = { plane: 1.1, airbus: 3.8, jet: 1.65, drone: 0.1 }, SIZE = { drone: 0.14 }, FLAP_TEXT = { plane: ['0°', '10°', '20°', '30°'], airbus: ['UP', '1', '2', '3', 'FULL'] };
  const hasFlaps = mode => mode === 'plane' || mode === 'airbus';
  let flightMode = (() => { try { const saved = new URLSearchParams(location.search).get('mode') || localStorage.getItem('flight-mode'); return MODES.includes(saved) ? saved : 'plane'; } catch { return 'plane'; } })();
  function renderHelp() {
    const list = $('#keyList'); list.replaceChildren();
    for (const [key, text] of HELP[flightMode]) { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = text; row.append(dt, dd); list.append(row); }
    $('#flapsGroup').hidden = !hasFlaps(flightMode); document.querySelector('.throttle').hidden = flightMode === 'drone';   // a drone has no throttle $('#mode').value = flightMode;
  }

  // ---- the plane -------------------------------------------------------------------------------------------------------------
  function respawn(notify = true) {
    const a = OSM.finalApproach(scene);
    const options = { x: a.x, z: a.z, heading: a.heading, distance: scene.distance, glide: (scene.place ? 0 : scene.glide) * Math.PI / 180 };
    if (scene.place) {   // sightseeing: start level at cruise, not on a landing approach
      options.crossing = scene.start.alt; if (flightMode === 'airbus') Object.assign(options, { speed: 100, throttle: 0.45, flaps: 0 }); else if (flightMode === 'plane') Object.assign(options, { speed: 52, throttle: 0.5, flaps: 0 });
    } else if (scene.glide > 3.2) options.throttle = Math.max(0, (P.SPECS[flightMode] || P.PLANE).approachThrottle - (scene.glide - 3) * 0.05);   // a steeper approach needs less power
    plane = P.spawn(flightMode, options);
    $('#crash').hidden = true; state = 'flying'; syncThrottle();
    if (notify && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'respawn' }));
  }
  // The same place and heading, high enough to clear the tallest building there.
  function recoverHere() {
    let top = 0; for (let y = 0; y <= 800; y += 20) if (world.obstacle(plane.x, y, plane.z)) top = y + 20;
    P.recover(plane, Math.max(300, top + 150)); $('#crash').hidden = true; state = 'flying'; syncThrottle();
  }
  function setFlaps(notches) { if (!plane) return; const text = FLAP_TEXT[flightMode] || FLAP_TEXT.plane; plane.flaps = Math.max(0, Math.min(text.length - 1, notches)); $('#flapsValue').textContent = text[plane.flaps]; }
  function syncThrottle() { setFlaps(plane.flaps || 0); const percent = Math.round(plane.throttle * 100); $('#throttle').value = percent; $('#throttleValue').textContent = `${percent}%`; }

  // ---- controls ---------------------------------------------------------------------------------------------------------------
  const KEYMAP = { KeyW: 'noseDown', ArrowUp: 'noseDown', KeyS: 'noseUp', ArrowDown: 'noseUp', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'rudderLeft', KeyE: 'rudderRight', KeyJ: 'lookLeft', KeyL: 'lookRight', KeyI: 'lookUp', KeyK: 'lookDown', ShiftLeft: 'moreThrottle', ShiftRight: 'moreThrottle', PageUp: 'moreThrottle', Equal: 'moreThrottle', KeyZ: 'lessThrottle', PageDown: 'lessThrottle', Minus: 'lessThrottle', Space: 'brake', KeyB: 'brake' };
  // The drone is flown differently: arrows climb, descend and turn, A / D slide sideways, W / S tilt the camera.
  const DRONE_KEYMAP = { ArrowUp: 'climb', ArrowDown: 'descend', ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', KeyA: 'strafeLeft', KeyD: 'strafeRight', KeyW: 'forward', KeyS: 'backward', KeyI: 'viewUp', KeyK: 'viewDown' };
  const keymap = () => flightMode === 'drone' ? DRONE_KEYMAP : KEYMAP;
  const held = action => [...keys].some(code => keymap()[code] === action);
  function setScale(value) {
    scale = value;
    document.querySelectorAll('[data-scale]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.scale) === value)));
  }
  function setCamera(mode) { cameraMode = mode; look = { yaw: 0, pitch: 0 }; $('#camera').setAttribute('aria-pressed', String(mode === 'cockpit')); }
  function toggleHelp(force) { const open = force ?? $('#keys').hidden; $('#keys').hidden = !open; $('#help').setAttribute('aria-pressed', String(open)); }
  const focusView = () => $('#view').focus({ preventScroll: true });
  addEventListener('keydown', event => {
    // Typing in a text box or using the shared top bar is never flying; buttons, the throttle slider and the airport list are fine.
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('.arcade-topbar,.arcade-debug-panel') || event.target.matches?.('input:not(#throttle),textarea,[contenteditable="true"]')) return;
    if (event.target.id === 'airport' && /^(Arrow|Page|Home|End)/.test(event.code)) return;
    const digit = /^Digit([1-6])$/.exec(event.code);
    if (digit) { setScale(SCALES[Number(digit[1]) - 1]); event.preventDefault(); return; }
    if (event.code === 'KeyM' && state !== 'loading') { setMode(MODES[(MODES.indexOf(flightMode) + 1) % MODES.length]); return; }
    if (event.code === 'Home') { look = { yaw: 0, pitch: 0 }; return; }
    if (event.code === 'KeyC') { setCamera(cameraMode === 'chase' ? 'cockpit' : 'chase'); return; }
    if (event.code === 'KeyH') { toggleHelp(); return; }
    if ((event.code === 'KeyF' || event.code === 'KeyV') && plane && hasFlaps(flightMode)) { if (!event.repeat) { manualAt.flaps = performance.now(); setFlaps((plane.flaps || 0) + (event.code === 'KeyF' ? 1 : -1)); } return; }
    if ((event.code === 'KeyR' || event.code === 'Enter') && state !== 'loading') { respawn(); return; }
    if (keymap()[event.code]) { keys.add(event.code); event.preventDefault(); }
  });
  addEventListener('keyup', event => keys.delete(event.code));
  addEventListener('blur', () => keys.clear());
  document.querySelectorAll('[data-scale]').forEach(button => button.onclick = () => { setScale(Number(button.dataset.scale)); focusView(); });
  $('#camera').onclick = () => { setCamera(cameraMode === 'chase' ? 'cockpit' : 'chase'); focusView(); };
  $('#help').onclick = () => { toggleHelp(); focusView(); };
  $('#flapsUp').onclick = () => { manualAt.flaps = performance.now(); setFlaps((plane?.flaps || 0) - 1); focusView(); }; $('#flapsDown').onclick = () => { manualAt.flaps = performance.now(); setFlaps((plane?.flaps || 0) + 1); focusView(); };
  $('#zoomIn').onclick = () => { zoom = Math.max(0, zoom - 1); focusView(); }; $('#zoomOut').onclick = () => { zoom = Math.min(ZOOMS.length - 1, zoom + 1); focusView(); };
  // Dragging the view looks around the cockpit (or orbits the outside view); double-click looks straight ahead.
  { const view = $('#view'); let drag = null; view.style.touchAction = 'none';
    view.addEventListener('pointerdown', event => { if (flightMode !== 'jet') return; drag = { x: event.clientX, y: event.clientY }; view.setPointerCapture?.(event.pointerId); });
    view.addEventListener('pointermove', event => { if (!drag) return; look.yaw = Math.max(-Math.PI, Math.min(Math.PI, look.yaw + (event.clientX - drag.x) * 0.006)); look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch - (event.clientY - drag.y) * 0.006)); drag = { x: event.clientX, y: event.clientY }; });
    for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, () => { drag = null; });
    view.addEventListener('dblclick', () => { look = { yaw: 0, pitch: 0 }; }); }
  $('#again').onclick = () => respawn();
  $('#reset').onclick = () => { if (state !== 'loading') respawn(); };
  $('#throttle').oninput = event => { manualAt.throttle = performance.now(); if (plane) { plane.throttle = Number(event.target.value) / 100; $('#throttleValue').textContent = `${event.target.value}%`; } };
  // Switch vehicle in mid-flight: the position, heading, speed and throttle carry over. After a crash it starts over instead.
  function setMode(next) {
    flightMode = MODES.includes(next) ? next : 'plane'; look = { yaw: 0, pitch: 0 }; setCamera(flightMode === 'jet' ? 'cockpit' : 'chase');
    try { localStorage.setItem('flight-mode', flightMode); } catch { /* optional */ } keys.clear(); renderHelp();
    if (!scene || !plane || state === 'loading') return;
    if (state === 'crashed' || plane.crashed) respawn(true); else { P.switchMode(plane, flightMode); syncThrottle(); }
  }
  $('#mode').onchange = event => { setMode(event.target.value); focusView(); };
  // Type an airport code (IATA or ICAO) and press Enter, or pick one from the list.
  // The box takes a code (YTZ, CYTZ) or a name (Heathrow, Kennedy). A code that is not found is searched as a name ("Nice" is not a code).
  const searchCache = new Map(); let lastSearchAt = 0, lastSubmit = { text: '', at: 0 };
  const hideResults = () => { $('#results').hidden = true; $('#resultList').replaceChildren(); };
  async function searchAirports(text) {
    const key = text.trim().toLowerCase(); if (searchCache.has(key)) return searchCache.get(key);
    const wait = 1100 - (Date.now() - lastSearchAt); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));   // the service allows one request a second
    lastSearchAt = Date.now();
    const response = await fetch(OSM.searchUrl(text)); if (!response.ok) throw new Error(String(response.status));
    let found = OSM.parseSearch(await response.json()); const query = OSM.enrichQuery(found);
    if (query) { try { found = OSM.applyTags(found, await fetchOverpass(query, 25000)); } catch (error) { found = found.filter(r => r.code); } } else found = found.filter(r => r.code);
    searchCache.set(key, found); return found;
  }
  function pick(result) { hideResults(); $('#airport').value = result.code; openAirport(result.code); }
  async function searchByName(text) {
    toast(`Searching for “${text}”…`);
    let found; try { found = await searchAirports(text); } catch (error) { toast('The airport search could not be reached. Try an airport code instead.'); return; }
    $('#toast').hidden = true;
    if (!found.length) { toast(`No airport named “${text}” with a code was found. Try its IATA or ICAO code.`); return; }
    if (found.length === 1) { pick(found[0]); return; }
    const list = $('#resultList'); list.replaceChildren();
    for (const r of found) {
      const item = document.createElement('li'), button = document.createElement('button'), name = document.createElement('span'), codes = document.createElement('b'), where = document.createElement('small');
      button.type = 'button'; button.setAttribute('role', 'option'); name.textContent = r.name; codes.textContent = [r.icao, r.iata].filter(Boolean).join(' / '); where.textContent = r.where;
      button.append(name, codes, where); button.onclick = () => pick(r); item.append(button); list.append(item);
    }
    $('#results').hidden = false; list.querySelector('button').focus();
  }
  function submitAirport(raw) {
    const text = String(raw || '').trim(), now = Date.now(); if (!text || (text === lastSubmit.text && now - lastSubmit.at < 800)) return; lastSubmit = { text, at: now }; hideResults();
    const code = OSM.resolveCode(text);
    if (code && scene && state !== 'loading' && (code === scene.code || code === scene.airport.iata || code === scene.airport.icao)) { $('#airport').value = scene.code; focusView(); return; }
    if (code) openAirport(code, { notFound: () => searchByName(text) }); else searchByName(text);
    $('#airport').blur();
  }
  $('#airport').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitAirport(event.target.value); } else if (event.key === 'ArrowDown' && !$('#results').hidden) { event.preventDefault(); $('#resultList button')?.focus(); } else if (event.key === 'Escape') hideResults(); });
  $('#airport').onchange = event => { if (OSM.resolveCode(event.target.value) && (OSM.AIRPORTS[OSM.resolveCode(event.target.value)] || OSM.SUGGESTIONS.some(([code]) => code === OSM.resolveCode(event.target.value)))) submitAirport(event.target.value); };   // picked from the suggestions
  $('#results').addEventListener('keydown', event => { if (event.key === 'Escape') { hideResults(); $('#airport').focus(); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...$('#resultList').querySelectorAll('button')], at = buttons.indexOf(document.activeElement); buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } });
  document.addEventListener('pointerdown', event => { if (!$('#results').hidden && !event.target.closest('#results,#airport')) hideResults(); });
  $('#airport').onfocus = event => event.target.select();

  // The stick is "forward is nose down": W / Up pushes forward. At high simulation speeds the controls are softened so the plane
  // stays flyable while time is compressed.
  function pilotInput() {
    const gain = 1;   // the speed setting changes distance only, so the controls feel the same at every speed
    const axis = (positive, negative) => (held(positive) ? 1 : 0) - (held(negative) ? 1 : 0);
    if (flightMode === 'drone') return { climb: axis('climb', 'descend'), strafe: axis('strafeRight', 'strafeLeft'), yaw: axis('yawRight', 'yawLeft'), forward: axis('forward', 'backward'), view: axis('viewUp', 'viewDown') };
    return {
      elevator: axis('noseUp', 'noseDown') * gain, aileron: axis('right', 'left') * gain, rudder: axis('rudderRight', 'rudderLeft') * gain,
      throttleRate: axis('moreThrottle', 'lessThrottle') * 0.5, brake: held('brake')
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
    socket.send(JSON.stringify({ type: 'pose', lat, lon, alt: plane.y + scene.airport.elevation, heading: Math.atan2(Math.sin(plane.heading), Math.cos(plane.heading)), pitch: plane.pitch, roll: plane.roll, throttle: plane.throttle, model: flightMode }));
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------------------
  function basis(p) { const r = R.mat.multiply(R.mat.rotateY(p.heading), R.mat.multiply(R.mat.rotateX(-p.pitch), R.mat.rotateZ(-p.roll))); return { right: [r[0], r[1], r[2]], up: [r[4], r[5], r[6]], forward: [r[8], r[9], r[10]] }; }
  function camera() {
    const b = plane.axes ? { right: plane.axes.r, up: plane.axes.u, forward: plane.axes.f } : basis(plane), p = [plane.x, plane.y + GEAR[flightMode], plane.z];
    if (flightMode === 'drone') {   // the camera gimbal looks along the heading, tilted by the view angle (W / S)
      const view = plane.view ?? 0, look = [Math.cos(view) * Math.sin(plane.heading), Math.sin(view), Math.cos(view) * Math.cos(plane.heading)], flat = [Math.sin(plane.heading), 0, Math.cos(plane.heading)];
      return { position: cameraMode === 'cockpit' ? [p[0], p[1], p[2]] : [p[0] - flat[0] * 3, p[1] + 1, p[2] - flat[2] * 3], forward: look, up: [0, 1, 0], fov: 1.1, near: 0.3 };   // a real drone is small, so the camera is close
    }
    if (flightMode === 'jet') {   // fixed to the aircraft: the pilot's view, or an outside view that turns with it; the head can look around
      const cy = Math.cos(look.yaw), sy = Math.sin(look.yaw), cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
      const ahead = [0, 1, 2].map(i => b.forward[i] * cy + b.right[i] * sy), side = [0, 1, 2].map(i => b.right[i] * cy - b.forward[i] * sy);
      const forward = [0, 1, 2].map(i => ahead[i] * cp + b.up[i] * sp), up = [0, 1, 2].map(i => b.up[i] * cp - ahead[i] * sp);
      if (cameraMode === 'cockpit') return { position: [0, 1, 2].map(i => p[i] + b.up[i] * 0.7 + b.forward[i] * 1.6), forward, up, fov: 1.2 };
      const position = [0, 1, 2].map(i => p[i] - forward[i] * 26 + up[i] * 4);
      return { position, forward: R.norm([0, 1, 2].map(i => p[i] + up[i] * 1.2 - position[i])), up, fov: 1.05 };
    }
    const big = flightMode === 'airbus', eye = big ? [14.5, 2.2] : [0.6, 0.55];   // the airliner's cockpit is at the far end of a 37 m body
    if (cameraMode === 'cockpit') return { position: [0, 1, 2].map(i => p[i] + b.up[i] * eye[1] + b.forward[i] * eye[0]), forward: b.forward, up: b.up, fov: 1.15 };
    const flat = [Math.sin(plane.heading), 0, Math.cos(plane.heading)], back = big ? 55 : 20, rise = big ? 15 : 5.5;
    const position = [p[0] - flat[0] * back, p[1] + rise, p[2] - flat[2] * back];
    return { position, forward: R.norm([p[0] + flat[0] * back * 1.5 - position[0], p[1] + back * 0.1 - position[1], p[2] + flat[2] * back * 1.5 - position[2]]), up: [0, 1, 0], fov: 1.05 };
  }
  function frame(now) {
    requestAnimationFrame(frame);
    if (!scene || !plane || state === 'loading') return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    if (state === 'flying') {
      const input = pilotInput();
      P.advance(plane, input, dt, world, 0.025, scale); if (input.throttleRate) { syncThrottle(); manualAt.throttle = now; }
      if (plane.crashed) { state = 'crashed'; crashedFor = 0; $('#crashText').textContent = plane.crashed; $('#crash').hidden = false; }
    } else if (state === 'crashed') {
      // Three seconds after a crash the same vehicle is put back in the same place, higher up.
      crashedFor += dt; $('#crashCount').textContent = `Back in the air in ${Math.max(1, Math.ceil(3 - crashedFor))}…`;
      if (crashedFor >= 3) recoverHere();
    }
    if (flightMode === 'jet') { const turn = ((held('lookRight') ? 1 : 0) - (held('lookLeft') ? 1 : 0)) * dt * 2, tilt = ((held('lookUp') ? 1 : 0) - (held('lookDown') ? 1 : 0)) * dt * 2; look.yaw = Math.max(-Math.PI, Math.min(Math.PI, look.yaw + turn)); look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch + tilt)); }
    assistTick(now, dt); spinSelf += dt * (25 + plane.throttle * 110);
    sharePosition(now); streamTiles(now);
    const planes = [{ x: plane.x, y: plane.y, z: plane.z, heading: plane.heading, pitch: plane.pitch, roll: plane.roll, body: [0.8, 0.1, 0.12], accent: [0.1, 0.2, 0.45], scale: SIZE[flightMode] || 1, axes: plane.axes, model: flightMode, baseY: GEAR[flightMode], spin: spinSelf }];
    for (const other of others) planes.push({ x: other.x, y: other.y, z: other.z, heading: other.heading, pitch: other.pitch, roll: other.roll, body: hexColor(other.color), accent: [0.1, 0.2, 0.45], scale: SIZE[other.model] || 1, model: other.model || 'plane', baseY: GEAR[other.model] ?? 1.1, spin: spinOf(other, dt) });
    if (cameraMode === 'cockpit') planes.shift();
    const viewProj = renderer.draw(camera(), planes, {});
    drawHud(viewProj); if (now - mapAt > 90) { mapAt = now; drawMap(); }
  }
  // Each other pilot's propeller angle, advanced by their throttle.
  const spins = new Map(); const spinOf = (other, dt) => { const angle = (spins.get(other.id) || 0) + dt * (25 + (other.throttle || 0) * 110); spins.set(other.id, angle); return angle; };
  const hexColor = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

  // The runway number being landed on: the one of the pair that matches the approach heading (27 when coming in towards the west).
  const landingNumber = s => { if (!/\d/.test(s.runway.ref)) return String(Math.round(s.runway.heading * 18 / Math.PI) % 36 || 36).padStart(2, '0'); const parts = s.runway.ref.split('/'), heading = s.runway.heading * 180 / Math.PI; const gap = n => { const d = Math.abs((((parseInt(n, 10) * 10 - heading) % 360) + 540) % 360 - 180); return Number.isFinite(d) ? d : 999; }; return [...parts].sort((a, b) => gap(a) - gap(b))[0]; };
  function drawHud(viewProj) {
    const canvas = $('#hud'), ratio = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)) { canvas.width = Math.floor(w * ratio); canvas.height = Math.floor(h * ratio); }
    const c = hudContext; c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, w, h);
    // The numbers are refreshed four times a second so they are readable; the horizon moves every frame.
    const live = P.readout(plane); if (!hudRead || performance.now() - hudAt > 250) { hudRead = live; hudAt = performance.now(); }
    const r = { ...live, knots: hudRead.knots, feet: hudRead.feet, fpm: hudRead.fpm, degrees: hudRead.degrees };
    if (flightMode === 'drone') r.pitch = (plane.view ?? 0) * 180 / Math.PI;   // the ladder shows the camera angle
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
    if (flightMode !== 'drone') { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 60, h - 26, 120, 8); c.fillStyle = '#ffd23f'; c.fillRect(cx - 60, h - 26, 120 * plane.throttle, 8); text('THROTTLE', cx, h - 40, { align: 'center', ...label }); }
    const toThreshold = Math.hypot(plane.x - scene.runway.threshold[0], plane.z - scene.runway.threshold[1]);
    text(scene.place ? scene.label : `${scene.airport.name}`, 14, 74, { size: 18, weight: 700 });
    if (!scene.place) text(`${scene.airport.icao}${scene.airport.iata ? ' / ' + scene.airport.iata : ''}  ·  runway ${landingNumber(scene)}  ·  ${(toThreshold / 1852).toFixed(1)} nm / ${(toThreshold / 1000).toFixed(1)} km`, 14, 98, { size: 14, weight: 600, color: '#dbe5f3' });
    if (MODE_LABEL[flightMode]) text(MODE_LABEL[flightMode], w - 14, 74 + 0, { align: 'right', color: '#ffd23f', size: 18, weight: 800 });
    if (plane.flaps && hasFlaps(flightMode)) text(`FLAPS ${FLAP_TEXT[flightMode][plane.flaps]}`, 14, scale > 1 ? 146 : 122, { color: '#9be7a5', size: 16, weight: 700 });
    if (scale > 1) text(`${scale}× speed`, 14, 122, { color: '#ffd23f', size: 16, weight: 700 });
    if (notice) text(notice, w / 2, h - 150, { align: 'center', color: '#ffd9a0', size: 14 });
    if (plane.stalled) text('STALL', cx, 110, { align: 'center', color: '#ff6b6b', size: 30, weight: 800 });
    if (plane.onGround) text(plane.brake ? 'On the ground · brakes' : 'On the ground', cx, 110, { align: 'center', color: '#9be7a5', size: 20 });
    if (flightMode !== 'drone' && plane.y < 60 && !plane.onGround && plane.verticalSpeed < -4) text('SINK RATE', cx, 140, { align: 'center', color: '#ffb347', size: 22, weight: 800 });
  }


  // ---- more map as the plane flies on --------------------------------------------------------------------------------------
  // Cells of OpenStreetMap around the plane, and ahead of it, are read a couple at a time; ones far behind are dropped again.
  function streamTiles(now) {
    if (!scene || !world || scene.source !== 'openstreetmap' || state === 'loading' || now - streaming.last < 400) return;
    streaming.last = now;
    // What to have ready: the ground around the plane, everything on the line ahead (as far as the plane will fly in the next
    // minute of simulated time, and as far as the view reaches), a fan to each side of the nose, and the whole area the map shows.
    const heading = plane.heading, fx = Math.sin(heading), fz = Math.cos(heading), minute = plane.speed * 60 * scale;
    const reach = Math.min(40000, Math.max(12000, minute)), wanted = [[0, 0]];
    for (let k = 0; k < 8; k++) wanted.push([Math.cos(k * Math.PI / 4) * 3200, Math.sin(k * Math.PI / 4) * 3200]);
    for (let d = 2500; d <= reach; d += 2500) { wanted.push([fx * d, fz * d]); if (d <= 15000) for (const turn of [-0.45, 0.45]) wanted.push([Math.sin(heading + turn) * d, Math.cos(heading + turn) * d]); }
    const span = ZOOMS[zoom] / 2; for (const dx of [-span, 0, span]) for (const dz of [-span, 0, span]) wanted.push([dx, dz]);
    wanted.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    const token = loadingToken;
    for (const [dx, dz] of wanted) {
      const x = plane.x + dx, z = plane.z + dz;
      if (streaming.pending.size >= 3) break;
      if (world.covered(x, z)) continue;
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
    while (extra.length > 30) { const tile = extra.shift(); world.removeTile(tile.key); renderer.removeTile(tile.key); }
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
    c.strokeStyle = '#2b2d33'; for (const r of scene.place ? [] : [scene.runway, ...scene.otherRunways]) { c.lineWidth = Math.max(2, r.width * k); c.beginPath(); c.moveTo(px(r.points[0][0]), py(r.points[0][1])); for (const q of r.points.slice(1)) c.lineTo(px(q[0]), py(q[1])); c.stroke(); }
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


  // ---- approach assist -------------------------------------------------------------------------------------------------------------
  // Near an airport, for the Cessna and the Airbus: the phase of the approach with the flaps, speed and throttle that go with it, shown
  // as text, and optionally applied automatically (auto throttle holds the target speed, auto flaps steps to the suggested setting).
  // Pressing the throttle or flap controls yourself pauses the automatic part for a few seconds. Away from airports it is hidden.
  const manualAt = { throttle: -1e9, flaps: -1e9 }, assist = { thr: false, flaps: false, at: 0, flapStep: 0, advice: null };
  try { const saved = JSON.parse(localStorage.getItem('flight-assist') || '{}'); assist.thr = Boolean(saved.thr); assist.flaps = Boolean(saved.flaps); } catch { /* defaults */ }
  $('#autoThrottle').checked = assist.thr; $('#autoFlaps').checked = assist.flaps;
  const saveAssist = () => { try { localStorage.setItem('flight-assist', JSON.stringify({ thr: assist.thr, flaps: assist.flaps })); } catch { /* optional */ } };
  $('#autoThrottle').onchange = event => { assist.thr = event.target.checked; saveAssist(); focusView(); };
  $('#autoFlaps').onchange = event => { assist.flaps = event.target.checked; saveAssist(); focusView(); };
  function nearAirport() {
    if (!scene || !plane || state !== 'flying' || scene.place || !hasFlaps(flightMode)) return null;
    const [tx, tz] = scene.runway.threshold, [fx, fz] = scene.runway.far, toCentre = Math.hypot(plane.x - (tx + fx) / 2, plane.z - (tz + fz) / 2);
    if (toCentre > 16000 || plane.y > 3000) return null;
    const d = Math.hypot(plane.x - tx, plane.z - tz), diff = Math.abs((((plane.heading - scene.runway.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    return { distance: d, departing: diff > 1.75 && d < 15000 };
  }
  function assistTick(now, dt) {
    const panel = $('#assist'), near = nearAirport(), advice = near ? P.advice(plane, { distance: near.distance, height: plane.y, departing: near.departing, glide: scene.glide }) : null;
    assist.advice = advice;
    if (!advice) { if (!panel.hidden) panel.hidden = true; return; }
    if (panel.hidden) panel.hidden = false;
    const kt = plane.speed * 1.943844, flapText = FLAP_TEXT[flightMode];
    if (!plane.onGround) {
      if (assist.thr && now - manualAt.throttle > 4000) {
        const target = Math.max(0, Math.min(1, advice.throttle + 0.012 * (advice.kt - kt))), next = plane.throttle + Math.max(-0.25 * dt, Math.min(0.25 * dt, target - plane.throttle));
        if (Math.abs(next - plane.throttle) > 1e-4) { plane.throttle = next; syncThrottle(); }
      }
      if (assist.flaps && now - manualAt.flaps > 6000 && (plane.flaps || 0) !== advice.flaps && now - assist.flapStep > 1500) { setFlaps((plane.flaps || 0) + Math.sign(advice.flaps - (plane.flaps || 0))); assist.flapStep = now; }
    }
    if (now - assist.at < 250) return; assist.at = now;
    $('#assistPhase').textContent = advice.phase.toUpperCase();
    const row = (label, text, good) => `<div><dt>${label}</dt><dd class="${good ? 'ok' : 'warn'}">${text}</dd></div>`, percent = value => `${Math.round(value * 100)}%`;
    $('#assistRows').innerHTML = row('Throttle', `suggest ${percent(advice.throttle)} · now ${percent(plane.throttle)}`, Math.abs(advice.throttle - plane.throttle) <= 0.06)
      + row('Flaps', `suggest ${flapText[advice.flaps]} · now ${flapText[plane.flaps || 0]}`, (plane.flaps || 0) === advice.flaps)
      + (advice.kt ? row('Speed', `target ${advice.kt} kt · now ${Math.round(kt)} kt`, Math.abs(kt - advice.kt) <= 8) : '');
    $('#assistNote').textContent = advice.note || (advice.glide < 0 ? `Hold about a ${-advice.glide}° descent with the stick; the throttle shown keeps the target speed.` : 'Level flight: hold the target speed with the stick.');
  }

  // ---- start up ---------------------------------------------------------------------------------------------------------------
  async function openAirport(code, options = {}) {
    const token = ++loadingToken;
    const before = state; state = 'loading'; $('#loading').hidden = false; $('#crash').hidden = true; $('#airport').value = code; progress(`Reading OpenStreetMap: ${OSM.AIRPORTS[code] ? OSM.AIRPORTS[code].label : code}…`, 0.05);
    const { scene: loaded, note, error, kind } = await loadScene(code);
    if (token !== loadingToken) return;
    if (error) {   // an unknown code: stay where we were
      if (!(kind === 'not-found' && options.notFound)) toast(error); $('#loading').hidden = true;
      if (scene) { state = before === 'loading' ? 'flying' : before; $('#airport').value = scene.code; focusView(); } else { progress(error, 0); $('#loading').hidden = false; }
      if (kind === 'not-found' && options.notFound) options.notFound();
      return;
    }
    scene = loaded; progress('Building the 3D scene…', 0.8); await nextFrame();
    world = OSM.createWorld(scene);
    const mesh = OSM.meshParts(scene); renderer.clearTiles(); renderer.setScene(mesh.ground, mesh.solid, mesh.base); notice = note; others = []; streaming.pending.clear(); streaming.failed.clear();
    window.flightState = () => ({ world, sceneObject: scene, scene: { source: scene.source, code: scene.code, buildings: scene.buildings.length, mode: flightMode, assist: assist.advice, airport: scene.airport, tiles: world.tiles.size, loading: streaming.pending.size, runway: { ref: scene.runway.ref, headingDegrees: scene.runway.heading * 180 / Math.PI, length: scene.runway.length } }, plane, others, state });
    $('#airport').value = scene.code; $('#airport').title = `${scene.airport.name} (${scene.airport.icao}${scene.airport.iata ? ' / ' + scene.airport.iata : ''}): type another code and press Enter`;
    try { localStorage.setItem('flight-airport', scene.code); } catch { /* optional */ }
    renderHelp(); if (flightMode === 'jet') setCamera('cockpit'); respawn(true); $('#loading').hidden = true; $('#reset').disabled = socket?.readyState !== WebSocket.OPEN; focusView();
  }
  async function start() {
    connect();
    try { renderer = new R.Renderer($('#view')); } catch (error) { progress(`${error.message} The flight simulator needs WebGL.`, 0); return; }
    requestAnimationFrame(frame);
    await openAirport(preferred());
  }
  start();
})();
