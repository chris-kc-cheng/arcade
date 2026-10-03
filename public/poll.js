const $ = selector => document.querySelector(selector);
let socket, state, reconnectTimer;
const client = sessionStorage.getItem('arcade-client') || crypto.randomUUID();
sessionStorage.setItem('arcade-client', client);
const query = new URLSearchParams(location.search);
let pollId = (query.get('id') || '').toUpperCase();
let creatorToken = pollId ? sessionStorage.getItem(`poll-creator-${pollId}`) || '' : '';

function connect() {
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams({ room: 'poll', client });
  if (pollId) params.set('poll', pollId);
  if (creatorToken) params.set('creator', creatorToken);
  socket = new WebSocket(`${protocol}://${location.host}/?${params}`);
  socket.onopen = () => { $('#connection').textContent = '● LIVE'; const name = sessionStorage.getItem('arcade-name'); if (name) send({ type: 'setName', name }); };
  socket.onclose = () => { $('#connection').textContent = '● RECONNECTING'; reconnectTimer = setTimeout(connect, 1200); };
  socket.onmessage = event => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'pollCreated') {
      sessionStorage.setItem(`poll-creator-${message.id}`, message.creatorToken);
      location.assign(`/poll?id=${encodeURIComponent(message.id)}`);
    }
    if (message.type === 'pollReset') { location.assign('/poll'); return; }
    if (message.type === 'switchGame' && message.path !== location.pathname) { location.assign(message.path); return; }
    if (message.type === 'pollMissing') { $('#create').hidden = false; $('#create h1').innerHTML = 'Poll not found.<br><em>Create a new one.</em>'; }
    if (message.type === 'pollState') { state = message; render(); }
  };
}
function send(message) { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(message)); return true; } return false; }

function addChoice(value = '') {
  const row = document.createElement('div'); row.className = 'choice-row';
  const input = document.createElement('input'); input.type = 'text'; input.maxLength = 120; input.required = true; input.placeholder = `Choice ${$('#choices').children.length + 1}`; input.value = value;
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove choice'); remove.onclick = () => { if ($('#choices').children.length > 2) row.remove(); };
  row.append(input, remove); $('#choices').append(row);
}
function elapsed(since) { const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`; }
function renderPresence(players) {
  $('#pollPresence strong').textContent = players.length;
  $('#pollPresence').setAttribute('aria-label', `${players.length} users connected to this poll`);
  const details = $('#pollPresence .active-player-details'); details.replaceChildren(...(players.length ? players.map(player => {
    const row = document.createElement('div'), name = document.createElement('b'), info = document.createElement('span');
    name.textContent = player.name; info.textContent = `${player.ip} · ${player.room} · connected ${elapsed(player.connectedAt)} ago`; row.append(name, info); return row;
  }) : [Object.assign(document.createElement('div'), { textContent: 'No connected users' })]));
}
function render() {
  $('#create').hidden = true; $('#poll').hidden = false; $('#question').textContent = state.question; $('#pollCode').textContent = `POLL ${state.id}`;
  const connected = state.connected || 0;
  $('#responseProgress').textContent = `${state.submitted} RESPONDED · ${connected} CONNECTED`;
  $('.share').hidden = !state.isCreator;
  $('#poll').classList.toggle('responding', !state.isCreator);
  const shareUrl = `${location.origin}/poll?id=${encodeURIComponent(state.id)}`;
  if (state.isCreator && !$('#qr').src) $('#qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=640x640&margin=12&data=${encodeURIComponent(shareUrl)}`;
  renderPresence(state.participants || []); $('#reset').hidden = !state.isCreator; $('#showResults').hidden = !state.isCreator || state.showingResults;
  const show = state.showingResults && state.results;
  $('#responseProgress').hidden = show;
  $('#voteForm').hidden = show || state.hasVoted; $('#thanks').hidden = show || !state.hasVoted; $('#results').hidden = !show;
  if (!show) {
    $('#answers').replaceChildren(...state.choices.map((choice, index) => { const label = document.createElement('label'); label.className = 'answer'; const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'choice'; radio.value = index; radio.required = true; label.append(radio, document.createTextNode(choice)); return label; }));
  } else {
    const total = state.results.totals.reduce((sum, count) => sum + count, 0);
    const rows = state.choices.map((choice, index) => { const count = state.results.totals[index], percent = total ? Math.round(count / total * 100) : 0; const row = document.createElement('div'); row.className = 'bar'; row.innerHTML = `<div class="bar-head"><span></span><b>${count} · ${percent}%</b></div><div class="track"><div class="fill" style="width:${percent}%"></div></div>`; row.querySelector('span').textContent = choice; return row; });
    $('#results').replaceChildren(...rows); $('#status').textContent = 'RESULTS';
  }
}

addChoice(); addChoice(); $('#addChoice').onclick = () => addChoice();
$('#createForm').onsubmit = event => { event.preventDefault(); send({ type: 'createPoll', question: event.currentTarget.elements.question.value, choices: [...$('#choices').querySelectorAll('input')].map(input => input.value) }); };
$('#voteForm').onsubmit = event => { event.preventDefault(); const selected = new FormData(event.currentTarget).get('choice'); if (selected !== null) send({ type: 'vote', choice: Number(selected) }); };
$('#showResults').onclick = () => send({ type: 'showResults', creatorToken });
$('#reset').onclick = () => { if (confirm('Close this poll and prepare a new question?')) send({ type: 'resetPoll', creatorToken }); };
$('#copy').onclick = async () => { await navigator.clipboard.writeText(`${location.origin}/poll?id=${encodeURIComponent(state.id)}`); $('#toast').textContent = 'Poll link copied!'; };
document.querySelectorAll('.arcade-nav a').forEach(link => link.addEventListener('click', event => { event.preventDefault(); if (confirm(`Switch everyone to ${link.title}?`)) send({ type: 'switchGame', path: link.getAttribute('href') }); }));
connect();
