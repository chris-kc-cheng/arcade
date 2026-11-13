(() => {
  // One shared shell for the React entry points and the dependency-free game clients: the toolbar, the room picker,
  // presence, the optional shared login, the app switcher and the protocol debugger.
  const games = [['/','board','Drawing board'],['/tank','tank','Tank'],['/penalty','ball','Penalty shootout'],['/fighter','bolt','Line Fighter'],['/snake','snake','Snake'],['/bigtwo','cards','Big-D'],['/typing','keyboard','Type/Off'],['/wordle','letter','Many Words'],['/poll','poll','Quick Poll'],['/cube','cube','Cube Lab'],['/slushy','cup','Slush Rush'],['/typohunt','search','Typo Hunt'],['/twinspot','twin','Twin Spot'],['/flight','plane','Flight Sim']];
  const rooms = {board:'doodle',tank:'tanks',penalty:'penalty',fighter:'fighter',snake:'snake',bigtwo:'bigtwo',typing:'typing',wordle:'wordle',poll:'poll',cube:'cube',slushy:'slushy',typohunt:'typohunt',twinspot:'twinspot',flight:'flight'};
  // Line icons on a 24 px grid: 2 px stroke, round caps and joins, drawn in currentColor. Decorative: every button has its own label.
  const ICON_PATHS = {
    board:'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
    tank:'M3 14h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM7 14v-3h10v3M12 11V6h6',
    ball:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8l3.5 2.5-1.3 4.1H9.8L8.5 10.5ZM12 8V3M15.5 10.5 20 9M14.2 14.6l2.8 3.6M9.8 14.6 7 18.2M8.5 10.5 4 9',
    bolt:'M13 2 4 14h7l-1 8 9-12h-7Z',
    snake:'M17 5H9a3.5 3.5 0 0 0 0 7h6a3.5 3.5 0 0 1 0 7H7',
    cards:'M7 3h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM12 9.5c-1-1.6-3.5-.6-3.5 1.2 0 1.8 3.5 3.8 3.5 3.8s3.5-2 3.5-3.8c0-1.8-2.5-2.8-3.5-1.2Z',
    keyboard:'M3 7h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM6 11h.01M10 11h.01M14 11h.01M18 11h.01M7 15h10',
    letter:'M4 7V4h16v3M9 20h6M12 4v16',
    poll:'M5 21V11M12 21V4M19 21v-7',
    cube:'M12 2 3 7v10l9 5 9-5V7ZM3 7l9 5 9-5M12 12v10',
    cup:'M6 7h12l-1.5 13a1 1 0 0 1-1 .9h-7a1 1 0 0 1-1-.9ZM5 7h14M13 7l2-4h3',
    search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
    plane:'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.2.2c-.3.4-.2.9.2 1.2L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.2.2l.2-.1c.3-.3.5-.7.4-1.2Z',
    twin:'M9 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM15 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    door:'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14 12h.01',
    user:'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    login:'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
    logout:'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    chevron:'m6 9 6 6 6-6',
    close:'M18 6 6 18M6 6l12 12',
    check:'M20 6 9 17l-5-5',
    terminal:'M4 17l6-6-6-6M12 19h8',
    plus:'M12 5v14M5 12h14'
  };
  const DOTS = {
    apps:[[5,5],[12,5],[19,5],[5,12],[12,12],[19,12],[5,19],[12,19],[19,19]]
  };
  const icon = name => {
    const dots = DOTS[name] ? DOTS[name].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1"/>`).join('') : '';
    const path = ICON_PATHS[name] ? `<path d="${ICON_PATHS[name]}"/>` : '';
    return `<svg class="arcade-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}${dots}</svg>`;
  };
  // The Arcade logo: the gecko mascot (the same artwork as the favicon and app icons).
  const MARK = '<img class="arcade-mark" src="/icons/gecko-256.png" alt="" width="32" height="32">';
  const NativeWebSocket = window.WebSocket, logs = [], pageSockets = new Set();
  const totals = { SENT: { messages: 0, bytes: 0 }, RECEIVED: { messages: 0, bytes: 0 } };
  let directory = [], selectedRoom = sessionStorage.getItem('arcade-room') || '', roomError = '';
  let currentSocket, currentHeader, players = [], online = false, connectionLabel = 'Connecting', debugPanel, logList, stats;
  const sso = window.ArcadeSso;
  // Optional login state. `account` is null for anonymous play (also while the auth service is unknown, slow or down).
  let account = null, authNotice = '';
  let platformApps = [], appsRequested = false;
  const display = data => { if (typeof data !== 'string') return `[binary data: ${data?.byteLength ?? data?.size ?? 'unknown'} bytes]`; try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; } };
  const byteSize = data => typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data?.byteLength ?? data?.size ?? 0;
  const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const elapsed = since => { const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`; };
  const isInteractiveTarget = target => Boolean(target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],.arcade-topbar,.arcade-debug-panel'));
  const safeStorage = {
    get(key) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } },
    set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* private mode: the name just is not remembered */ } },
    remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } }
  };
  function send(message) {
    if (currentSocket?.readyState !== NativeWebSocket.OPEN) return false;
    currentSocket.send(JSON.stringify(message)); return true;
  }
  function updateStats() {
    if (!stats) return;
    for (const direction of ['SENT', 'RECEIVED']) {
      stats.querySelector(`[data-${direction.toLowerCase()}-messages]`).textContent = totals[direction].messages.toLocaleString();
      stats.querySelector(`[data-${direction.toLowerCase()}-bytes]`).textContent = formatBytes(totals[direction].bytes);
    }
  }
  function renderEntry(entry) {
    const row = document.createElement('article'), heading = document.createElement('div'), label = document.createElement('strong'), time = document.createElement('time'), payload = document.createElement('pre');
    row.className = `arcade-debug-entry ${entry.direction.toLowerCase()}`; label.textContent = entry.direction; time.textContent = entry.at.toLocaleTimeString(); payload.textContent = entry.data;
    heading.append(label, time); row.append(heading, payload); logList.append(row);
    while (logList.children.length > 250) logList.firstElementChild.remove();
    logList.scrollTop = logList.scrollHeight;
  }
  function record(direction, data, url) {
    const entry = { direction, data: display(data), url, at: new Date() };
    totals[direction].messages++; totals[direction].bytes += byteSize(data);
    logs.push(entry); if (logs.length > 250) logs.shift();
    if (debugPanel && !debugPanel.hidden) { updateStats(); renderEntry(entry); }
  }
  class DebugWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      const address = new URL(String(url));
      if (selectedRoom) address.searchParams.set('arcade', selectedRoom);
      address.searchParams.set('game', location.pathname);
      super(address.toString(), protocols); this.arcadeDebugUrl = address.toString();
      pageSockets.add(this);
      currentSocket = this; online = false; connectionLabel = 'Connecting'; players = []; currentHeader?.render();
      this.addEventListener('open', () => { if (currentSocket === this) { online = true; connectionLabel = 'Live'; currentHeader?.render(); } });
      this.addEventListener('close', () => { pageSockets.delete(this); if (currentSocket === this) { online = false; connectionLabel = 'Offline'; players = []; currentHeader?.render(); } });
      this.addEventListener('message', event => {
        record('RECEIVED', event.data, this.arcadeDebugUrl);
        if (currentSocket !== this) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'arcadeRooms') {
          directory = Array.isArray(message.rooms) ? message.rooms : [];
          selectedRoom = message.currentRoom || '';
          sessionStorage.setItem('arcade-room', selectedRoom);
          currentHeader?.render();
        }
        if (message.type === 'roomJoined' && typeof message.id === 'string' && games.some(([path]) => path === message.path)) {
          sessionStorage.setItem('arcade-room', message.id);
          if (location.pathname === message.path) location.reload(); else location.assign(message.path);
        }
        if (message.type === 'roomError') { roomError = message.message; currentHeader?.render(); }
        if (message.type === 'platformPresence') { players = Array.isArray(message.players) ? message.players : []; currentHeader?.render(); }
      });
    }
    send(data) { super.send(data); record('SENT', data, this.arcadeDebugUrl); }
  }
  window.WebSocket = DebugWebSocket;
  // Close connections before a page enters the browser's back/forward cache.
  // Otherwise an invisible old page can keep its previous room occupied.
  window.addEventListener('pagehide', () => { for (const socket of pageSockets) socket.close(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  function createDebugger() {
    if (debugPanel) return;
    debugPanel = document.createElement('aside'); debugPanel.id = 'arcade-debug-panel'; debugPanel.className = 'arcade-debug-panel'; debugPanel.hidden = true; debugPanel.setAttribute('aria-label', 'WebSocket debug log');
    debugPanel.innerHTML = `<div class="arcade-debug-heading"><div><small>LIVE PROTOCOL</small><strong>SERVER DEBUG</strong></div><div class="arcade-debug-actions"><button type="button" class="arcade-debug-clear">CLEAR</button><button type="button" class="arcade-debug-close" aria-label="Close debug panel" title="Close debug panel">${icon('close')}</button></div></div><dl class="arcade-debug-stats" aria-label="WebSocket traffic statistics"><div><dt>RECEIVED</dt><dd><strong data-received-messages>0</strong> messages<br><span data-received-bytes>0 B</span></dd></div><div><dt>SENT</dt><dd><strong data-sent-messages>0</strong> messages<br><span data-sent-bytes>0 B</span></dd></div></dl><div class="arcade-debug-list" tabindex="0" aria-label="Recent protocol messages"></div>`;
    document.body.append(debugPanel); logList = debugPanel.querySelector('.arcade-debug-list'); stats = debugPanel.querySelector('.arcade-debug-stats');
    debugPanel.querySelector('.arcade-debug-clear').onclick = () => { logs.length = 0; totals.SENT.messages = totals.SENT.bytes = totals.RECEIVED.messages = totals.RECEIVED.bytes = 0; logList.replaceChildren(); updateStats(); };
    debugPanel.querySelector('.arcade-debug-close').onclick = () => setDebugOpen(false);
  }
  function setDebugOpen(open, restoreFocus = true) {
    if (!debugPanel || !currentHeader) return;
    debugPanel.hidden = !open;
    const toggle = currentHeader.element.querySelector('.arcade-debug-toggle');
    toggle.classList.toggle('active', open); toggle.setAttribute('aria-expanded', String(open));
    if (open) { currentHeader.closeMenus(); updateStats(); logList.replaceChildren(); logs.forEach(renderEntry); debugPanel.querySelector('.arcade-debug-close').focus(); }
    else if (restoreFocus) currentHeader.element.querySelector('.arcade-rooms-toggle').focus();
  }

  // --- Optional shared login --------------------------------------------------------------------------------------------
  const storedName = () => ({ name: safeStorage.get('arcade-name'), source: safeStorage.get('arcade-name-source') });
  // Put the right player name into the session: a name the person typed wins; otherwise the signed-in account supplies it.
  // Games read `arcade-name` when their socket opens; a game that is already connected gets it through setName.
  function syncPlayerName() {
    const before = safeStorage.get('arcade-name');
    const next = sso ? sso.resolvePlayerName({ stored: storedName(), user: account }) : { name: before, source: before ? 'manual' : '' };
    if (next.name) { safeStorage.set('arcade-name', next.name); safeStorage.set('arcade-name-source', next.source); }
    else { safeStorage.remove('arcade-name'); safeStorage.remove('arcade-name-source'); }
    if (next.name !== before) send({ type: 'setName', name: next.name });
    currentHeader?.render();
  }
  function setAccount(user) { account = user && typeof user === 'object' ? user : null; syncPlayerName(); }
  const authClient = sso ? sso.createSso({ base: window.ARCADE_SSO_BASE || sso.DEFAULT_BASE }) : null;
  function startAuth() {
    if (!authClient) return;
    const found = sso.takeAuthError(location.href);
    if (found.cleanUrl !== null) { authNotice = found.message; try { history.replaceState(null, '', found.cleanUrl); } catch { /* ignore */ } }
    // Never awaited by a game: the toolbar upgrades itself when (and if) the answer arrives.
    authClient.me().then(user => {
      setAccount(user);
      if (!user && authNotice) currentHeader?.openLogin(authNotice);
      authNotice = '';
    }, () => { authNotice = ''; });
  }
  async function loadPlatformApps() {
    if (appsRequested) return; appsRequested = true;
    try {
      const response = await fetch('/api/platform-apps', { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const list = await response.json();
      platformApps = (Array.isArray(list) ? list : []).filter(app => app && typeof app.name === 'string' && /^https:\/\//.test(app.url || ''));
    } catch { platformApps = []; }
    currentHeader?.render();
  }

  // --- Toolbar -----------------------------------------------------------------------------------------------------------
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const focusables = panel => [...panel.querySelectorAll('a[href],button,input')].filter(node => !node.disabled && !node.closest('[hidden]'));
  function mount(element, options = {}) {
    if (currentHeader?.element === element) { currentHeader.update(options); return currentHeader; }
    currentHeader?.destroy();
    const config = {...options}, existingReset = element.querySelector('#reset, #resetButton');
    element.className = 'arcade-topbar'; element.dataset.arcadeGame = config.game;
    element.setAttribute('aria-label', 'Arcade navigation and shared controls');
    element.innerHTML = `<div class="arcade-start"><a class="arcade-home" href="/" aria-label="Arcade home" title="Arcade home">${MARK}</a><div class="arcade-menu arcade-games"><button type="button" class="arcade-btn arcade-games-toggle" aria-haspopup="true" aria-expanded="false" aria-controls="arcade-games-menu"><span class="arcade-title"></span>${icon('chevron')}</button><nav id="arcade-games-menu" class="arcade-panel arcade-nav" aria-label="Arcade games" hidden></nav></div><span class="arcade-connection" role="status"><i></i><span class="arcade-connection-text">Connecting</span></span></div><div class="arcade-end"><div class="arcade-presence"><button type="button" class="arcade-btn arcade-presence-toggle" aria-expanded="false" aria-controls="arcade-player-details">${icon('users')}<strong>0</strong><span class="arcade-room-count">0 here</span></button><div id="arcade-player-details" class="arcade-panel arcade-player-details" role="region" aria-label="Connected player details" tabindex="0" hidden><div>No active players</div></div></div><div class="arcade-menu arcade-rooms"><button type="button" class="arcade-btn arcade-rooms-toggle" aria-haspopup="true" aria-expanded="false" aria-controls="arcade-room-menu">${icon('door')}<span class="arcade-current-room">Connecting</span></button><div id="arcade-room-menu" class="arcade-panel arcade-room-menu" role="group" aria-label="Room and player" hidden><form class="arcade-name" aria-label="Player name"><label for="arcade-name-input">Player name</label><div class="arcade-name-row"><input id="arcade-name-input" maxlength="24" autocomplete="nickname" placeholder="Your name"><button type="submit" class="arcade-btn arcade-name-save" aria-label="Save player name" title="Save player name">${icon('check')}</button></div><p class="arcade-hint"></p></form><h2 class="arcade-panel-title">Rooms</h2><p class="arcade-hint">Game changes stay in your room.</p><div class="arcade-room-list"></div><button type="button" class="arcade-btn arcade-wide arcade-create-room">${icon('plus')}<span>New room</span></button><p class="arcade-room-error" role="status"></p><button type="button" class="arcade-btn arcade-wide arcade-debug-toggle" aria-expanded="false" aria-controls="arcade-debug-panel">${icon('terminal')}<span>Protocol log</span></button></div></div><div class="arcade-menu arcade-account"><button type="button" class="arcade-btn arcade-account-toggle"></button><div id="arcade-account-menu" class="arcade-panel arcade-account-menu" role="group" aria-label="Account" hidden></div></div><div class="arcade-menu arcade-apps" hidden><button type="button" class="arcade-btn arcade-apps-toggle" aria-label="Switch app" title="Other apps" aria-haspopup="true" aria-expanded="false" aria-controls="arcade-apps-menu">${icon('apps')}</button><nav id="arcade-apps-menu" class="arcade-panel arcade-apps-menu" aria-label="Other apps" hidden></nav></div></div>`;
    const q = selector => element.querySelector(selector);
    const nav = q('.arcade-nav'), end = q('.arcade-end'), titleNode = q('.arcade-title'), gamesToggle = q('.arcade-games-toggle');
    let currentTitle = 'Arcade';
    games.forEach(([path, glyph, label]) => {
      const link = document.createElement('a'); link.href = path; link.setAttribute('aria-label', label); link.innerHTML = `${icon(glyph)}<span>${label}</span>`;
      const selected = path === (config.game === 'board' ? '/' : `/${config.game}`);
      if (selected) { link.className = 'active'; link.setAttribute('aria-current', 'page'); currentTitle = label; }
      link.onclick = event => { event.preventDefault(); const name = directory.find(room => room.id === selectedRoom)?.name || 'this room'; menus.closeAll(); if (online && confirm(`Switch everyone in ${name} to ${label}?`)) send({type:'switchGame',path}); };
      nav.append(link);
    });
    titleNode.textContent = currentTitle; titleNode.title = currentTitle;
    gamesToggle.setAttribute('aria-label', `Games. Current game: ${currentTitle}`); gamesToggle.title = 'Choose a game';

    // The reset control stays where the legacy markup put it (it keeps its original handler); it only moves into the toolbar.
    const reset = existingReset || document.createElement('button'); reset.type = 'button'; reset.className = 'arcade-btn arcade-reset'; reset.hidden = false;
    if (!existingReset) { reset.textContent = 'RESET'; reset.disabled = true; reset.onclick = () => config.onReset?.(); }
    end.insertBefore(reset, q('.arcade-rooms'));

    // --- menus: one open at a time, Escape and outside clicks close, focus goes in and comes back ---
    const registry = [];
    const menus = {
      add(toggle, panel, { focusFirst = true, onOpen } = {}) { registry.push({ toggle, panel, focusFirst, onOpen }); toggle.onclick = () => (panel.hidden ? menus.open(toggle) : menus.close(toggle, true)); },
      open(toggle) {
        menus.closeAll();
        const entry = registry.find(item => item.toggle === toggle); if (!entry) return;
        entry.onOpen?.(); entry.panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
        if (entry.focusFirst) focusables(entry.panel)[0]?.focus();
      },
      close(toggle, restoreFocus = false) {
        const entry = registry.find(item => item.toggle === toggle); if (!entry || entry.panel.hidden) return;
        entry.panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); if (restoreFocus) toggle.focus();
      },
      closeAll(restoreFocus = false) { for (const { toggle } of registry) { const wasOpen = toggle.getAttribute('aria-expanded') === 'true'; menus.close(toggle, restoreFocus && wasOpen); } },
      openOne: () => registry.find(({ panel }) => !panel.hidden)
    };
    const gamesMenu = q('.arcade-games'), roomsMenu = q('.arcade-rooms'), appsMenu = q('.arcade-apps'), accountMenu = q('.arcade-account');
    const roomsToggle = q('.arcade-rooms-toggle'), accountToggle = q('.arcade-account-toggle'), accountPanel = q('#arcade-account-menu');
    menus.add(gamesToggle, nav); menus.add(roomsToggle, q('#arcade-room-menu'), { focusFirst: false, onOpen: () => { renderRooms(); } });
    const appsToggle = q('.arcade-apps-toggle'), appsPanel = q('.arcade-apps-menu');
    menus.add(appsToggle, appsPanel);
    menus.add(accountToggle, accountPanel);
    // Arrow keys move through a menu's items, like a native menu.
    for (const menu of [gamesMenu, appsMenu, accountMenu, roomsMenu]) menu.onkeydown = event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target?.tagName === 'INPUT') return;
      const items = focusables(menu.querySelector('.arcade-panel')); if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next].focus();
    };
    // Leaving a menu with Tab closes it, so a stale panel never covers the page.
    for (const menu of [gamesMenu, appsMenu, accountMenu, roomsMenu]) menu.onfocusout = event => { if (event.relatedTarget && !menu.contains(event.relatedTarget)) menus.closeAll(); };

    // --- player name: typed names win; a signed-in account fills it in ---
    const nameForm = q('.arcade-name'), nameInput = nameForm.querySelector('input'), nameHint = nameForm.querySelector('.arcade-hint');
    nameForm.onsubmit = event => {
      event.preventDefault(); const name = (sso ? sso.cleanName(nameInput.value) : nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 24));
      if (!name) { nameInput.value = safeStorage.get('arcade-name'); return; }
      safeStorage.set('arcade-name', name); safeStorage.set('arcade-name-source', 'manual'); nameInput.value = name; send({type:'setName',name}); render();
    };
    q('.arcade-create-room').onclick = () => { roomError = ''; send({type:'createRoom'}); };
    const roomList = q('.arcade-room-list'), createRoom = q('.arcade-create-room');
    function renderRooms() {
      const current = directory.find(room => room.id === selectedRoom);
      q('.arcade-current-room').textContent = current?.name || connectionLabel;
      roomsToggle.setAttribute('aria-label', `Room and player. Current room: ${current?.name || connectionLabel}`); roomsToggle.title = current?.name ? `Room: ${current.name}` : 'Room and player';
      createRoom.disabled = !online;
      q('.arcade-room-error').textContent = roomError;
      roomList.replaceChildren(...directory.map(room => {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'arcade-room-option'; button.disabled = !online || room.id === selectedRoom;
        if (room.id === selectedRoom) button.setAttribute('aria-current','true');
        const name = document.createElement('strong'), detail = document.createElement('span');
        name.textContent = room.name;
        const game = games.find(([path]) => path === room.path)?.[2] || 'Arcade';
        detail.textContent = `${game} · ${room.players} player${room.players === 1 ? '' : 's'}${room.id === selectedRoom ? ' · you are here' : ' · join'}`;
        button.append(name,detail); button.onclick = () => { roomError = ''; send({type:'joinRoom',id:room.id}); };
        return button;
      }));
    }

    // --- presence: the count always shows; hover, focus or a click reveals who is here ---
    const presence = q('.arcade-presence'), presenceToggle = q('.arcade-presence-toggle'), details = q('.arcade-player-details');
    let pinned = false, hovering = false;
    function showPresence(open) { details.hidden = !open; presenceToggle.setAttribute('aria-expanded', String(open)); if (open) renderPresence(); }
    presenceToggle.onclick = () => { pinned = !pinned; if (pinned) menus.closeAll(); showPresence(pinned); };
    presence.onmouseenter = () => { hovering = true; showPresence(true); };
    presence.onmouseleave = () => { hovering = false; showPresence(pinned || presence.contains(document.activeElement)); };
    presence.onfocusin = () => showPresence(true);
    presence.onfocusout = event => { if (!presence.contains(event.relatedTarget)) { pinned = false; showPresence(hovering); } };
    function renderPresence() {
      const roomPlayers = players.filter(player => player.room === rooms[config.game]), count = online ? config.roomCount ?? roomPlayers.length : 0;
      presenceToggle.querySelector('strong').textContent = players.length;
      const roomCount = presenceToggle.querySelector('.arcade-room-count'); roomCount.textContent = `${count} here`; roomCount.hidden = count === players.length;
      presenceToggle.setAttribute('aria-label', `${players.length} active players in this arcade room, ${count} connected to this room. Show player details`);
      presenceToggle.title = `${players.length} active players, ${count} here`;
      details.replaceChildren(...(players.length ? players.map(player => {
        const row = document.createElement('div'), name = document.createElement('b'), info = document.createElement('span');
        name.textContent = player.name; info.textContent = `${player.ip} · ${player.arcadeRoom ? `${player.arcadeRoom} / ` : ''}${player.room} · connected ${elapsed(player.connectedAt)} ago`; row.append(name, info); return row;
      }) : [Object.assign(document.createElement('div'), {textContent:'No active players'})]));
    }

    // --- app switcher: only when the server could read the platform registry ---
    function renderApps() {
      const usable = platformApps; appsMenu.hidden = usable.length === 0;
      if (!usable.length) { menus.close(appsToggle); appsPanel.replaceChildren(); return; }
      if (appsPanel.dataset.count === String(usable.length) && appsPanel.children.length === usable.length) return;
      appsPanel.dataset.count = String(usable.length);
      appsPanel.replaceChildren(...usable.map(app => {
        const link = document.createElement('a'), label = document.createElement('span'), hint = document.createElement('span');
        link.className = 'arcade-app-tile'; link.href = app.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        label.textContent = app.name; hint.className = 'arcade-sr-only'; hint.textContent = ' (opens in a new tab)'; label.append(hint);
        const letter = () => { const node = el('span', 'arcade-app-letter', app.name.slice(0, 1).toUpperCase()); node.setAttribute('aria-hidden', 'true'); return node; };
        let art = letter();
        if (/^https:\/\//.test(app.icon || '')) { art = document.createElement('img'); art.src = app.icon; art.alt = ''; art.width = 48; art.height = 48; art.onerror = () => art.replaceWith(letter()); }
        link.append(art, label); link.onclick = () => menus.closeAll();
        return link;
      }));
    }

    // --- account: a quiet Log in button; once signed in, the person's name ---
    function renderAccount() {
      const fullName = account && (sso?.accountName(account) || 'Account'), name = account && (fullName.split(' ')[0] || fullName);
      if (!sso) { accountMenu.hidden = true; return; }
      accountMenu.hidden = false;
      if (!account) {
        menus.close(accountToggle);
        accountToggle.innerHTML = `${icon('login')}<span class="arcade-account-label">Log in</span>`;
        accountToggle.setAttribute('aria-label', 'Log in'); accountToggle.title = 'Log in with your platform account (optional)'; accountToggle.setAttribute('aria-haspopup', 'dialog'); accountToggle.removeAttribute('aria-expanded'); accountToggle.removeAttribute('aria-controls');
        accountToggle.onclick = () => openLogin();
        return;
      }
      accountToggle.innerHTML = `${icon('user')}<span class="arcade-account-label"></span>`; accountToggle.querySelector('.arcade-account-label').textContent = name;
      accountToggle.setAttribute('aria-label', `Account: ${fullName}`); accountToggle.title = `Signed in as ${fullName}`; accountToggle.setAttribute('aria-haspopup', 'true'); accountToggle.setAttribute('aria-controls', 'arcade-account-menu');
      if (!accountToggle.hasAttribute('aria-expanded')) accountToggle.setAttribute('aria-expanded', String(!accountPanel.hidden));
      accountToggle.onclick = () => (accountPanel.hidden ? menus.open(accountToggle) : menus.close(accountToggle, true));
      const who = el('p', 'arcade-account-name', fullName), mail = el('p', 'arcade-hint', typeof account.email === 'string' ? account.email : ''), out = document.createElement('button');
      out.type = 'button'; out.className = 'arcade-btn arcade-wide arcade-logout'; out.innerHTML = `${icon('logout')}<span>Log out</span>`;
      out.onclick = async () => { menus.closeAll(); try { await authClient.logout(); } catch { /* the cookie may already be gone */ } setAccount(null); accountToggle.focus(); };
      accountPanel.replaceChildren(el('p', 'arcade-hint', 'Signed in as'), who, mail, out);
    }

    // --- login dialog: modal, focus trapped, Escape closes ---
    let dialog = null, opener = null, mode = 'login';
    function closeLogin(restore = true) {
      if (!dialog) return; dialog.layer.hidden = true;
      if (restore) (opener?.isConnected ? opener : accountToggle).focus?.();
    }
    function openLogin(notice = '') {
      if (!authClient) return;
      menus.closeAll(); opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : accountToggle;
      if (!dialog) dialog = buildDialog();
      mode = 'login'; dialog.show(notice);
    }
    function buildDialog() {
      const layer = el('div', 'arcade-modal'); layer.hidden = true;
      layer.innerHTML = `<div class="arcade-dialog" role="dialog" aria-modal="true" aria-labelledby="arcade-login-title"><div class="arcade-dialog-head"><h2 id="arcade-login-title">Log in</h2><button type="button" class="arcade-btn arcade-dialog-close" aria-label="Close" title="Close">${icon('close')}</button></div><p class="arcade-hint arcade-dialog-intro">Optional. Every game works without an account; logging in just fills in your name.</p><form class="arcade-login-form" novalidate><div class="arcade-field"><label for="arcade-login-id">Email or username</label><input id="arcade-login-id" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></div><div class="arcade-field arcade-password-field"><label for="arcade-login-password">Password</label><input id="arcade-login-password" name="password" type="password" autocomplete="current-password" required></div><p class="arcade-form-message" role="alert"></p><button type="submit" class="arcade-btn arcade-primary arcade-wide">Log in</button></form><div class="arcade-providers"><a class="arcade-btn arcade-wide arcade-provider" data-provider="google" href="#">Continue with Google</a><a class="arcade-btn arcade-wide arcade-provider" data-provider="microsoft" href="#">Continue with Microsoft</a></div><p class="arcade-dialog-foot"><button type="button" class="arcade-link arcade-forgot">Forgot password?</button></p></div>`;
      element.append(layer);
      const box = layer.querySelector('.arcade-dialog'), form = layer.querySelector('form'), idInput = form.querySelector('#arcade-login-id'), pwField = form.querySelector('.arcade-password-field'), pwInput = form.querySelector('#arcade-login-password'), message = layer.querySelector('.arcade-form-message'), submit = form.querySelector('[type=submit]'), heading = layer.querySelector('h2'), intro = layer.querySelector('.arcade-dialog-intro'), idLabel = form.querySelector('label'), providers = layer.querySelector('.arcade-providers'), forgot = layer.querySelector('.arcade-forgot');
      const say = (text, kind = 'error') => { message.textContent = text; message.dataset.kind = kind; };
      function setMode(next) {
        mode = next; const reset = next === 'forgot';
        heading.textContent = reset ? 'Reset password' : 'Log in'; pwField.hidden = reset; providers.hidden = reset; pwInput.required = !reset;
        idLabel.textContent = reset ? 'Email' : 'Email or username'; idInput.autocomplete = reset ? 'email' : 'username';
        submit.textContent = reset ? 'Send reset link' : 'Log in'; forgot.textContent = reset ? 'Back to log in' : 'Forgot password?';
        intro.textContent = reset ? 'We will email you a link to choose a new password.' : 'Optional. Every game works without an account; logging in just fills in your name.';
        say('');
      }
      layer.querySelector('.arcade-dialog-close').onclick = () => closeLogin();
      layer.onpointerdown = event => { if (event.target === layer) closeLogin(); };
      forgot.onclick = () => { setMode(mode === 'login' ? 'forgot' : 'login'); idInput.focus(); };
      for (const link of layer.querySelectorAll('.arcade-provider')) link.onclick = () => { link.href = authClient.providerUrl(link.dataset.provider, location.href.split('#')[0]); };
      for (const link of layer.querySelectorAll('.arcade-provider')) link.href = authClient.providerUrl(link.dataset.provider, location.href.split('#')[0]);
      form.onsubmit = async event => {
        event.preventDefault(); const identifier = idInput.value.trim();
        if (!identifier || (mode === 'login' && !pwInput.value)) { say(mode === 'login' ? 'Enter your email or username and your password.' : 'Enter your email address.'); (identifier ? pwInput : idInput).focus(); return; }
        submit.disabled = true; say(mode === 'login' ? 'Logging in…' : 'Sending…', 'info');
        try {
          if (mode === 'forgot') { await authClient.forgotPassword(identifier); say('If that address has an account, a reset link is on its way.', 'info'); }
          else {
            const result = await authClient.login(identifier, pwInput.value); pwInput.value = '';
            setAccount((await authClient.me()) || result); closeLogin(false); accountToggle.focus();
          }
        } catch (error) { say(error.message || 'Sign-in failed. Please try again.'); if (mode === 'login') { pwInput.value = ''; pwInput.focus(); } }
        finally { submit.disabled = false; }
      };
      layer.onkeydown = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLogin(); return; }
        if (event.key !== 'Tab') return;
        const items = focusables(box); if (!items.length) return;
        const first = items[0], last = items[items.length - 1], active = document.activeElement;
        if (event.shiftKey && (active === first || !box.contains(active))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !box.contains(active))) { event.preventDefault(); first.focus(); }
      };
      return { layer, show(notice) { setMode('login'); layer.hidden = false; if (notice) say(notice); idInput.focus(); } };
    }

    function render() {
      const connection = q('.arcade-connection'); connection.classList.toggle('online', online); connection.querySelector('.arcade-connection-text').textContent = connectionLabel;
      const stored = safeStorage.get('arcade-name');
      if (document.activeElement !== nameInput) nameInput.value = stored;
      nameHint.textContent = account ? (storedName().source === 'account' ? 'Taken from your account. Type another name to change it.' : 'You chose this name for this session.') : 'Shown to the other players in your room.';
      if (config.resetLabel) reset.textContent = config.resetLabel;
      reset.title = config.resetDisabled ? 'Only an active participant can reset this game' : reset.textContent.trim();
      if (!existingReset) reset.disabled = !online || config.resetDisabled !== false;
      else if (!online) reset.disabled = true;
      renderPresence(); renderRooms(); renderApps(); renderAccount();
    }
    createDebugger(); q('.arcade-debug-toggle').onclick = () => setDebugOpen(debugPanel.hidden);
    const resize = () => document.documentElement.style.setProperty('--arcade-topbar-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const timer = setInterval(() => { if (!details.hidden) renderPresence(); }, 1000);
    const api = {element, render, openLogin, closeMenus: () => menus.closeAll(), update(next) { Object.assign(config, next); render(); },
      handleEscape() {
        if (dialog && !dialog.layer.hidden) { closeLogin(); return true; }
        const open = menus.openOne(); if (open) { menus.close(open.toggle, true); return true; }
        if (!details.hidden) { pinned = false; if (details.contains(document.activeElement)) presenceToggle.focus(); showPresence(false); return true; }
        return false;
      },
      closeOutside(target) { if (!element.contains(target)) menus.closeAll(); },
      destroy() { clearInterval(timer); observer.disconnect(); if (currentHeader === api) { setDebugOpen(false, false); currentHeader = null; } }};
    currentHeader = api; render(); loadPlatformApps(); return api;
  }
  window.ArcadePlatform = {mount, send, isInteractiveTarget, setRoomCount(count) { currentHeader?.update({roomCount:count}); }};
  // Compatibility for clients that already consume the shared presence packet.
  window.renderArcadePresence = next => { players = Array.isArray(next) ? next : []; currentHeader?.render(); };
  document.addEventListener('pointerdown', event => { currentHeader?.closeOutside(event.target); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (currentHeader?.handleEscape()) return;
    if (debugPanel && !debugPanel.hidden) { event.preventDefault(); setDebugOpen(false); }
  });
  startAuth();
  // Legacy scripts load immediately after platform.js and keep their original reset handlers.
  const legacyHeader = document.querySelector('header[data-arcade-game]');
  if (legacyHeader) mount(legacyHeader, {game:legacyHeader.dataset.arcadeGame});
})();
