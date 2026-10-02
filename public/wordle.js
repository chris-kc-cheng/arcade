function sessionClient() {
  let id = sessionStorage.getItem('arcade-client');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('arcade-client', id);
  }
  return id;
}

const $ = selector => document.querySelector(selector);
const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?room=wordle&client=${encodeURIComponent(sessionClient())}`);
let state;
let pending = false;

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function tile(letter = '', result = '') {
  const cell = document.createElement('span');
  cell.className = `tile ${result}`;
  cell.textContent = letter;
  return cell;
}

function render(previousGuessCount = 0) {
  if (!state) return;
  $('#lengthCount').textContent = `${state.availableByLength[state.length]} ${state.length}-letter words`;
  document.querySelectorAll('[data-length]').forEach(button => {
    const selected = Number(button.dataset.length) === state.length;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', selected);
  });

  const rows = [];
  for (let row = 0; row < 6; row++) {
    const guess = state.guesses[row];
    const line = document.createElement('div');
    line.className = 'row';
    line.style.setProperty('--letters', state.length);
    for (let column = 0; column < state.length; column++) {
      line.append(tile(guess?.word[column]?.toUpperCase(), guess?.result[column]));
    }
    rows.push(line);
  }
  $('#board').replaceChildren(...rows);

  const finished = state.status !== 'playing';
  $('#guess').disabled = finished;
  $('#guessForm button').disabled = finished || pending;
  $('#guess').maxLength = state.length;
  if (state.guesses.length > previousGuessCount) $('#guess').value = '';
  $('#reset').textContent = finished ? 'PLAY AGAIN' : 'NEW WORD';
  $('#reset').setAttribute('aria-label', finished ? 'Play again with a new word' : 'Reset this game with a new word');
  $('#message').className = state.status;
  $('#message').textContent = state.message || (state.status === 'won'
    ? `Solved in ${state.guesses.length}! The answer was ${state.answer.toUpperCase()}. Select PLAY AGAIN for a new word.`
    : state.status === 'lost'
      ? `The answer was ${state.answer.toUpperCase()}. Select PLAY AGAIN for a new word.`
      : `${6 - state.guesses.length} guesses remaining`);
  if (!finished) $('#guess').focus();
}

socket.onopen = () => {
  $('#connection').textContent = '● PRIVATE & LIVE';
  const name = sessionStorage.getItem('arcade-name');
  if (name) send({ type: 'setName', name });
};
socket.onclose = () => {
  $('#connection').textContent = '● OFFLINE';
  $('#guess').disabled = true;
  $('#guessForm button').disabled = true;
};
socket.onmessage = event => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === 'platformPresence') {
    renderArcadePresence(message.players);
    return;
  }
  if (message.type === 'switchGame' && message.path !== location.pathname) {
    location.assign(message.path);
    return;
  }
  if (message.type === 'wordleState') {
    const previousGuessCount = state?.guesses.length || 0;
    state = message;
    pending = false;
    render(previousGuessCount);
  }
};

$('#guessForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!state || state.status !== 'playing' || pending) return;
  const word = $('#guess').value.trim().toLowerCase();
  if (word.length !== state.length) {
    $('#message').textContent = `Enter exactly ${state.length} letters`;
    return;
  }
  pending = send({ type: 'guess', word });
  $('#guessForm button').disabled = pending;
});
$('#guess').addEventListener('input', event => {
  event.target.value = event.target.value.replace(/[^a-z]/gi, '').toUpperCase();
});
$('#reset').onclick = () => {
  if (send({ type: 'reset' })) pending = true;
};
document.querySelectorAll('[data-length]').forEach(button => {
  button.onclick = () => {
    if (send({ type: 'length', length: Number(button.dataset.length) })) pending = true;
  };
});
document.querySelectorAll('.arcade-nav a').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (confirm(`Switch everyone to ${link.title}?`)) send({ type: 'switchGame', path: link.getAttribute('href') });
}));
