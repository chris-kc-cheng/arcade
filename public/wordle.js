function sessionClient() {
  let id = sessionStorage.getItem('arcade-client');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('arcade-client', id);
  }
  return id;
}

const $ = selector => document.querySelector(selector);
const clientId = sessionClient();
let socket;
let state;
let pending = false;
let pendingTimer;
let reconnectTimer;

const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function pressKey(key) {
  const input = $('#guess');
  if (!state || state.status !== 'playing' || input.disabled) return;
  if (key === 'enter') {
    $('#guessForm').requestSubmit();
  } else if (key === 'backspace') {
    input.value = input.value.slice(0, -1);
    input.focus();
  } else if (input.value.length < state.length) {
    input.value += key.toUpperCase();
    input.focus();
  }
}

function buildKeyboard() {
  const rows = keyboardRows.map((letters, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    const keys = [...letters];
    if (rowIndex === 2) keys.unshift('enter');
    if (rowIndex === 2) keys.push('backspace');
    keys.forEach(key => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.key = key;
      button.classList.toggle('wide', key.length > 1);
      button.textContent = key === 'backspace' ? '⌫' : key === 'enter' ? 'Enter' : key;
      button.setAttribute('aria-label', key === 'backspace' ? 'Backspace' : key === 'enter' ? 'Submit guess' : `Letter ${key.toUpperCase()}`);
      button.addEventListener('click', () => pressKey(key));
      row.append(button);
    });
    return row;
  });
  $('#keyboard').replaceChildren(...rows);
}
buildKeyboard();

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function setPending(value) {
  pending = value;
  clearTimeout(pendingTimer);
  if (value) pendingTimer = setTimeout(() => {
    pending = false;
    if (state?.status === 'playing') $('#guessForm button').disabled = false;
    $('#message').textContent = 'The server took too long to respond. You can try again.';
  }, 3000);
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

  document.querySelectorAll('#keyboard [data-key]').forEach(button => {
    const status = state.letters?.[button.dataset.key] || '';
    button.disabled = state.status !== 'playing';
    button.classList.remove('correct', 'present', 'absent');
    if (status) button.classList.add(status);
    const letter = button.dataset.key;
    if (letter.length === 1) button.setAttribute('aria-label', `Letter ${letter.toUpperCase()}${status ? `, ${status}` : ', unused'}`);
  });

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

function handleMessage(event) {
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
    setPending(false);
    render(previousGuessCount);
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?room=wordle&client=${encodeURIComponent(clientId)}`);
  socket.onopen = () => {
    $('#connection').textContent = '● PRIVATE & LIVE';
    const name = sessionStorage.getItem('arcade-name');
    if (name) send({ type: 'setName', name });
  };
  socket.onclose = () => {
    setPending(false);
    $('#connection').textContent = '● RECONNECTING';
    $('#guess').disabled = true;
    $('#guessForm button').disabled = true;
    document.querySelectorAll('#keyboard button').forEach(button => { button.disabled = true; });
    reconnectTimer = setTimeout(connect, 1000);
  };
  socket.onmessage = handleMessage;
}
connect();

$('#guessForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!state || state.status !== 'playing' || pending) return;
  const word = $('#guess').value.trim().toLowerCase();
  if (word.length !== state.length) {
    $('#message').textContent = `Enter exactly ${state.length} letters`;
    return;
  }
  setPending(send({ type: 'guess', word }));
  $('#guessForm button').disabled = pending;
});
$('#guess').addEventListener('input', event => {
  event.target.value = event.target.value.replace(/[^a-z]/gi, '').toUpperCase();
});
$('#reset').onclick = () => {
  if (send({ type: 'reset' })) setPending(true);
};
document.querySelectorAll('[data-length]').forEach(button => {
  button.onclick = () => {
    if (send({ type: 'length', length: Number(button.dataset.length) })) setPending(true);
  };
});
document.querySelectorAll('.arcade-nav a').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (confirm(`Switch everyone to ${link.title}?`)) send({ type: 'switchGame', path: link.getAttribute('href') });
}));
