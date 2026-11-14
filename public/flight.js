// Flight simulator page: reads OpenStreetMap, flies a small plane in 3D and shares only the plane's position.
(() => {
  const $ = selector => document.querySelector(selector);
  const P = FlightPhysics, OSM = FlightOSM, R = FlightRender;
  const clientId = (() => { let id = sessionStorage.getItem('arcade-client'); if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('arcade-client', id); } return id; })();
  const SCALES = [1, 2, 5, 10, 50, 100, 500, 1000], Airports = FlightAirports, FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const streaming = { pending: new Map(), failed: new Map(), last: 0 }, ZOOMS = [2000, 6000, 20000, 60000, 200000, 600000], FLAPS = [0, 10, 20, 30], COAST_ONLY = 60000;   // from this span up the map draws the coastline only
  let autoMap = true, zoomWish = { index: 1, since: 0 }, worldLand = null, landLocal = null;
  const labels = { items: [], box: null, kinds: '', pending: false, at: 0 };   // city names for the map   // the world land layer, and the part of it near the airport in local metres
  let route = null, night = false, ap = { on: false, heading: 0, alt: 0, memo: {}, phase: '', flapAt: 0, km: 0 }, spinSelf = 0, crashedFor = 0, look = { yaw: 0, pitch: 0 }, zoom = 1, mapAt = 0, hudRead = null, hudAt = 0;
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
  // The airport to start at: the one in the address or the last one, or the default. A code that is not valid goes to Hong Kong (VHHH).
  const preferred = () => { let saved = null; try { saved = localStorage.getItem('flight-airport'); } catch { /* optional */ } const wanted = new URLSearchParams(location.search).get('airport') || saved; return wanted ? (OSM.resolveCode(wanted) || OSM.FALLBACK_AIRPORT) : OSM.DEFAULT_AIRPORT; };
  // The airports offered while typing: the built-in ones, then some well known codes (any 3 or 4 character code can be typed).
  // What the box shows for an airport (its code) or a place (its name: a place has no code).
  const shownAs = code => { const o = OSM.AIRPORTS[code]; return o && o.place ? o.label : code; };
  for (const [code, o] of Object.entries(OSM.AIRPORTS)) { const option = document.createElement('option'); option.value = shownAs(code); option.label = o.place ? 'a place to look around, not an airport' : o.label; $('#airportList').append(option); }
  for (const [code, name] of Airports.SUGGEST) { const option = document.createElement('option'); option.value = code; option.label = name; $('#airportList').append(option); }
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
    airbus: [['W / ↑', 'nose down (stick forward)'], ['S / ↓', 'nose up (stick back)'], ['A / ←', 'bank left'], ['D / →', 'bank right'], ['Q / E', 'rudder left / right'], ['Shift · PgUp', 'more thrust'], ['Z · PgDn', 'less thrust'], ['F / V', 'flaps down / up (UP, 1, 2, 3, FULL)'], ['G', 'landing gear up / down'], ['Space · B', 'wheel brakes'], ['[ ]  or  ◀ ▶', 'simulation speed 1× 2× 5× 10× 50× 100× 500× 1000× (keys 1 – 8 choose directly)'], ['C', 'chase / cockpit camera'], ['R', 'respawn on final approach'], ['M', 'switch vehicle (in flight)'], ['P', 'autopilot on / off: flies back to the runway and lands'], ['N', 'night mode on / off'], ['H', 'show / hide these keys']],
    plane: [['W / ↑', 'nose down (stick forward)'], ['S / ↓', 'nose up (stick back)'], ['A / ←', 'bank left'], ['D / →', 'bank right'], ['Q / E', 'rudder left / right'], ['Shift · PgUp', 'more throttle'], ['Z · PgDn', 'less throttle'], ['F / V', 'flaps down / up one notch'], ['Space · B', 'wheel brakes'], ['[ ]  or  ◀ ▶', 'simulation speed 1× 2× 5× 10× 50× 100× 500× 1000× (keys 1 – 8 choose directly)'], ['C', 'chase / cockpit camera'], ['R', 'respawn on final approach'], ['M', 'switch vehicle (in flight)'], ['P', 'autopilot on / off: flies to the runway and lands (untick Land to hold heading and altitude with A / D and W / S)'], ['N', 'night mode on / off'], ['H', 'show / hide these keys']],
    jet: [['W / ↑', 'nose down (stick forward), progressive'], ['S / ↓', 'nose up (stick back): hold it for a loop (up to 9 g)'], ['A / ←', 'roll left: hold it for a barrel roll'], ['D / →', 'roll right'], ['Q / E', 'yaw left / right'], ['Drag · J L I K', 'look around the cockpit'], ['Home · double-click', 'look straight ahead'], ['Shift · PgUp', 'more thrust'], ['Z · PgDn', 'less thrust'], ['Space · B', 'air brake in the air, wheel brakes on the ground'], ['[ ]  or  ◀ ▶', 'simulation speed 1× 2× 5× 10× 50× 100× 500× 1000× (keys 1 – 8 choose directly)'], ['G', 'landing gear up / down'], ['C', 'cockpit / outside camera'], ['R', 'respawn'], ['M', 'switch vehicle (in flight)'], ['P', 'autopilot on / off: flies to the runway and lands (untick Land to hold heading and altitude with A / D and W / S)'], ['N', 'night mode on / off'], ['H', 'show / hide these keys']],
    drone: [['↑', 'go up'], ['↓', 'go down'], ['←', 'turn left'], ['→', 'turn right'], ['A', 'slide left'], ['D', 'slide right'], ['W', 'forward'], ['S', 'backward'], ['I', 'camera angle up'], ['K', 'camera angle down'], ['—', 'no key: it stays where it is'], ['[ ]  or  ◀ ▶', 'simulation speed 1× 2× 5× 10× 50× 100× 500× 1000× (keys 1 – 8 choose directly)'], ['C', 'chase / first-person camera'], ['R', 'back to the start'], ['M', 'switch vehicle (in flight)'], ['P', 'autopilot on / off (then ↑ ↓ set the altitude, ← → the heading)'], ['N', 'night mode on / off'], ['H', 'show / hide these keys']]
  };
  const MODES = ['plane', 'airbus', 'jet', 'drone'], MODE_LABEL = { plane: '', airbus: 'A320', jet: 'JET', drone: 'DRONE' };
  // How high the model's centre is above the ground (the gear), how big it is drawn, and the flap settings of each aircraft.
  const GEAR = { plane: 1.1, airbus: 3.8, jet: 1.65, drone: 0.03 }, SIZE = {}, FLAP_TEXT = { plane: ['0°', '10°', '20°', '30°'], airbus: ['UP', '1', '2', '3', 'FULL'] };
  const hasFlaps = mode => mode === 'plane' || mode === 'airbus';
  const hasGear = mode => Boolean(P.GEAR_TRAVEL[mode]);   // the Airbus and the jet have retractable gear; the Cessna 172's is fixed
  let flightMode = (() => { try { const saved = new URLSearchParams(location.search).get('mode') || localStorage.getItem('flight-mode'); return MODES.includes(saved) ? saved : 'plane'; } catch { return 'plane'; } })();
  function renderHelp() {
    const list = $('#keyList'); list.replaceChildren();
    for (const [key, text] of HELP[flightMode]) { const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = text; row.append(dt, dd); list.append(row); }
    $('#flapsGroup').hidden = !hasFlaps(flightMode); $('#gearGroup').hidden = !hasGear(flightMode); document.querySelector('.throttle').hidden = flightMode === 'drone';   // a drone has no throttle
    $('#mode').value = flightMode;
  }

  // ---- the plane -------------------------------------------------------------------------------------------------------------
  function respawn(notify = true) {
    setAutopilot(false);
    const a = OSM.finalApproach(scene);
    const routed = Boolean(route && route.active && !route.swapped && !scene.place);   // a flight starts on the runway; anything else (or after the swap) is a landing
    if (!routed) route = null;
    const options = { x: a.x, z: a.z, heading: a.heading, distance: scene.distance, glide: (scene.place ? 0 : scene.glide) * Math.PI / 180 };
    if (scene.place) {   // sightseeing: start level at cruise, not on a landing approach
      options.crossing = scene.start.alt; if (flightMode === 'airbus') Object.assign(options, { speed: 100, throttle: 0.45, flaps: 0 }); else if (flightMode === 'plane') Object.assign(options, { speed: 52, throttle: 0.5, flaps: 0 });
    } else if (scene.glide > 3.2) options.throttle = Math.max(0, (P.SPECS[flightMode] || P.PLANE).approachThrottle - (scene.glide - 3) * 0.05);   // a steeper approach needs less power
    plane = routed ? P.spawnTakeoff(flightMode, { x: scene.runway.threshold[0], z: scene.runway.threshold[1], heading: scene.runway.heading }) : P.spawn(flightMode, options);
    if (routed) { route.departed = false; route.phase = 'TAKEOFF'; }
    if (scene.place) { plane.gear = 0; plane.gearDown = false; }   // sightseeing: cruising with the gear up

    $('#crash').hidden = true; state = 'flying'; syncThrottle();
    if (routed && (flightMode === 'plane' || flightMode === 'airbus')) setAutopilot(true);   // on by default for a flight; the pilot can switch it off
    if (notify && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'respawn' }));
  }
  // The same place and heading, high enough to clear the tallest building there.
  function recoverHere() {
    let top = 0; for (let y = 0; y <= 800; y += 20) if (world.obstacle(plane.x, y, plane.z)) top = y + 20;
    P.recover(plane, Math.max(300, top + 150)); $('#crash').hidden = true; state = 'flying'; syncThrottle(); setScale(1);   // after a crash: back in the air at normal speed
  }
  // Landing gear (G): up or down. Not on the ground, and landing with it up is a crash.
  function setGear(down, manual = true) {
    if (!plane) return;
    if (!hasGear(flightMode)) { if (manual && flightMode !== 'drone') toast('The Cessna 172 has fixed landing gear.'); return; }
    if (plane.onGround && !down) { toast('The gear stays down on the ground.'); return; }
    plane.gearDown = down; if (manual) manualAt.gear = performance.now();
  }
  function setFlaps(notches) { if (!plane) return; const text = FLAP_TEXT[flightMode] || FLAP_TEXT.plane; plane.flaps = Math.max(0, Math.min(text.length - 1, notches)); $('#flapsValue').textContent = text[plane.flaps]; }
  function syncThrottle() { setFlaps(plane.flaps || 0); const percent = Math.round(plane.throttle * 100); $('#throttle').value = percent; $('#throttleValue').textContent = `${percent}%`; }

  // ---- controls ---------------------------------------------------------------------------------------------------------------
  const KEYMAP = { KeyW: 'noseDown', ArrowUp: 'noseDown', KeyS: 'noseUp', ArrowDown: 'noseUp', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'rudderLeft', KeyE: 'rudderRight', KeyJ: 'lookLeft', KeyL: 'lookRight', KeyI: 'lookUp', KeyK: 'lookDown', ShiftLeft: 'moreThrottle', ShiftRight: 'moreThrottle', PageUp: 'moreThrottle', Equal: 'moreThrottle', KeyZ: 'lessThrottle', PageDown: 'lessThrottle', Minus: 'lessThrottle', Space: 'brake', KeyB: 'brake' };
  // The drone is flown differently: arrows climb, descend and turn, A / D slide sideways, W / S tilt the camera.
  const DRONE_KEYMAP = { ArrowUp: 'climb', ArrowDown: 'descend', ArrowLeft: 'yawLeft', ArrowRight: 'yawRight', KeyA: 'strafeLeft', KeyD: 'strafeRight', KeyW: 'forward', KeyS: 'backward', KeyI: 'viewUp', KeyK: 'viewDown' };
  const keymap = () => flightMode === 'drone' ? DRONE_KEYMAP : KEYMAP;
  const held = action => [...keys].some(code => keymap()[code] === action);
  // The simulation speed: arrows step through 1, 2, 5, 10, 50, 100, 500 and 1000 times (keys [ and ], or , and .; keys 1 to 8 choose directly).
  function setScale(value) { scale = value; $('#speedValue').textContent = `${value}×`; }
  const stepScale = direction => setScale(SCALES[Math.max(0, Math.min(SCALES.length - 1, SCALES.indexOf(scale) + direction))]);
  // Night mode (N): dark sky and haze, lit windows, airport lights, blinking obstruction lights on towers, and aircraft lights.
  function setNight(on) { night = Boolean(on); renderer?.setNight(night); $('#night').setAttribute('aria-pressed', String(night)); try { localStorage.setItem('flight-night', night ? '1' : '0'); } catch { /* optional */ } }
  function setCamera(mode) { cameraMode = mode; look = { yaw: 0, pitch: 0 }; $('#camera').setAttribute('aria-pressed', String(mode === 'cockpit')); }
  function toggleHelp(force) { const open = force ?? $('#keys').hidden; $('#keys').hidden = !open; $('#help').setAttribute('aria-pressed', String(open)); }
  const focusView = () => $('#view').focus({ preventScroll: true });
  addEventListener('keydown', event => {
    // Typing in a text box or using the shared top bar is never flying; buttons, the throttle slider and the airport list are fine.
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('.arcade-topbar,.arcade-debug-panel') || event.target.matches?.('input:not(#throttle),textarea,[contenteditable="true"]')) return;
    if (event.target.id === 'airport' && /^(Arrow|Page|Home|End)/.test(event.code)) return;
    if (event.code === 'BracketLeft' || event.code === 'Comma') { stepScale(-1); event.preventDefault(); return; }
    if (event.code === 'BracketRight' || event.code === 'Period') { stepScale(1); event.preventDefault(); return; }
    const digit = /^Digit([1-8])$/.exec(event.code);
    if (digit) { setScale(SCALES[Number(digit[1]) - 1]); event.preventDefault(); return; }
    if (event.code === 'KeyM' && state !== 'loading') { setMode(MODES[(MODES.indexOf(flightMode) + 1) % MODES.length]); return; }
    if (event.code === 'KeyN') { setNight(!night); return; }
    if (event.code === 'KeyG' && plane && !event.repeat) { setGear(plane.gearDown === false); return; }
    if (event.code === 'KeyP') { setAutopilot(!ap.on); return; }
    if (event.code === 'Home') { look = { yaw: 0, pitch: 0 }; return; }
    if (event.code === 'KeyC') { setCamera(cameraMode === 'chase' ? 'cockpit' : 'chase'); return; }
    if (event.code === 'KeyH') { toggleHelp(); return; }
    if ((event.code === 'KeyF' || event.code === 'KeyV') && plane && hasFlaps(flightMode)) { if (!event.repeat) { manualAt.flaps = performance.now(); setFlaps((plane.flaps || 0) + (event.code === 'KeyF' ? 1 : -1)); } return; }
    if ((event.code === 'KeyR' || event.code === 'Enter') && state !== 'loading') { respawn(); return; }
    if (keymap()[event.code]) { keys.add(event.code); event.preventDefault(); }
  });
  addEventListener('keyup', event => keys.delete(event.code));
  addEventListener('blur', () => keys.clear());
  $('#speedDown').onclick = () => { stepScale(-1); focusView(); }; $('#speedUp').onclick = () => { stepScale(1); focusView(); };
  $('#camera').onclick = () => { setCamera(cameraMode === 'chase' ? 'cockpit' : 'chase'); focusView(); };
  $('#help').onclick = () => { toggleHelp(); focusView(); };
  $('#flapsUp').onclick = () => { manualAt.flaps = performance.now(); setFlaps((plane?.flaps || 0) - 1); focusView(); }; $('#flapsDown').onclick = () => { manualAt.flaps = performance.now(); setFlaps((plane?.flaps || 0) + 1); focusView(); };
  // The map scale is automatic by default (button A): it zooms out with speed and height. The + and − buttons take it over; A gives it back.
  const setAutoMap = on => { autoMap = on; $('#zoomAuto').setAttribute('aria-pressed', String(on)); };
  $('#zoomIn').onclick = () => { setAutoMap(false); zoom = Math.max(0, zoom - 1); focusView(); }; $('#zoomOut').onclick = () => { setAutoMap(false); zoom = Math.min(ZOOMS.length - 1, zoom + 1); focusView(); }; $('#zoomAuto').onclick = () => { setAutoMap(!autoMap); focusView(); };
  // Dragging the view looks around the cockpit (or orbits the outside view); double-click looks straight ahead.
  { const view = $('#view'); let drag = null; view.style.touchAction = 'none';
    view.addEventListener('pointerdown', event => { if (flightMode !== 'jet') return; drag = { x: event.clientX, y: event.clientY }; view.setPointerCapture?.(event.pointerId); });
    view.addEventListener('pointermove', event => { if (!drag) return; look.yaw = Math.max(-Math.PI, Math.min(Math.PI, look.yaw + (event.clientX - drag.x) * 0.006)); look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch - (event.clientY - drag.y) * 0.006)); drag = { x: event.clientX, y: event.clientY }; });
    for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, () => { drag = null; });
    view.addEventListener('dblclick', () => { look = { yaw: 0, pitch: 0 }; }); }
  $('#night').onclick = () => { setNight(!night); focusView(); };
  $('#gear').onclick = () => { if (plane) setGear(plane.gearDown === false); focusView(); };
  $('#autoPilot').onchange = event => { setAutopilot(event.target.checked); event.target.checked = ap.on; focusView(); };
  $('#again').onclick = () => respawn();
  $('#reset').onclick = () => { if (state !== 'loading') respawn(); };
  $('#throttle').oninput = event => { manualAt.throttle = performance.now(); if (plane) { plane.throttle = Number(event.target.value) / 100; $('#throttleValue').textContent = `${event.target.value}%`; } };
  // Switch vehicle in mid-flight: the position, heading, speed and throttle carry over. After a crash it starts over instead.
  function setMode(next) {
    setAutopilot(false); flightMode = MODES.includes(next) ? next : 'plane'; look = { yaw: 0, pitch: 0 }; setCamera(flightMode === 'jet' ? 'cockpit' : 'chase');
    try { localStorage.setItem('flight-mode', flightMode); } catch { /* optional */ } keys.clear(); renderHelp();
    if (!scene || !plane || state === 'loading') return;
    if (state === 'crashed' || plane.crashed) respawn(true); else { P.switchMode(plane, flightMode); syncThrottle(); }
  }
  $('#mode').onchange = event => { setMode(event.target.value); focusView(); };
  // Type an airport code (IATA or ICAO) and press Enter, or pick one from the list.
  // The box takes a code (YTZ, CYTZ) or a name (Heathrow, Kennedy). A code that is not found is searched as a name ("Nice" is not a code).
  const searchCache = new Map(); let lastSearchAt = 0, lastSubmit = { text: '', which: '', at: 0 };
  const hideResults = () => { $('#results').hidden = true; $('#resultList').replaceChildren(); };
  async function searchAirports(text) {
    const key = text.trim().toLowerCase(); if (searchCache.has(key)) return searchCache.get(key);
    const wait = 1100 - (Date.now() - lastSearchAt); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));   // the service allows one request a second
    lastSearchAt = Date.now();
    // 1. airports whose name matches (Nominatim), 2. the place the text names (a city or region), 3. Overpass: airports near that place and
    // airports whose names contain the text. Any step may fail; the search only fails if none of them worked.
    const nominatim = async url => { const response = await fetch(url); if (!response.ok) throw new Error(String(response.status)); return response.json(); };
    let named = [], places = [], nearby = [], worked = 0;
    try { named = OSM.parseSearch(await nominatim(OSM.searchUrl(text))); worked++; } catch (error) { console.warn('Airport name search failed:', error); }
    await new Promise(resolve => setTimeout(resolve, 1100));   // the service allows one request a second
    try { places = OSM.parsePlaces(await nominatim(OSM.searchPlaceUrl(text))); worked++; } catch (error) { console.warn('Place search failed:', error); }
    // The two Overpass questions (codes of the airports found by name, and airports near the place) are asked at the same time.
    const enrich = OSM.enrichQuery(named), near = OSM.airportsQuery(text, places);
    await Promise.all([
      (async () => { if (enrich) { try { named = OSM.applyTags(named, await fetchOverpass(enrich, 25000)); } catch (error) { named = named.filter(r => r.code); } } else named = named.filter(r => r.code); })(),
      (async () => { if (near) { try { nearby = OSM.parseAirportElements(await fetchOverpass(near, 30000), places, text); worked++; } catch (error) { console.warn('Nearby airport search failed:', error); } } })()
    ]);
    if (!worked) throw new Error('search unavailable');
    const found = OSM.mergeSearch(named.map(r => ({ ...r, matched: true, km: 0 })), nearby); searchCache.set(key, found); return found;
  }
  function pick(result, which = 'to') { hideResults(); setAirport(result.code, which); }
  // The list of airports to choose from (or the one airport, opened at once).
  function presentFound(found, which) {
    if (found.length === 1) { pick(found[0], which); return; }
    const list = $('#resultList'); list.replaceChildren();
    for (const r of found) {
      const item = document.createElement('li'), button = document.createElement('button'), name = document.createElement('span'), codes = document.createElement('b'), where = document.createElement('small');
      button.type = 'button'; button.setAttribute('role', 'option'); name.textContent = r.name; codes.textContent = [r.icao, r.iata].filter(Boolean).join(' / '); where.textContent = r.where;
      button.append(name, codes, where); button.onclick = () => pick(r, which); item.append(button); list.append(item);
    }
    $('#results').hidden = false; list.querySelector('button').focus();
  }
  // Search by name or city: the built-in copy of the world's major airports first (instant, nothing is asked of a server), and OpenStreetMap's
  // search only when the built-in copy has nothing that matches.
  async function searchByName(text, which = 'to') {
    const local = Airports.search(text); if (local.length) { $('#toast').hidden = true; presentFound(local, which); return; }
    toast(`Searching for “${text}”…`);
    let found; try { found = await searchAirports(text); } catch (error) { toast('The airport search could not be reached. Try an airport code instead.'); return; }
    $('#toast').hidden = true;
    if (!found.length) { if (which === 'from') { toast(`No airport matches “${text}”. The From airport was left empty.`); $('#fromAirport').value = ''; return; } await goToFallback(`No airport matches “${text}”.`); return; }
    presentFound(found, which);
  }
  // The To airport is where you land; the From airport (optional) is where you take off from. With no From it is a landing, as before; with both, the
  // autopilot flies from one to the other. Either box takes a code or a name.
  function setAirport(code, which, text = code) {
    const current = route ? route.toCode : scene ? scene.code : OSM.DEFAULT_AIRPORT, from = route ? route.fromCode : $('#fromAirport').value ? OSM.resolveCode($('#fromAirport').value) : '';
    const typed = { text, which };
    if (which === 'from') { $('#fromAirport').value = code; openFlight(current, code, typed); } else { $('#airport').value = shownAs(code); openFlight(code, from, typed); }
  }
  function submitAirport(raw, which = 'to') {
    const text = String(raw || '').trim(), now = Date.now();
    if (!text && which === 'from') { if (route) openFlight(route.toCode, ''); return; }   // the From box was emptied: back to a plain landing
    if (!text || (text === lastSubmit.text && which === lastSubmit.which && now - lastSubmit.at < 800)) return; lastSubmit = { text, which, at: now }; hideResults();
    const code = OSM.resolveCode(text);
    if (which === 'to' && code && scene && state !== 'loading' && !route && (code === scene.code || code === scene.airport.iata || code === scene.airport.icao) && !$('#fromAirport').value) { $('#airport').value = shownAs(scene.code); focusView(); return; }
    // A 3 or 4 letter word that is not a code we know but matches a city or name in the built-in copy ("Nice", "Rome") is a name, not a code to look up.
    if (code && !Airports.hasCode(code) && !OSM.AIRPORTS[code] && Airports.search(text).length) searchByName(text, which);
    else if (code) setAirport(code, which, text); else searchByName(text, which);
    (which === 'from' ? $('#fromAirport') : $('#airport')).blur();
  }
  for (const box of [$('#fromAirport'), $('#airport')]) { box.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitAirport(event.target.value, event.target.id === 'fromAirport' ? 'from' : 'to'); } }); box.onfocus = event => event.target.select(); }
  $('#airport').addEventListener('keydown', event => { if (false) {} else if (event.key === 'ArrowDown' && !$('#results').hidden) { event.preventDefault(); $('#resultList button')?.focus(); } else if (event.key === 'Escape') hideResults(); });
  for (const box of [$('#fromAirport'), $('#airport')]) box.onchange = event => { const code = OSM.resolveCode(event.target.value); if (code && (OSM.AIRPORTS[code] || Airports.hasCode(code) || OSM.SUGGESTIONS.some(([known]) => known === code))) submitAirport(event.target.value, event.target.id === 'fromAirport' ? 'from' : 'to'); };   // picked from the suggestions   // picked from the suggestions
  $('#results').addEventListener('keydown', event => { if (event.key === 'Escape') { hideResults(); $('#airport').focus(); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...$('#resultList').querySelectorAll('button')], at = buttons.indexOf(document.activeElement); buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); } });
  document.addEventListener('pointerdown', event => { if (!$('#results').hidden && !event.target.closest('#results,#airport,#fromAirport')) hideResults(); });

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

  // ---- autopilot (P) ---------------------------------------------------------------------------------------------------------------
  // Off by default. When it is switched on it takes the current heading and altitude as its targets and flies them: it steers by banking
  // and sets the angle of the flight path. While it is on the keys move the targets instead of flying the aircraft: A / D turn the heading
  // bug, W / S raise and lower the altitude. The throttle stays with the pilot. It switches itself off on the ground, after a crash, when
  // the vehicle is switched and on a respawn.
  // It can land the Cessna and the Airbus at the airport (not at a place, and not the jet or the drone).
  const canLand = () => Boolean(scene && plane && !scene.place && (flightMode === 'plane' || flightMode === 'airbus'));
  const runwayInfo = () => ({ x: scene.runway.threshold[0], z: scene.runway.threshold[1], heading: scene.runway.heading, length: scene.runway.length, width: scene.runway.width, glide: scene.glide });
  function setAutopilot(on) {
    if (on && (!plane || (plane.onGround && !(route && route.active && !route.departed)) || plane.crashed || state !== 'flying')) on = false;
    ap = { on, heading: plane ? plane.heading : 0, alt: plane ? Math.max(plane.y, 30) : 0, memo: {}, phase: '', flapAt: 0, km: 0 };
    $('#autoPilot').checked = on;
  }
  // Carry out a command from the landing / takeoff / cruise logic: the stick, the throttle (ramped), the flaps one notch at a time, the gear.
  function applyCommand(cmd, input, dt) {
    if (cmd.gear != null && hasGear(flightMode) && !plane.onGround && plane.gearDown !== cmd.gear) plane.gearDown = cmd.gear;
    input.elevator = cmd.elevator; input.aileron = cmd.aileron; input.rudder = cmd.rudder; input.brake = cmd.brake;
    plane.throttle += Math.max(-0.3 * dt, Math.min(0.3 * dt, cmd.throttle - plane.throttle)); syncThrottle();
    const now = performance.now(); if (!plane.onGround && (plane.flaps || 0) !== cmd.flaps && now - ap.flapAt > 1500) { setFlaps((plane.flaps || 0) + Math.sign(cmd.flaps - (plane.flaps || 0))); ap.flapAt = now; }
    if (plane.onGround && cmd.phase === 'TAKEOFF' && (plane.flaps || 0) !== cmd.flaps) setFlaps(cmd.flaps);
  }
  // A flight (From and To both set): take off, climb, cruise towards the destination, swap to its scene when near, descend, land.
  function applyRoute(input, dt) {
    if (plane.crashed) { setAutopilot(false); return; }
    if ((input.elevator || input.aileron) && !plane.onGround) { setAutopilot(false); return; }   // the pilot takes over
    const to = route.swapped ? { x: scene.runway.threshold[0], z: scene.runway.threshold[1] } : (() => { const [x, z] = scene.toLocal(route.destScene.origin.lat, route.destScene.origin.lon); return { x, z }; })();
    const distance = Math.hypot(to.x - plane.x, to.z - plane.z); route.km = distance / 1000;
    if (!route.swapped && distance < route.plan.swapAt) { swapScene(route.destScene); route.swapped = true; return; }
    let cmd;
    if (plane.onGround && !route.departed) cmd = P.autotakeoff(plane, { x: scene.runway.threshold[0], z: scene.runway.threshold[1], heading: scene.runway.heading });
    else {
      route.departed = true;
      if (route.swapped && distance < route.plan.descentAt) { cmd = P.autoland(plane, runwayInfo(), ap.memo); if (!cmd || cmd.done) { route.active = false; setAutopilot(false); return; } }
      else cmd = P.enroute(plane, { heading: Math.atan2(to.x - plane.x, to.z - plane.z), alt: route.plan.cruise });
    }
    if (!cmd) { setAutopilot(false); return; }
    applyCommand(cmd, input, dt); route.phase = cmd.phase; ap.phase = cmd.phase;
    if ((cmd.phase === 'TAKEOFF' || plane.y < 150 || (cmd.s !== undefined && cmd.s > -4000 && cmd.phase !== 'NAV')) && scale > 1) setScale(1);   // takeoff and landing are flown in real time
  }
  function applyAutopilot(input, dt) {
    if (plane.crashed) { setAutopilot(false); return; }
    if (route && route.active && (flightMode === 'plane' || flightMode === 'airbus')) { applyRoute(input, dt); return; }
    // One button: for the Cessna and the Airbus at an airport the autopilot flies to the runway, lines up, descends on the glide path, flares,
    // touches down, rolls out and stops. Moving the stick yourself switches it off (as in a real aircraft). Elsewhere it holds heading and altitude.
    if (canLand()) {
      if ((input.elevator || input.aileron) && !plane.onGround) { setAutopilot(false); return; }
      else {
        const cmd = P.autoland(plane, runwayInfo(), ap.memo);
        if (!cmd) { setAutopilot(false); return; }
        if (cmd.done) { plane.brake = true; setAutopilot(false); return; }
        applyCommand({ ...cmd, gear: cmd.gear ? true : null }, input, dt); ap.phase = cmd.phase; ap.km = Math.hypot(cmd.s, cmd.c) / 1000;
        if (cmd.phase !== 'NAV' && cmd.s > -4000 && scale > 1) setScale(1);   // the last few kilometres are flown in real time
        return;
      }
    }
    if (plane.onGround) { setAutopilot(false); return; }
    const drone = flightMode === 'drone', climbRate = drone ? 6 : { plane: 5, airbus: 12, jet: 40 }[flightMode] || 5;
    ap.alt = Math.max(30, Math.min(6000, ap.alt + (drone ? input.climb : input.elevator) * climbRate * dt)); ap.heading += (drone ? input.yaw * 0.8 : input.aileron * 0.4) * dt;
    const command = P.autopilot(plane, ap); if (!command) return;
    if (drone) { input.climb = command.climb; input.yaw = command.yaw; } else { input.elevator = command.elevator; input.aileron = command.aileron; input.rudder = 0; }
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
      return { position: cameraMode === 'cockpit' ? [p[0], p[1], p[2]] : [p[0] - flat[0] * 0.9, p[1] + 0.3, p[2] - flat[2] * 0.9], forward: look, up: [0, 1, 0], fov: 1.1, near: 0.12 };   // a real drone is small, so the camera is close
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
    requestAnimationFrame(frame); loadWorldLand();
    if (!scene || !plane || state === 'loading') return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    if (state === 'flying') {
      const input = pilotInput(); if (ap.on) applyAutopilot(input, dt);
      P.advance(plane, input, dt, world, 0.025, scale); if (input.throttleRate) { syncThrottle(); manualAt.throttle = now; }
      if (plane.crashed) { state = 'crashed'; crashedFor = 0; $('#crashText').textContent = plane.crashed; $('#crash').hidden = false; }
    } else if (state === 'crashed') {
      // Three seconds after a crash the same vehicle is put back in the same place, higher up.
      crashedFor += dt; $('#crashCount').textContent = `Back in the air in ${Math.max(1, Math.ceil(3 - crashedFor))}…`;
      if (crashedFor >= 3) recoverHere();
    }
    if (flightMode === 'jet') { const turn = ((held('lookRight') ? 1 : 0) - (held('lookLeft') ? 1 : 0)) * dt * 2, tilt = ((held('lookUp') ? 1 : 0) - (held('lookDown') ? 1 : 0)) * dt * 2; look.yaw = Math.max(-Math.PI, Math.min(Math.PI, look.yaw + turn)); look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch + tilt)); }
    plane.flapShow = (plane.flapShow ?? plane.flaps ?? 0) + ((plane.flaps || 0) - (plane.flapShow ?? plane.flaps ?? 0)) * Math.min(1, dt * 2.5);   // the panels move smoothly between notches
    assistTick(now, dt); spinSelf += dt * (flightMode === 'drone' ? 180 : 25 + plane.throttle * 110);
    sharePosition(now); streamTiles(now);
    const planes = [{ x: plane.x, y: plane.y, z: plane.z, heading: plane.heading, pitch: plane.pitch, roll: plane.roll, body: [0.8, 0.1, 0.12], accent: [0.1, 0.2, 0.45], scale: SIZE[flightMode] || 1, axes: plane.axes, model: flightMode, baseY: GEAR[flightMode], spin: spinSelf, gear: plane.gear, flapShow: plane.flapShow }];
    for (const other of others) planes.push({ x: other.x, y: other.y, z: other.z, heading: other.heading, pitch: other.pitch, roll: other.roll, body: hexColor(other.color), accent: [0.1, 0.2, 0.45], scale: SIZE[other.model] || 1, model: other.model || 'plane', baseY: GEAR[other.model] ?? 1.1, spin: spinOf(other, dt), gear: other.y < 150 ? 1 : 0 });
    if (cameraMode === 'cockpit') planes.shift();
    renderer.setDynamicLights(night ? new Float32Array(dynamicLights(planes)) : null);
    const viewProj = renderer.draw(camera(), planes, {});
    drawHud(viewProj); if (now - mapAt > 90) { mapAt = now; drawMap(); }
  }
  // Lights that move or change every frame: the navigation lights, strobes and beacons of every aircraft in view, and the PAPI.
  function dynamicLights(planes) {
    const out = [];
    for (const entry of planes) {
      const b = entry.axes ? { right: entry.axes.r, up: entry.axes.u, forward: entry.axes.f } : basis(entry), k = entry.scale || 1, y = entry.y + (entry.baseY ?? 1.1);
      for (const [p, c, period, offset, duty, size] of FlightModels.navLights(entry.model)) out.push(entry.x + (b.right[0] * p[0] + b.up[0] * p[1] + b.forward[0] * p[2]) * k, y + (b.right[1] * p[0] + b.up[1] * p[1] + b.forward[1] * p[2]) * k, entry.z + (b.right[2] * p[0] + b.up[2] * p[1] + b.forward[2] * p[2]) * k, c[0], c[1], c[2], period, offset, duty, size * (k < 0.5 ? 1 : 1));
    }
    if (scene.lightData && scene.lightData.papi.length && plane) for (const v of OSM.papiLights(scene, scene.lightData.papi, [plane.x, plane.y, plane.z], landingNumber(scene))) out.push(v);
    return out;
  }
  // Each other pilot's propeller angle, advanced by their throttle.
  const spins = new Map(); const spinOf = (other, dt) => { const angle = (spins.get(other.id) || 0) + dt * (other.model === 'drone' ? 180 : 25 + (other.throttle || 0) * 110); spins.set(other.id, angle); return angle; };
  const hexColor = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

  // The destination scene takes over in flight: the same place, height, speed and heading, in the new airport's own coordinates.
  function swapScene(next) {
    const geo = scene.toGeo(plane.x, plane.z), altitude = plane.y + scene.airport.elevation, spot = next.toLocal(geo.lat, geo.lon);
    applyScene(next, ''); plane.x = spot[0]; plane.z = spot[1]; plane.y = altitude - next.airport.elevation; ap.memo = {};
  }
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
    // Flap position: one block per notch, filled up to the current setting, with its name; gear: three lights.
    if (hasFlaps(flightMode)) {
      const labels = FLAP_TEXT[flightMode], notches = labels.length - 1, left = cx - 236;
      text('FLAPS', left, h - 40, { ...label, size: 11 }); text(labels[plane.flaps || 0], left + 56, h - 40, { color: plane.flaps ? '#9be7a5' : '#dbe5f3', size: 13, weight: 800 });
      for (let i = 1; i <= notches; i++) { c.fillStyle = i <= (plane.flaps || 0) ? '#9be7a5' : 'rgba(255,255,255,0.22)'; c.fillRect(left + (i - 1) * 24, h - 28, 20, 8); }
    }
    if (hasGear(flightMode)) {
      const gear = plane.gear ?? 1, right = cx + 120, moving = gear > 0.02 && gear < 0.98;
      text('GEAR', right, h - 40, { ...label, size: 11 }); text(gear >= 0.98 ? 'DOWN' : gear <= 0.02 ? 'UP' : (plane.gearDown === false ? 'RETRACTING' : 'EXTENDING'), right + 44, h - 40, { color: moving ? '#ff9f6b' : gear >= 0.98 ? '#9be7a5' : '#dbe5f3', size: 13, weight: 800 });
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(right + 8 + i * 24, h - 24, 7, 0, Math.PI * 2); c.fillStyle = moving ? '#ff6b3d' : gear >= 0.98 ? '#37d67a' : 'rgba(255,255,255,0.18)'; c.fill(); }
    }
    if (flightMode !== 'drone') { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 60, h - 26, 120, 8); c.fillStyle = '#ffd23f'; c.fillRect(cx - 60, h - 26, 120 * plane.throttle, 8); text('THROTTLE', cx, h - 40, { align: 'center', ...label }); }
    const toThreshold = Math.hypot(plane.x - scene.runway.threshold[0], plane.z - scene.runway.threshold[1]);
    text(scene.place ? scene.label : `${scene.airport.name}`, 14, 74, { size: 18, weight: 700 });
    if (!scene.place) text(`${scene.airport.icao}${scene.airport.iata ? ' / ' + scene.airport.iata : ''}  ·  runway ${landingNumber(scene)}  ·  ${(toThreshold / 1852).toFixed(1)} nm / ${(toThreshold / 1000).toFixed(1)} km`, 14, 98, { size: 14, weight: 600, color: '#dbe5f3' });
    if (flightMode === 'jet' && plane.mach != null) { text(`G ${(plane.g ?? 1).toFixed(1)}   M ${plane.mach.toFixed(2)}${plane.throttle > 0.75 ? '   AB' : ''}`, 24, h - 164, { color: Math.abs(plane.g ?? 1) > 7 ? '#ff9f6b' : '#dbe5f3', size: 16, weight: 700 }); }
    let lineY = 112; const nextLine = (gap) => { const y = lineY; lineY += gap; return y; };   // messages at the top centre are stacked, never on top of each other
    if (route && route.active) text(`${route.fromCode} → ${route.toCode}   ${ap.on ? route.phase : 'AUTOPILOT OFF'}   ${route.km.toFixed(0)} km to go`, cx, nextLine(28), { align: 'center', color: '#9be7a5', size: 16, weight: 800 });
    else if (ap.on && canLand()) text(`AUTOLAND   ${ap.phase || 'NAV'}   ${ap.km.toFixed(1)} km to the runway`, cx, nextLine(28), { align: 'center', color: '#9be7a5', size: 16, weight: 800 });
    else if (ap.on) text(`AUTOPILOT   HDG ${String(Math.round(((ap.heading * 180 / Math.PI) % 360 + 360) % 360) % 360).padStart(3, '0')}°   ALT ${Math.round(ap.alt * 3.28084).toLocaleString()} ft`, cx, nextLine(28), { align: 'center', color: '#9be7a5', size: 16, weight: 800 });
    if (MODE_LABEL[flightMode]) text(MODE_LABEL[flightMode], w - 14, 74 + 0, { align: 'right', color: '#ffd23f', size: 18, weight: 800 });
    if (scale > 1) text(`${scale}× speed`, 14, 122, { color: '#ffd23f', size: 16, weight: 700 });
    if (notice) text(notice, w / 2, h - 150, { align: 'center', color: '#ffd9a0', size: 14 });
    if (plane.stalled) text('STALL', cx, nextLine(36), { align: 'center', color: '#ff6b6b', size: 30, weight: 800 });
    if (plane.onGround) text(plane.brake ? 'On the ground · brakes' : 'On the ground', cx, nextLine(28), { align: 'center', color: '#9be7a5', size: 20 });
    if (flightMode !== 'drone' && plane.y < 60 && !plane.onGround && plane.verticalSpeed < -4) text('SINK RATE', cx, nextLine(30), { align: 'center', color: '#ffb347', size: 22, weight: 800 });
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
    const span = Math.min(ZOOMS[zoom], 20000) / 2; for (const dx of [-span, 0, span]) for (const dz of [-span, 0, span]) wanted.push([dx, dz]);   // far out only coastline cells are read (below)
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
        world.addTile(tile); const mesh = OSM.tileParts(tile); renderer.setTile(tile.key, mesh.ground, mesh.solid); renderer.setLights(tile.key, new Float32Array(OSM.obstructionLights(tile.buildings))); evictTiles();
      }).catch(error => { streaming.pending.delete(key); streaming.failed.set(key, performance.now() + 20000); console.warn('More map could not be read:', error); });
    }
  }
  // The zoomed-out map's land: the world land layer (Natural Earth, one small file, cached in the browser), read once in the background and
  // projected for each airport scene; until it arrives the far-out map just shows the land colour.
  async function loadWorldLand() {
    try { const topology = await cached(OSM.LAND_URL) || await (async () => { const response = await fetch(OSM.LAND_URL); if (!response.ok) throw new Error(String(response.status)); const json = await response.json(); remember(OSM.LAND_URL, json); return json; })(); worldLand = OSM.landFromTopology(topology); projectWorldLand(); }
    catch (error) { console.warn('The world land layer could not be read:', error); }
  }
  // City names on the map: the places OpenStreetMap lists in the area the map shows (only the big ones when zoomed out), asked for when the view
  // leaves the area already read or its scale changes, and no more often than every couple of seconds.
  function ensureLabels(span, now) {
    if (!scene || scene.source !== 'openstreetmap' || labels.pending || now - labels.at < 2500) return;
    const kinds = OSM.placeKinds(span), half = span * 0.65, corners = [scene.toGeo(plane.x - half, plane.z - half), scene.toGeo(plane.x + half, plane.z + half)];
    const view = { south: Math.min(corners[0].lat, corners[1].lat), north: Math.max(corners[0].lat, corners[1].lat), west: Math.min(corners[0].lon, corners[1].lon), east: Math.max(corners[0].lon, corners[1].lon) };
    const b = labels.box, inside = b && view.south >= b.south && view.north <= b.north && view.west >= b.west && view.east <= b.east;
    if (inside && labels.kinds === kinds) return;
    const box = OSM.labelBox({ south: view.south - (view.north - view.south) * 0.25, north: view.north + (view.north - view.south) * 0.25, west: view.west - (view.east - view.west) * 0.25, east: view.east + (view.east - view.west) * 0.25 });
    labels.pending = true; labels.at = now; const token = loadingToken, home = scene;
    fetchOverpass(OSM.labelsQuery(box, kinds), 30000).then(json => { if (token === loadingToken) { labels.items = OSM.parseLabels(json, home.toLocal); labels.box = box; labels.kinds = kinds; } }).catch(error => console.warn('City names could not be read:', error)).finally(() => { labels.pending = false; });
  }
  function projectWorldLand() { landLocal = scene && worldLand ? OSM.projectLand(worldLand, scene.toLocal, scene.origin) : null; buildFarGround(); }
  // The same land layer drawn on a canvas (north up, 600 km across) becomes the 3D view's far ground: the sea and the coastline are there beyond the
  // detailed scenery, and from high up. The detailed tiles and the airport are drawn over it.
  const FAR_EXTENT = 300000;
  function buildFarGround() {
    if (!renderer) return;
    if (!landLocal) { renderer.setFarGround(null, 0); return; }
    const size = 2048, canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const g = canvas.getContext('2d'), COLORS = OSM.COLORS, css = rgb => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`, k = size / (2 * FAR_EXTENT);
    g.fillStyle = css(COLORS.water); g.fillRect(0, 0, size, size); g.fillStyle = css(COLORS.island); g.beginPath();
    for (const polygon of landLocal) { const [x0, z0, x1, z1] = polygon.box; if (x1 < -FAR_EXTENT || x0 > FAR_EXTENT || z1 < -FAR_EXTENT || z0 > FAR_EXTENT) continue;
      for (const ring of polygon.rings) { let lastX = NaN, lastY = NaN, first = true; for (let i = 0; i < ring.length; i += 2) { const x = (ring[i] + FAR_EXTENT) * k, y = (FAR_EXTENT - ring[i + 1]) * k; if (!first && Math.abs(x - lastX) < 0.5 && Math.abs(y - lastY) < 0.5) continue; if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); lastX = x; lastY = y; } if (!first) g.closePath(); } }
    g.fill('evenodd'); renderer.setFarGround(canvas, FAR_EXTENT);
  }
  function evictTiles() {
    const far = tile => Math.hypot((tile.rect[0] + tile.rect[2]) / 2 - plane.x, (tile.rect[1] + tile.rect[3]) / 2 - plane.z);
    const extra = [...world.tiles.values()].filter(tile => tile !== world.home).sort((a, b) => far(b) - far(a));
    while (extra.length > 30) { const tile = extra.shift(); world.removeTile(tile.key); renderer.removeTile(tile.key); renderer.removeLights(tile.key); }
  }

  // ---- the 2D map in the top right corner ----------------------------------------------------------------------------------
  const mapContext = $('#map').getContext('2d');
  function drawMap() {
    if (!scene || !plane) return;
    const canvas = $('#map'), ratio = Math.min(2, window.devicePixelRatio || 1), size = canvas.clientWidth;
    if (!size) return;
    if (canvas.width !== Math.floor(size * ratio)) { canvas.width = canvas.height = Math.floor(size * ratio); }
    // Automatic scale: the span has to hold about 45 s of travel at the current simulation speed (and the view from this height), so the map
    // zooms out at once when you speed up or climb and back in only after a few seconds, to avoid flicker.
    if (autoMap) {
      const need = Math.max(6000, plane.speed * (scale || 1) * 45 / 0.5, plane.y * 8), wanted = Math.max(0, ZOOMS.findIndex(value => value >= need) < 0 ? ZOOMS.length - 1 : ZOOMS.findIndex(value => value >= need)), nowMs = performance.now();
      if (wanted > zoom) { zoom = wanted; zoomWish = { index: wanted, since: nowMs }; } else if (wanted < zoom) { if (zoomWish.index !== wanted) zoomWish = { index: wanted, since: nowMs }; if (nowMs - zoomWish.since > 3000) zoom = wanted; } else zoomWish = { index: wanted, since: nowMs };
    }
    const c = mapContext, span = ZOOMS[zoom], k = size / span, half = size / 2, coastOnly = span >= COAST_ONLY;
    const px = x => half + (x - plane.x) * k, py = z => half - (z - plane.z) * k;
    const COLORS = OSM.COLORS, css = rgb => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
    c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, size, size);
    c.save(); c.beginPath(); c.rect(0, 0, size, size); c.clip();
    c.fillStyle = css(COLORS.land); c.fillRect(0, 0, size, size);
    const view = [plane.x - span / 2, plane.z - span / 2, plane.x + span / 2, plane.z + span / 2];
    const near = box => box[2] >= view[0] && box[0] <= view[2] && box[3] >= view[1] && box[1] <= view[3];
    const trace = ring => { c.moveTo(px(ring[0][0]), py(ring[0][1])); for (let i = 1; i < ring.length; i++) c.lineTo(px(ring[i][0]), py(ring[i][1])); c.closePath(); };
    const tiles = [...world.tiles.values()].sort((a, b) => (a === world.home) - (b === world.home));
    if (coastOnly && landLocal) {   // far out: sea everywhere, then the land from the world layer (points closer than a pixel are skipped)
      c.fillStyle = css(COLORS.water); c.fillRect(0, 0, size, size); c.fillStyle = css(COLORS.island); c.beginPath();
      for (const polygon of landLocal) if (near(polygon.box)) for (const ring of polygon.rings) {
        let lastX = NaN, lastY = NaN, first = true;
        for (let i = 0; i < ring.length; i += 2) { const x = px(ring[i]), y = py(ring[i + 1]); if (!first && Math.abs(x - lastX) < 0.7 && Math.abs(y - lastY) < 0.7) continue; if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); lastX = x; lastY = y; }
        if (!first) c.closePath();
      }
      c.fill('evenodd');
    }
    for (const tile of coastOnly && landLocal ? [] : tiles) {
      if (tile.water) {
        const [x0, z0, x1, z1] = tile.waterRect || tile.rect; c.fillStyle = css(COLORS.water); c.fillRect(px(x0), py(z1), (x1 - x0) * k, (z1 - z0) * k);
        c.fillStyle = css(COLORS.island); c.beginPath(); for (const land of tile.water.islands) trace(land); c.fill();
      }
      c.fillStyle = css(COLORS.water);
      if (!coastOnly) for (const pond of tile.ponds || []) if (near(pond.box)) { c.beginPath(); trace(pond.ring); c.fill(); c.fillStyle = css(COLORS.island); for (const hole of pond.holes) { c.beginPath(); trace(hole); c.fill(); } c.fillStyle = css(COLORS.water); }
    }
    // Runways and taxiways, then buildings (skipped when zoomed far out), as footprints.
    if (!coastOnly) { c.strokeStyle = css(COLORS.taxiway); c.lineWidth = Math.max(1, 12 * k); c.lineJoin = 'round'; c.beginPath(); for (const t of scene.taxiways) { c.moveTo(px(t[0][0]), py(t[0][1])); for (const q of t.slice(1)) c.lineTo(px(q[0]), py(q[1])); } c.stroke();
    c.strokeStyle = '#2b2d33'; for (const r of scene.place ? [] : [scene.runway, ...scene.otherRunways]) { c.lineWidth = Math.max(2, r.width * k); c.beginPath(); c.moveTo(px(r.points[0][0]), py(r.points[0][1])); for (const q of r.points.slice(1)) c.lineTo(px(q[0]), py(q[1])); c.stroke(); } }   // (taxiways and runways are left out when only the coastline is drawn)
    if (!coastOnly && span <= 20000) { c.fillStyle = 'rgba(105,108,116,0.9)'; for (const tile of tiles) for (const b of tile.buildings) if (near(b.box)) c.fillRect(px(b.box[0]), py(b.box[3]), Math.max(1, (b.box[2] - b.box[0]) * k), Math.max(1, (b.box[3] - b.box[1]) * k)); }
    // City names: the biggest places first, a dot and a name with a light outline, none on top of another or on the ruler and the buttons.
    ensureLabels(span, performance.now());
    { const placed = [], limit = span >= 60000 ? 10 : 14; let drawn = 0; c.textBaseline = 'middle'; c.lineJoin = 'round';
      for (const item of labels.items) {
        if (drawn >= limit) break; const x = px(item.x), y = py(item.z); if (x < 8 || x > size - 8 || y < 22 || y > size - 8) continue;
        if (x > size - 52 && y < 112) continue; if (y > size - 44 && x > size * 0.42) continue;   // keep clear of the zoom buttons and the ruler
        const fontSize = item.rank >= 5 ? 12 : item.rank >= 4 ? 11 : 10; c.font = `${item.rank >= 4 ? 700 : 600} ${fontSize}px ${FONT}`; const width = c.measureText(item.name).width, box = [x + 5, y - fontSize / 2 - 1, x + 5 + width, y + fontSize / 2 + 1];
        if (placed.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue; if (box[2] > size - 6) continue;
        placed.push(box); drawn++; c.fillStyle = '#0b1424'; c.beginPath(); c.arc(x, y, item.rank >= 4 ? 2.6 : 2, 0, Math.PI * 2); c.fill();
        c.textAlign = 'left'; c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.strokeText(item.name, x + 5, y); c.fillStyle = '#0b1424'; c.fillText(item.name, x + 5, y);
      }
      c.textBaseline = 'alphabetic'; }
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
    c.font = `700 11px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#0b1424'; c.fillText('N ↑', 14, 20);
    // The destination of a flight, on the rim of the map when it is off it.
    if (route && route.active && !route.swapped) { const [dx, dz] = scene.toLocal(route.destScene.origin.lat, route.destScene.origin.lon), px0 = (dx - plane.x) * k, pz0 = -(dz - plane.z) * k, d0 = Math.hypot(px0, pz0), back = d0 > half - 12 ? (half - 12) / d0 : 1, x = half + px0 * back, y = half + pz0 * back;
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillStyle = '#ff4f5e'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.fillRect(-5, -5, 10, 10); c.strokeRect(-5, -5, 10, 10); c.restore();
      c.font = `800 10px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#0b1424'; c.shadowColor = '#fff'; c.shadowBlur = 3; c.fillText(route.toCode, Math.max(16, Math.min(size - 16, x)), y > size - 30 ? y - 10 : y + 18); c.shadowBlur = 0; }
    // A ruler-like scale bar: a round length (1, 2 or 5 times a power of ten), five alternating segments with ticks, labelled at both ends.
    { const lengths = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000], metres = [...lengths].reverse().find(v => v * k <= size * 0.5) || lengths[0], width = metres * k, x0 = size - 24 - width, y0 = size - 28;
      const label = v => v >= 1000 ? `${v / 1000} km` : `${v} m`;
      c.save(); c.lineWidth = 1;   // no background: the ruler is drawn straight on the map, with a thin light outline so it stays readable
      for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? '#ffffff' : '#0b1424'; c.fillRect(x0 + width * i / 5, y0, width / 5, 5); }
      c.strokeStyle = '#0b1424'; c.strokeRect(x0, y0, width, 5);
      c.beginPath(); for (let i = 0; i <= 5; i++) { const x = x0 + width * i / 5, tall = i === 0 || i === 5 ? 7 : 4; c.moveTo(x, y0); c.lineTo(x, y0 - tall); } c.stroke();
      c.fillStyle = '#0b1424'; c.shadowColor = 'rgba(255,255,255,0.9)'; c.shadowBlur = 3; c.font = `700 10px ${FONT}`; c.textAlign = 'left'; c.fillText('0', x0 - 2, y0 + 16); c.textAlign = 'right'; c.fillText(label(metres), x0 + width + 2, y0 + 16); c.restore(); }
    if (streaming.pending.size && !coastOnly) { c.textAlign = 'left'; c.fillText('Loading map…', 14, size - 14); }
  }


  // ---- approach assist -------------------------------------------------------------------------------------------------------------
  // Near an airport, for the Cessna and the Airbus: the phase of the approach with the flaps, speed and throttle that go with it, shown
  // as text, and optionally applied automatically (auto throttle holds the target speed, auto flaps steps to the suggested setting).
  // Pressing the throttle or flap controls yourself pauses the automatic part for a few seconds. Away from airports it is hidden.
  const manualAt = { throttle: -1e9, flaps: -1e9, gear: -1e9 }, assist = { thr: false, flaps: false, at: 0, flapStep: 0, advice: null };
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
    // The panel is there whenever you are flying: the autopilot checkbox always, the approach advice and the throttle and flap automation
    // only near an airport (and for the Cessna and the Airbus).
    const showing = state === 'flying'; if (panel.hidden === showing) panel.hidden = !showing;
    { const g = plane.gear ?? 1, button = $('#gear'); button.textContent = g >= 0.98 ? 'Down' : g <= 0.02 ? 'Up' : (plane.gearDown === false ? 'Retracting' : 'Extending'); button.setAttribute('aria-pressed', String(plane.gearDown !== false)); }
    $('#assistAdvice').hidden = !advice; $('#assistAuto').hidden = !advice; $('#assistTitle').textContent = advice ? 'Approach assist' : 'Assist';
    if (!advice) { $('#assistPhase').textContent = ''; return; }
    const kt = plane.speed * 1.943844, flapText = FLAP_TEXT[flightMode];
    if (!plane.onGround) {
      if (assist.thr && now - manualAt.throttle > 4000) {
        const target = Math.max(0, Math.min(1, advice.throttle + 0.012 * (advice.kt - kt))), next = plane.throttle + Math.max(-0.25 * dt, Math.min(0.25 * dt, target - plane.throttle));
        if (Math.abs(next - plane.throttle) > 1e-4) { plane.throttle = next; syncThrottle(); }
      }
      if (assist.flaps && advice.gear != null && now - manualAt.gear > 6000 && (plane.gearDown !== false) !== advice.gear) setGear(advice.gear, false);
      if (assist.flaps && now - manualAt.flaps > 6000 && (plane.flaps || 0) !== advice.flaps && now - assist.flapStep > 1500) { setFlaps((plane.flaps || 0) + Math.sign(advice.flaps - (plane.flaps || 0))); assist.flapStep = now; }
    }
    if (now - assist.at < 250) return; assist.at = now;
    $('#assistPhase').textContent = advice.phase.toUpperCase();
    const row = (label, text, good) => `<div><dt>${label}</dt><dd class="${good ? 'ok' : 'warn'}">${text}</dd></div>`, percent = value => `${Math.round(value * 100)}%`;
    $('#assistRows').innerHTML = row('Throttle', `suggest ${percent(advice.throttle)} · now ${percent(plane.throttle)}`, Math.abs(advice.throttle - plane.throttle) <= 0.06)
      + row('Flaps', `suggest ${flapText[advice.flaps]} · now ${flapText[plane.flaps || 0]}`, (plane.flaps || 0) === advice.flaps)
      + (advice.gear == null ? '' : row('Gear', `suggest ${advice.gear ? 'DOWN' : 'UP'} · now ${plane.gear >= 0.98 ? 'DOWN' : plane.gear <= 0.02 ? 'UP' : 'MOVING'}`, (plane.gearDown !== false) === advice.gear))
      + (advice.kt ? row('Speed', `target ${advice.kt} kt · now ${Math.round(kt)} kt`, Math.abs(kt - advice.kt) <= 8) : '');
    $('#assistNote').textContent = advice.note || (advice.glide < 0 ? `Hold about a ${-advice.glide}° descent with the stick; the throttle shown keeps the target speed.` : 'Level flight: hold the target speed with the stick.');
  }

  // ---- start up ---------------------------------------------------------------------------------------------------------------
  // An airport that does not exist (or cannot be looked up) leads to the default, Hong Kong International, with a message.
  // What the two boxes show: the From airport (empty when there is no flight) and the To airport.
  function showCodes() { $('#fromAirport').value = route ? route.fromCode : ''; $('#airport').value = shownAs(route ? route.toCode : scene.code); }
  // A flight from the airport that is open to `destScene`: the plan (cruise altitude, where the descent starts, where to swap scenes).
  function startRoute(info) {
    const [dx, dz] = scene.toLocal(info.destScene.origin.lat, info.destScene.origin.lon), distance = Math.hypot(dx, dz), kind = flightMode === 'airbus' ? 'airbus' : 'plane';
    route = { ...info, fromCode: scene.code, active: true, swapped: false, departed: false, phase: 'TAKEOFF', km: distance / 1000, distance, plan: P.routePlan(kind, distance, info.destScene.glide || 3) };
  }
  // Read the destination quietly, then open the From airport and take off from it; with no From (or a drone) it is just the airport.
  async function openFlight(toCode, fromCode, typed = null) {
    route = null;
    // A code that is not found is searched as a name ("Nice" is not a code): the box that was typed in decides which side.
    const notFound = which => typed && typed.which === which ? () => searchByName(typed.text, which) : undefined;
    if (!fromCode || fromCode === toCode || flightMode === 'drone') { await openAirport(toCode, { notFound: notFound('to') }); return; }
    state = 'loading'; $('#loading').hidden = false; progress(`Reading the destination: ${OSM.AIRPORTS[toCode] ? OSM.AIRPORTS[toCode].label : toCode}…`, 0.05);
    const dest = await loadScene(toCode);
    if (dest.kind === 'not-found' && notFound('to')) { notFound('to')(); return; }
    if (dest.error || dest.scene.place) { toast(`${dest.error || 'A place has no runway to land on.'} Flying without a destination.`); await openAirport(fromCode); return; }
    await openAirport(fromCode, { route: { toCode, destScene: dest.scene }, notFound: notFound('from') });
  }
  async function goToFallback(reason) { toast(`${String(reason || '').replace(/\s+$/, '')} Showing Hong Kong International (${OSM.FALLBACK_AIRPORT}) instead.`); $('#results').hidden = true; await openAirport(OSM.FALLBACK_AIRPORT); }
  // Put a loaded airport scene in place: the map, the lights and the world. Used when an airport is opened and when a flight swaps to its destination.
  function applyScene(loaded, note) {
    scene = loaded;
    world = OSM.createWorld(scene);
    const mesh = OSM.meshParts(scene); renderer.clearTiles(); renderer.setScene(mesh.ground, mesh.solid, mesh.base);
    renderer.clearLights(); scene.lightData = OSM.buildLights(scene); renderer.setLights('home', scene.lightData.data); notice = note ?? notice; others = []; streaming.pending.clear(); streaming.failed.clear(); labels.items = []; labels.box = null; projectWorldLand();
    window.flightState = () => ({ world, sceneObject: scene, scene: { source: scene.source, code: scene.code, buildings: scene.buildings.length, mode: flightMode, assist: assist.advice, route: route && { from: route.fromCode, to: route.toCode, phase: route.phase, km: route.km, swapped: route.swapped }, airport: scene.airport, tiles: world.tiles.size, land: landLocal ? landLocal.length : 0, mapSpan: ZOOMS[zoom], loading: streaming.pending.size, runway: { ref: scene.runway.ref, headingDegrees: scene.runway.heading * 180 / Math.PI, length: scene.runway.length } }, plane, others, state });
    showCodes(); $('#airport').title = scene.place ? `${scene.label}: a place to look around. Type an airport code or name and press Enter` : `${scene.airport.name} (${scene.airport.icao}${scene.airport.iata ? ' / ' + scene.airport.iata : ''}): type another code and press Enter`;
    try { localStorage.setItem('flight-airport', scene.code); } catch { /* optional */ }
  }

  async function openAirport(code, options = {}) {
    const token = ++loadingToken;
    const before = state; state = 'loading'; $('#loading').hidden = false; $('#crash').hidden = true; $('#airport').value = shownAs(code); progress(`Reading OpenStreetMap: ${OSM.AIRPORTS[code] ? OSM.AIRPORTS[code].label : code}…`, 0.05);
    const { scene: loaded, note, error, kind } = await loadScene(code);
    if (token !== loadingToken) return;
    if (error) {   // an unknown code: stay where we were
      if (!scene) { goToFallback(error); return; }   // nothing is loaded yet (a bad address or saved code): never leave a blank game
      if (!(kind === 'not-found' && options.notFound)) toast(error); $('#loading').hidden = true;
      state = before === 'loading' ? 'flying' : before; $('#airport').value = shownAs(scene.code); focusView();
      if (kind === 'not-found' && options.notFound) options.notFound();
      return;
    }
    progress('Building the 3D scene…', 0.8); await nextFrame();
    applyScene(loaded, note);
    // A flight from one airport to another: work out the route, and the autopilot takes off.
    route = null; if (options.route) { if (scene.place) toast('A place has no runway to take off from; flying without a destination.'); else startRoute(options.route); }
    showCodes();
    renderHelp(); if (flightMode === 'jet') setCamera('cockpit'); respawn(true); $('#loading').hidden = true; $('#reset').disabled = socket?.readyState !== WebSocket.OPEN; focusView();
  }
  async function start() {
    connect();
    try { renderer = new R.Renderer($('#view')); } catch (error) { progress(`${error.message} The flight simulator needs WebGL.`, 0); return; }
    requestAnimationFrame(frame);
    { let saved = null; try { saved = localStorage.getItem('flight-night'); } catch { /* optional */ } setNight(new URLSearchParams(location.search).get('night') === '1' || saved === '1'); }
    { const from = OSM.resolveCode(new URLSearchParams(location.search).get('from')); await openFlight(preferred(), from || ''); }
  }
  start();
})();
