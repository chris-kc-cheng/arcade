(() => {
  const badge = document.createElement('div');
  badge.className = 'active-players platform-floating';
  badge.tabIndex = 0;
  badge.innerHTML = '<strong>0</strong><span> ACTIVE</span><div class="active-player-details"><div>No active players</div></div>';
  document.body.append(badge);
  const elapsed = since => { const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`; };
  window.renderArcadePresence = players => {
    badge.querySelector('strong').textContent = players.length;
    badge.setAttribute('aria-label', `${players.length} active players`);
    const details = badge.querySelector('.active-player-details');
    details.replaceChildren(...(players.length ? players.map(player => {
      const row = document.createElement('div'), name = document.createElement('b'), info = document.createElement('span');
      name.textContent = player.name;
      info.textContent = `${player.ip} · ${player.room} · connected ${elapsed(player.connectedAt)} ago`;
      row.append(name, info); return row;
    }) : [Object.assign(document.createElement('div'), { textContent: 'No active players' })]));
  };
})();
