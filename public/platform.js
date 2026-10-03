(() => {
  const games = [['/','◉','Drawing board'],['/tank','▣','Tank'],['/penalty','●','Penalty shootout'],['/fighter','✦','Line Fighter'],['/snake','∿','Snake'],['/bigtwo','♦','Big-D'],['/typing','T','Type/Off'],['/wordle','W','Many Words'],['/poll','≡','Quick Poll']];
  const NativeWebSocket = window.WebSocket, logs = [];
  let logList;
  const display = data => { if (typeof data !== 'string') return `[binary data: ${data?.byteLength ?? data?.size ?? 'unknown'} bytes]`; try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data; } };
  function record(direction, data, url) {
    const entry = { direction, data: display(data), url, at: new Date() };
    logs.push(entry); if (logs.length > 250) logs.shift(); if (!logList) return;
    const row = document.createElement('article'), heading = document.createElement('div'), label = document.createElement('strong'), time = document.createElement('time'), payload = document.createElement('pre');
    row.className = `arcade-debug-entry ${direction.toLowerCase()}`; label.textContent = direction; time.textContent = entry.at.toLocaleTimeString(); payload.textContent = entry.data;
    heading.append(label, time); row.append(heading, payload); logList.append(row); logList.scrollTop = logList.scrollHeight;
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
    panel.innerHTML = '<div class="arcade-debug-heading"><div><small>LIVE PROTOCOL</small><strong>SERVER DEBUG</strong></div><button type="button" class="arcade-debug-clear">CLEAR</button></div><div class="arcade-debug-list" aria-live="polite"></div>';
    document.body.append(panel); logList = panel.querySelector('.arcade-debug-list'); panel.querySelector('.arcade-debug-clear').onclick = () => { logs.length = 0; logList.replaceChildren(); };
    const pending = logs.splice(0); pending.forEach(entry => record(entry.direction, entry.data, entry.url));
  }
  function enhance() {
    document.querySelectorAll('.arcade-nav').forEach(normalizeNav);
    const header = document.querySelector('header'); if (!header || header.querySelector('.arcade-debug-toggle')) return;
    createDebugger(); const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'arcade-debug-toggle'; toggle.textContent = 'DEBUG'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'arcade-debug-panel');
    toggle.onclick = () => { const panel = document.querySelector('.arcade-debug-panel'), active = panel.hidden; panel.hidden = !active; toggle.classList.toggle('active', active); toggle.setAttribute('aria-expanded', String(active)); };
    header.append(toggle);
  }
  function setup() {
    enhance(); new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
    if (!document.querySelector('.active-players')) { const badge = document.createElement('div'); badge.className = 'active-players platform-floating'; badge.tabIndex = 0; badge.innerHTML = '<strong>0</strong><span> ACTIVE</span><div class="active-player-details"><div>No active players</div></div>'; document.body.append(badge); }
  }
  const elapsed = since => { const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`; };
  window.renderArcadePresence = players => { const badge = document.querySelector('.platform-floating'); if (!badge) return; badge.querySelector('strong').textContent = players.length; badge.setAttribute('aria-label', `${players.length} active players`); const details = badge.querySelector('.active-player-details'); details.replaceChildren(...(players.length ? players.map(player => { const row = document.createElement('div'), name = document.createElement('b'), info = document.createElement('span'); name.textContent = player.name; info.textContent = `${player.ip} · ${player.room} · connected ${elapsed(player.connectedAt)} ago`; row.append(name, info); return row; }) : [Object.assign(document.createElement('div'), { textContent: 'No active players' })])); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
