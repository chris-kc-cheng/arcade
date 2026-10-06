(() => {
  // One shared shell for the React entry points and the dependency-free game clients.
  const games = [['/','◉','Drawing board'],['/tank','▣','Tank'],['/penalty','●','Penalty shootout'],['/fighter','✦','Line Fighter'],['/snake','∿','Snake'],['/bigtwo','♦','Big-D'],['/typing','T','Type/Off'],['/wordle','W','Many Words'],['/poll','≡','Quick Poll'],['/cube','▦','Cube Lab']];
  const rooms = {board:'doodle',tank:'tanks',penalty:'penalty',fighter:'fighter',snake:'snake',bigtwo:'bigtwo',typing:'typing',wordle:'wordle',poll:'poll',cube:'cube'};
  const NativeWebSocket = window.WebSocket, logs = [];
  const totals = { SENT: { messages: 0, bytes: 0 }, RECEIVED: { messages: 0, bytes: 0 } };
  let currentSocket, currentHeader, players = [], online = false, connectionLabel = 'CONNECTING', debugPanel, logList, stats;
  const display = data => { if (typeof data !== 'string') return `[binary data: ${data?.byteLength ?? data?.size ?? 'unknown'} bytes]`; try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; } };
  const byteSize = data => typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data?.byteLength ?? data?.size ?? 0;
  const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const elapsed = since => { const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`; };
  const isInteractiveTarget = target => Boolean(target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],.arcade-topbar,.arcade-debug-panel'));
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
      super(url, protocols); this.arcadeDebugUrl = String(url);
      currentSocket = this; online = false; connectionLabel = 'CONNECTING'; players = []; currentHeader?.render();
      this.addEventListener('open', () => { if (currentSocket === this) { online = true; connectionLabel = 'LIVE'; currentHeader?.render(); } });
      this.addEventListener('close', () => { if (currentSocket === this) { online = false; connectionLabel = 'OFFLINE'; players = []; currentHeader?.render(); } });
      this.addEventListener('message', event => {
        record('RECEIVED', event.data, this.arcadeDebugUrl);
        if (currentSocket !== this) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'platformPresence') { players = Array.isArray(message.players) ? message.players : []; currentHeader?.render(); }
      });
    }
    send(data) { super.send(data); record('SENT', data, this.arcadeDebugUrl); }
  }
  window.WebSocket = DebugWebSocket;
  function createDebugger() {
    if (debugPanel) return;
    debugPanel = document.createElement('aside'); debugPanel.id = 'arcade-debug-panel'; debugPanel.className = 'arcade-debug-panel'; debugPanel.hidden = true; debugPanel.setAttribute('aria-label', 'WebSocket debug log');
    debugPanel.innerHTML = '<div class="arcade-debug-heading"><div><small>LIVE PROTOCOL</small><strong>SERVER DEBUG</strong></div><div class="arcade-debug-actions"><button type="button" class="arcade-debug-clear">CLEAR</button><button type="button" class="arcade-debug-close" aria-label="Close debug panel">×</button></div></div><dl class="arcade-debug-stats" aria-label="WebSocket traffic statistics"><div><dt>RECEIVED</dt><dd><strong data-received-messages>0</strong> messages<br><span data-received-bytes>0 B</span></dd></div><div><dt>SENT</dt><dd><strong data-sent-messages>0</strong> messages<br><span data-sent-bytes>0 B</span></dd></div></dl><div class="arcade-debug-list" tabindex="0" aria-label="Recent protocol messages"></div>';
    document.body.append(debugPanel); logList = debugPanel.querySelector('.arcade-debug-list'); stats = debugPanel.querySelector('.arcade-debug-stats');
    debugPanel.querySelector('.arcade-debug-clear').onclick = () => { logs.length = 0; totals.SENT.messages = totals.SENT.bytes = totals.RECEIVED.messages = totals.RECEIVED.bytes = 0; logList.replaceChildren(); updateStats(); };
    debugPanel.querySelector('.arcade-debug-close').onclick = () => setDebugOpen(false);
  }
  function setDebugOpen(open, restoreFocus = true) {
    if (!debugPanel || !currentHeader) return;
    debugPanel.hidden = !open;
    const toggle = currentHeader.element.querySelector('.arcade-debug-toggle');
    toggle.classList.toggle('active', open); toggle.setAttribute('aria-expanded', String(open));
    if (open) { updateStats(); logList.replaceChildren(); logs.forEach(renderEntry); debugPanel.querySelector('.arcade-debug-close').focus(); }
    else if (restoreFocus) toggle.focus();
  }
  function mount(element, options = {}) {
    if (currentHeader?.element === element) { currentHeader.update(options); return currentHeader; }
    currentHeader?.destroy();
    const config = {...options}, existingReset = element.querySelector('#reset, #resetButton');
    element.className = 'arcade-topbar'; element.dataset.arcadeGame = config.game;
    element.setAttribute('aria-label', 'Arcade navigation and shared controls');
    element.innerHTML = '<div class="arcade-brand"><span>ARCADE</span><strong></strong></div><nav class="arcade-nav" aria-label="Arcade games"></nav><div class="arcade-controls"><form class="arcade-name" aria-label="Session username"><input maxlength="24" autocomplete="off" aria-label="Username" placeholder="Your name"><button type="submit" class="arcade-button" aria-label="Save username" title="Save username">✓</button></form><div class="arcade-presence"><button type="button" class="arcade-button arcade-presence-toggle" aria-expanded="false" aria-controls="arcade-player-details"><strong>0</strong> ACTIVE <span class="arcade-room-count">0 HERE</span></button><div id="arcade-player-details" class="arcade-player-details" role="region" aria-label="Connected player details" tabindex="0" hidden><div>No active players</div></div></div><div class="arcade-connection" role="status"><i></i><span>CONNECTING</span></div><button type="button" class="arcade-button arcade-debug-toggle" aria-expanded="false" aria-controls="arcade-debug-panel">DEBUG</button></div>';
    const nav = element.querySelector('.arcade-nav'), controls = element.querySelector('.arcade-controls'), debugToggle = element.querySelector('.arcade-debug-toggle');
    games.forEach(([path, icon, label]) => {
      const link = document.createElement('a'); link.href = path; link.title = label; link.setAttribute('aria-label', label); link.textContent = icon;
      const selected = path === (config.game === 'board' ? '/' : `/${config.game}`);
      if (selected) { link.className = 'active'; link.setAttribute('aria-current', 'page'); element.querySelector('.arcade-brand strong').textContent = label; }
      link.onclick = event => { event.preventDefault(); if (online && confirm(`Switch everyone to ${label}?`)) send({type:'switchGame',path}); };
      nav.append(link);
    });
    const reset = existingReset || document.createElement('button'); reset.type = 'button'; reset.className = 'arcade-button arcade-reset'; reset.hidden = false;
    if (!existingReset) { reset.textContent = 'RESET'; reset.disabled = true; reset.onclick = () => config.onReset?.(); }
    controls.insertBefore(reset, debugToggle);
    const nameForm = element.querySelector('.arcade-name'), nameInput = nameForm.querySelector('input'), saveName = nameForm.querySelector('button');
    nameInput.value = sessionStorage.getItem('arcade-name') || '';
    nameForm.onsubmit = event => {
      event.preventDefault(); const name = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!name || sessionStorage.getItem('arcade-name') || !send({type:'setName',name})) return;
      sessionStorage.setItem('arcade-name', name); nameInput.value = name; render();
    };
    const presence = element.querySelector('.arcade-presence'), presenceToggle = element.querySelector('.arcade-presence-toggle'), details = element.querySelector('.arcade-player-details');
    let pinned = false, hovering = false;
    function showPresence(open) { details.hidden = !open; presenceToggle.setAttribute('aria-expanded', String(open)); }
    presenceToggle.onclick = () => { pinned = !pinned; showPresence(pinned); };
    presence.onmouseenter = () => { hovering = true; showPresence(true); };
    presence.onmouseleave = () => { hovering = false; showPresence(pinned || presence.contains(document.activeElement)); };
    presence.onfocusin = () => showPresence(true);
    presence.onfocusout = event => { if (!presence.contains(event.relatedTarget)) { pinned = false; showPresence(hovering); } };
    function renderPresence() {
      const roomPlayers = players.filter(player => player.room === rooms[config.game]), count = online ? config.roomCount ?? roomPlayers.length : 0;
      presenceToggle.querySelector('strong').textContent = players.length;
      presenceToggle.querySelector('.arcade-room-count').textContent = `${count} HERE`;
      presenceToggle.setAttribute('aria-label', `${players.length} active players across Arcade, ${count} connected to this room. Show player details`);
      details.replaceChildren(...(players.length ? players.map(player => {
        const row = document.createElement('div'), name = document.createElement('b'), info = document.createElement('span');
        name.textContent = player.name; info.textContent = `${player.ip} · ${player.room} · connected ${elapsed(player.connectedAt)} ago`; row.append(name, info); return row;
      }) : [Object.assign(document.createElement('div'), {textContent:'No active players'})]));
    }
    function render() {
      const locked = Boolean(sessionStorage.getItem('arcade-name'));
      nameInput.disabled = locked || !online; saveName.disabled = locked || !online; saveName.textContent = locked ? '✓' : '→';
      nameForm.title = locked ? 'Username is fixed for this browser session' : 'Choose a username for this session';
      const connection = element.querySelector('.arcade-connection'); connection.classList.toggle('online', online); connection.querySelector('span').textContent = connectionLabel;
      if (config.resetLabel) reset.textContent = config.resetLabel;
      if (!existingReset) reset.disabled = !online || config.resetDisabled !== false;
      else if (!online) reset.disabled = true;
      if (config.resetDisabled) reset.title = 'Only an active participant can reset this game'; else reset.removeAttribute('title');
      renderPresence();
    }
    createDebugger(); debugToggle.onclick = () => setDebugOpen(debugPanel.hidden);
    const resize = () => document.documentElement.style.setProperty('--arcade-topbar-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const timer = setInterval(() => { if (!details.hidden) renderPresence(); }, 1000);
    const api = {element, render, update(next) { Object.assign(config, next); render(); }, closePresence() { pinned = false; if (details.contains(document.activeElement)) presenceToggle.focus(); showPresence(false); }, destroy() { clearInterval(timer); observer.disconnect(); if (currentHeader === api) { setDebugOpen(false, false); currentHeader = null; } }};
    currentHeader = api; render(); return api;
  }
  window.ArcadePlatform = {mount, send, isInteractiveTarget, setRoomCount(count) { currentHeader?.update({roomCount:count}); }};
  // Compatibility for clients that already consume the shared presence packet.
  window.renderArcadePresence = next => { players = Array.isArray(next) ? next : []; currentHeader?.render(); };
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (debugPanel && !debugPanel.hidden) { event.preventDefault(); setDebugOpen(false); }
    currentHeader?.closePresence();
  });
  // Legacy scripts load immediately after platform.js and keep their original reset handlers.
  const legacyHeader = document.querySelector('header[data-arcade-game]');
  if (legacyHeader) mount(legacyHeader, {game:legacyHeader.dataset.arcadeGame});
})();
