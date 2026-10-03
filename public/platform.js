(() => {
  const games = [['/','◉','Drawing board'],['/tank','▣','Tank'],['/penalty','●','Penalty shootout'],['/fighter','✦','Line Fighter'],['/snake','∿','Snake'],['/bigtwo','♦','Big-D'],['/typing','T','Type/Off'],['/wordle','W','Many Words'],['/poll','≡','Quick Poll']];
  const NativeWebSocket = window.WebSocket, logs = [];
  let logList, stats;
  const totals = { SENT: { messages: 0, bytes: 0 }, RECEIVED: { messages: 0, bytes: 0 } };
  const display = data => { if (typeof data !== 'string') return `[binary data: ${data?.byteLength ?? data?.size ?? 'unknown'} bytes]`; try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; } };
  const byteSize = data => typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data?.byteLength ?? data?.size ?? 0;
  const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  function updateStats() {
    if (!stats) return;
    for (const direction of ['SENT', 'RECEIVED']) {
      stats.querySelector(`[data-${direction.toLowerCase()}-messages]`).textContent = totals[direction].messages.toLocaleString();
      stats.querySelector(`[data-${direction.toLowerCase()}-bytes]`).textContent = formatBytes(totals[direction].bytes);
    }
  }
  function renderEntry(entry) {
    if (!logList) return;
    const row = document.createElement('article'), heading = document.createElement('div'), label = document.createElement('strong'), time = document.createElement('time'), payload = document.createElement('pre');
    row.className = `arcade-debug-entry ${entry.direction.toLowerCase()}`; label.textContent = entry.direction; time.textContent = entry.at.toLocaleTimeString(); payload.textContent = entry.data;
    heading.append(label, time); row.append(heading, payload); logList.append(row); logList.scrollTop = logList.scrollHeight;
  }
  function record(direction, data, url) {
    const entry = { direction, data: display(data), url, at: new Date() };
    totals[direction].messages++; totals[direction].bytes += byteSize(data); updateStats();
    logs.push(entry); if (logs.length > 250) logs.shift(); if (!logList) return;
    renderEntry(entry);
  }
  class DebugWebSocket extends NativeWebSocket {
    constructor(url, protocols) { super(url, protocols); this.arcadeDebugUrl = String(url); this.addEventListener('message', event => record('RECEIVED', event.data, this.arcadeDebugUrl)); }
    send(data) { record('SENT', data, this.arcadeDebugUrl); return super.send(data); }
  }
  window.WebSocket = DebugWebSocket;
  function normalizeNav(nav) {
    if (nav.dataset.arcadeUnified) return;
    const current = location.pathname === '/index.html' ? '/' : location.pathname;
    nav.className = 'arcade-nav'; nav.setAttribute('aria-label', 'Arcade games');
    const links = [...nav.querySelectorAll('a')];
    games.forEach(([path, icon, label], index) => {
      const link = links.find(item => item.getAttribute('href') === path) || links[index];
      if (!link) return;
      link.href = path; link.textContent = icon; link.title = label; link.setAttribute('aria-label', label);
      link.classList.toggle('active', path === current);
      if (path === current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    nav.dataset.arcadeUnified = 'true';
  }
  function createDebugger() {
    if (document.querySelector('.arcade-debug-panel')) return;
    const panel = document.createElement('aside'); panel.id = 'arcade-debug-panel'; panel.className = 'arcade-debug-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'WebSocket debug log');
    panel.innerHTML = '<div class="arcade-debug-heading"><div><small>LIVE PROTOCOL</small><strong>SERVER DEBUG</strong></div><div class="arcade-debug-actions"><button type="button" class="arcade-debug-clear">CLEAR</button><button type="button" class="arcade-debug-close" aria-label="Close debug panel">×</button></div></div><dl class="arcade-debug-stats" aria-label="WebSocket traffic statistics"><div><dt>RECEIVED</dt><dd><strong data-received-messages>0</strong> messages<br><span data-received-bytes>0 B</span></dd></div><div><dt>SENT</dt><dd><strong data-sent-messages>0</strong> messages<br><span data-sent-bytes>0 B</span></dd></div></dl><div class="arcade-debug-list" aria-live="polite"></div>';
    document.body.append(panel); logList = panel.querySelector('.arcade-debug-list'); stats = panel.querySelector('.arcade-debug-stats'); updateStats();
    panel.querySelector('.arcade-debug-clear').onclick = () => { logs.length = 0; totals.SENT.messages = totals.SENT.bytes = totals.RECEIVED.messages = totals.RECEIVED.bytes = 0; logList.replaceChildren(); updateStats(); };
    panel.querySelector('.arcade-debug-close').onclick = () => setDebugOpen(false);
    logs.forEach(renderEntry);
  }
  function setDebugOpen(open) {
    const panel = document.querySelector('.arcade-debug-panel'), toggle = document.querySelector('.arcade-debug-toggle');
    if (!panel || !toggle) return;
    panel.hidden = !open; toggle.classList.toggle('active', open); toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('.arcade-debug-close').focus(); else toggle.focus();
  }
  function enhance() {
    document.querySelectorAll('.arcade-nav').forEach(normalizeNav);
    const header = document.querySelector('header'); if (!header || header.querySelector('.arcade-debug-toggle')) return;
    createDebugger(); const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'arcade-debug-toggle'; toggle.textContent = 'DEBUG'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'arcade-debug-panel');
    toggle.onclick = () => setDebugOpen(document.querySelector('.arcade-debug-panel').hidden);
    header.append(toggle);
  }
  function setup() {
    enhance(); new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('.arcade-debug-panel')?.hidden) setDebugOpen(false); });
    if (!document.querySelector('.active-players')) { const badge = document.createElement('div'); badge.className = 'active-players platform-floating'; badge.tabIndex = 0; badge.innerHTML = '<strong>0</strong><span> ACTIVE</span><div class="active-player-details"><div>No active players</div></div>'; document.body.append(badge); }
  }
  const elapsed = since => { const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`; };
  window.renderArcadePresence = players => { const badge = document.querySelector('.platform-floating'); if (!badge) return; badge.querySelector('strong').textContent = players.length; badge.setAttribute('aria-label', `${players.length} active players`); const details = badge.querySelector('.active-player-details'); details.replaceChildren(...(players.length ? players.map(player => { const row = document.createElement('div'), name = document.createElement('b'), info = document.createElement('span'); name.textContent = player.name; info.textContent = `${player.ip} · ${player.room} · connected ${elapsed(player.connectedAt)} ago`; row.append(name, info); return row; }) : [Object.assign(document.createElement('div'), { textContent: 'No active players' })])); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
