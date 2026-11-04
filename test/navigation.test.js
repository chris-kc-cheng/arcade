const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// A small, dependency-free DOM model executes the real platform script. Layout is
// intentionally not emulated; responsive geometry still requires browser QA.
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {setProperty() {}}; this.disabled = false; this.value = ''; this.listeners = {}; this._text = ''; }
  set hidden(value) { if (value) this.attributes.hidden = ''; else delete this.attributes.hidden; } get hidden() { return 'hidden' in this.attributes; }
  get href() { return this.attributes.href; } set href(value) { this.attributes.href = String(value); }
  get title() { return this.attributes.title; } set title(value) { this.attributes.title = String(value); }
  hasAttribute(name) { return name in this.attributes; }
  get isConnected() { return Boolean(this.parentElement); }
  set className(value) { this.attributes.class = value; }
  get className() { return this.attributes.class || ''; }
  get classList() { return {toggle: (name, force) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); const add = force ?? !names.has(name); if (add) names.add(name); else names.delete(name); this.className = [...names].join(' '); return add; }, add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)}; }
  set id(value) { this.attributes.id = value; } get id() { return this.attributes.id; }
  set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(html) {
    this.replaceChildren(); const stack = [this];
    for (const part of html.match(/<[^>]+>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; }
      if (!part.startsWith('<')) { stack.at(-1)._text += part; continue; }
      const tag = part.match(/^<([\w-]+)/)[1], node = new Element(tag, this.document);
      for (const match of part.slice(tag.length + 1, part.endsWith('/>') ? -2 : -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(match[1], match[2] ?? '');
      stack.at(-1).append(node); if (!part.endsWith('/>') && !['input','br','img','meta','link'].includes(tag)) stack.push(node);
    }
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; } removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  insertBefore(node, before) { node.remove(); node.parentElement = this; this.children.splice(this.children.indexOf(before), 0, node); }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  get firstElementChild() { return this.children[0]; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const attrs = [...selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    if (attrs.some(([, name, value]) => this.getAttribute(name) === null || value !== undefined && this.getAttribute(name) !== value)) return false;
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const tag = selector.match(/^[\w-]+/); if (tag && this.tagName !== tag[0].toUpperCase()) return false;
    return [...selector.matchAll(/([.#])([\w-]+)/g)].every(([, kind, value]) => kind === '#' ? this.id === value : this.className.split(/\s+/).includes(value));
  }
  closest(selector) { return selector.split(',').some(part => this.matches(part.trim())) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    const all = []; const walk = root => root.children.forEach(child => { all.push(child); walk(child); }); walk(this);
    return all.filter(node => selector.split(',').some(part => { const path = part.trim().split(/\s+/); if (!node.matches(path.pop())) return false; let ancestor = node.parentElement; while (path.length) { const next = path.pop(); while (ancestor && !ancestor.matches(next)) ancestor = ancestor.parentElement; if (!ancestor) return false; ancestor = ancestor.parentElement; } return true; }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  focus() { this.document.activeElement = this; }
  getBoundingClientRect() { return {height:76}; }
}
function platform(game = 'board', legacy = false, options = {}) {
  const document = {listeners:{}, activeElement:null, createElement(tag) { return new Element(tag, this); }, addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }};
  document.body = document.createElement('body'); document.documentElement = document.createElement('html'); document.documentElement.append(document.body);
  document.querySelector = selector => document.body.querySelector(selector);
  const header = document.createElement('header'); header.setAttribute('data-arcade-game', game); document.body.append(header);
  let reset;
  if (legacy) { reset = document.createElement('button'); reset.id = game === 'snake' ? 'resetButton' : 'reset'; reset.textContent = 'RESET MATCH'; reset.disabled = true; header.append(reset); }
  const sent = [], prompts = [], sockets = [], timers = new Map(), storage = new Map(), replaced = []; let nextTimer = 0;
  class FakeSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; sockets.push(this); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type, event = {}) { if (type === 'open') this.readyState = 1; if (type === 'close') this.readyState = 3; this.listeners[type]?.forEach(callback => callback(event)); }
    close() { this.emit('close'); }
    send(data) { sent.push(JSON.parse(data)); }
  }
  const href = `https://arcade.test${game === 'board' ? '/' : `/${game}`}${options.query || ''}`;
  const down = new TypeError('Failed to fetch');
  const defaultFetch = async url => { if (String(url).endsWith('/api/platform-apps')) return {ok:true, json:async () => []}; throw down; };
  const context = {URL, AbortController, setTimeout, clearTimeout, Promise, JSON, addEventListener(name, callback) { (document.listeners[name] ||= []).push(callback); }, document, WebSocket:FakeSocket, TextEncoder, Date, history:{replaceState(...args) { replaced.push(args); }}, sessionStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,value), removeItem:key => storage.delete(key)}, confirm:message => { prompts.push(message); return context.approve; }, approve:true, fetch:(...args) => context.fetchImpl(...args), fetchImpl:options.fetchImpl || defaultFetch, setInterval:callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearInterval:id => timers.delete(id), ResizeObserver:class {observe() {} disconnect() {}}, location:{pathname:game === 'board' ? '/' : `/${game}`, href, assign(path) { this.assigned=path; }, reload() { this.reloaded=true; }}};
  context.window = context; vm.runInNewContext(fs.readFileSync(require.resolve('../public/sso.js'), 'utf8'), context); vm.runInNewContext(fs.readFileSync(require.resolve('../public/platform.js'), 'utf8'), context);
  return {context, document, header, reset, sent, prompts, sockets, storage, timers, replaced, connect() { const socket = new context.WebSocket('ws://localhost/?room=test'); socket.emit('open'); return socket; }, packet(socket, message) { socket.emit('message',{data:JSON.stringify(message)}); }};
}
const routes = ['board','tank','penalty','fighter','snake','bigtwo','typing','wordle','poll','cube','slushy','typohunt','twinspot'];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ok = body => ({ok:true, status:200, json:async () => body});
const fail = (status, detail) => ({ok:false, status, statusText:String(status), json:async () => ({detail})});

test('all thirteen games mount one identical shared shell and current route', () => {
  const signature = node => `${node.tagName}.${node.className}[${node.children.map(signature).join(',')}]`;
  let expected;
  for (const game of routes) {
    const env = platform(game); const {header,document,context} = env;
    const api = context.ArcadePlatform.mount(header,{game});
    const links = header.querySelectorAll('.arcade-nav a'); assert.equal(links.length,13);
    assert.equal(links.filter(link => link.getAttribute('aria-current') === 'page').length,1);
    assert.equal(links.find(link => link.getAttribute('aria-current') === 'page').href,game === 'board' ? '/' : `/${game}`);
    links.forEach(link => { assert.ok(link.getAttribute('aria-label')); assert.ok(link.querySelector('svg'), 'every game has a line icon'); });
    assert.equal(header.querySelector('.arcade-title').textContent,links.find(link => link.getAttribute('aria-current') === 'page').getAttribute('aria-label'));
    assert.equal(header.querySelector('.arcade-home').getAttribute('href'),'/');
    const shape = signature(header).replace(/A\.active/g,'A.'); expected ??= shape; assert.equal(shape,expected,game);
    assert.equal(header.querySelectorAll('.arcade-name').length,1); assert.equal(header.querySelectorAll('.arcade-presence').length,1);
    assert.equal(document.body.querySelectorAll('.arcade-debug-panel').length,1);
    assert.equal(context.ArcadePlatform.mount(header,{game}),api,'mounting twice is idempotent');
    assert.equal(env.timers.size,1);
  }
});

test('every toolbar button has an accessible name, a tooltip or visible text, and decorative icons are hidden from assistive tech', () => {
  const env = platform('snake'); const buttons = env.header.querySelectorAll('button');
  assert.ok(buttons.length >= 8);
  for (const button of buttons) assert.ok(button.getAttribute('aria-label') || button.textContent.trim(), `button ${button.className} is named`);
  for (const svg of env.header.querySelectorAll('svg')) if (svg.className !== 'arcade-mark') assert.equal(svg.getAttribute('aria-hidden'), 'true');
  for (const toggle of ['.arcade-games-toggle', '.arcade-presence-toggle', '.arcade-rooms-toggle', '.arcade-apps-toggle', '.arcade-account-toggle']) {
    const node = env.header.querySelector(toggle); assert.ok(node.getAttribute('aria-label'), toggle); assert.ok(node.title, `${toggle} has a tooltip`);
  }
  assert.equal(env.header.querySelector('.arcade-apps-toggle').getAttribute('aria-expanded'), 'false');
});

test('navigation confirms once, sends only through the active socket, and does not navigate locally', () => {
  const env = platform('bigtwo'), link = env.header.querySelectorAll('.arcade-nav a')[0]; let prevented = 0;
  const click = () => link.onclick({preventDefault() { prevented++; }});
  click(); assert.equal(env.sent.length,0); assert.equal(env.prompts.length,0);
  const old = env.connect(); env.context.approve = false; click(); assert.equal(env.sent.length,0);
  env.context.approve = true; click(); assert.deepEqual(env.sent,[{type:'switchGame',path:'/'}]);
  const current = env.connect(); old.emit('close'); click(); assert.equal(env.sent.length,2);
  current.emit('close'); click(); assert.equal(env.sent.length,2); assert.equal(prevented,5);
});

test('the games menu opens from the title, moves with the arrow keys, and Escape returns focus to the title', () => {
  const env = platform('snake'), toggle = env.header.querySelector('.arcade-games-toggle'), menu = env.header.querySelector('#arcade-games-menu');
  assert.equal(menu.hidden,true); toggle.onclick(); assert.equal(menu.hidden,false); assert.equal(toggle.getAttribute('aria-expanded'),'true');
  const links = menu.querySelectorAll('a'); assert.equal(env.document.activeElement,links[0]);
  const key = name => env.header.querySelector('.arcade-games').onkeydown({key:name,target:env.document.activeElement,preventDefault() {}});
  key('ArrowDown'); assert.equal(env.document.activeElement,links[1]); key('End'); assert.equal(env.document.activeElement,links[12]); key('ArrowDown'); assert.equal(env.document.activeElement,links[0]); key('ArrowUp'); assert.equal(env.document.activeElement,links[12]);
  env.document.listeners.keydown[0]({key:'Escape',preventDefault() {}}); assert.equal(menu.hidden,true); assert.equal(toggle.getAttribute('aria-expanded'),'false'); assert.equal(env.document.activeElement,toggle);
  toggle.onclick(); env.document.listeners.pointerdown[0]({target:env.document.body}); assert.equal(menu.hidden,true,'an outside click closes it');
  toggle.onclick(); env.header.querySelector('.arcade-rooms-toggle').onclick(); assert.equal(menu.hidden,true,'only one menu is open at a time');
});

test('presence shows all required fields safely, room count, focus/hover, and disconnect cleanup', () => {
  const env = platform('board'), socket = env.connect(), badge = env.header.querySelector('.arcade-presence-toggle'), details = env.header.querySelector('.arcade-player-details'), presence = env.header.querySelector('.arcade-presence');
  env.packet(socket,{type:'platformPresence',players:[{id:'1',name:'<img onerror=alert(1)>',ip:'127.0.0.1',room:'doodle',connectedAt:Date.now()-62000},{id:'2',name:'Other',ip:'127.0.0.2',room:'snake',connectedAt:Date.now()-1000}]});
  assert.equal(badge.querySelector('strong').textContent,'2'); assert.equal(badge.querySelector('span').textContent,'1 here'); assert.equal(badge.querySelector('span').hidden,false);
  assert.match(badge.getAttribute('aria-label'),/2 active players.*1 connected to this room/);
  assert.match(details.textContent,/<img onerror=alert\(1\)>127.0.0.1 · doodle · connected 1m ago/); assert.equal(details.querySelector('img'),null);
  assert.equal(details.getAttribute('tabindex'),'0');
  presence.onfocusin(); assert.equal(details.hidden,false); assert.equal(badge.getAttribute('aria-expanded'),'true');
  env.document.listeners.keydown[0]({key:'Escape'}); assert.equal(details.hidden,true);
  presence.onmouseenter(); assert.equal(details.hidden,false); presence.onmouseleave(); assert.equal(details.hidden,true);
  env.context.ArcadePlatform.setRoomCount(4); assert.equal(badge.querySelector('span').textContent,'4 here');
  socket.emit('close'); assert.equal(badge.querySelector('strong').textContent,'0'); assert.equal(badge.querySelector('span').textContent,'0 here');
});

test('the player name is saved normalized, can be changed again, and survives remounts and other games', () => {
  const env = platform(), form = env.header.querySelector('form'), input = form.querySelector('input');
  assert.equal(input.disabled,false,'the field is always editable'); env.connect(); input.value = '  Ada   Player  '; form.onsubmit({preventDefault() {}});
  assert.deepEqual(env.sent,[{type:'setName',name:'Ada Player'}]); assert.equal(env.storage.get('arcade-name'),'Ada Player'); assert.equal(env.storage.get('arcade-name-source'),'manual');
  input.value = 'Different'; form.onsubmit({preventDefault() {}}); assert.deepEqual(env.sent.at(-1),{type:'setName',name:'Different'});
  input.value = '   '; form.onsubmit({preventDefault() {}}); assert.equal(env.sent.length,2,'an empty name is ignored'); assert.equal(input.value,'Different');
  const next = env.document.createElement('header'); env.document.body.append(next); env.context.ArcadePlatform.mount(next,{game:'tank'});
  assert.equal(next.querySelector('input').value,'Different');
  assert.equal(env.timers.size,1,'old refresh timer is cleaned up');
});

test('legacy reset handlers are moved without replacement and React permissions remain enforced', () => {
  const env = platform('snake',true); let calls = 0; env.reset.onclick = () => calls++;
  assert.equal(env.header.querySelector('.arcade-reset'),env.reset); env.connect(); env.reset.disabled = false; env.reset.onclick(); assert.equal(calls,1); env.sockets[0].emit('close'); assert.equal(env.reset.disabled,true);
  const modern = platform('penalty'); modern.connect(); const api = modern.context.ArcadePlatform.mount(modern.header,{game:'penalty',resetDisabled:true,onReset:() => calls++});
  const reset = modern.header.querySelector('.arcade-reset'); assert.equal(reset.disabled,true);
  api.update({resetDisabled:false,resetLabel:'RESET MATCH'}); assert.equal(reset.disabled,false); reset.onclick(); assert.equal(calls,2);
});

test('debug retains at most 250 entries, accounts bytes, clears, and restores keyboard focus', () => {
  const env = platform(), socket = env.connect(), toggle = env.header.querySelector('.arcade-debug-toggle'), rooms = env.header.querySelector('.arcade-rooms-toggle');
  for(let i=0;i<300;i++) env.packet(socket,{type:'sample',value:i});
  toggle.onclick(); const panel = env.document.querySelector('.arcade-debug-panel'), list = panel.querySelector('.arcade-debug-list');
  assert.equal(panel.hidden,false); assert.equal(toggle.getAttribute('aria-expanded'),'true'); assert.equal(list.children.length,250); assert.equal(panel.querySelector('[data-received-messages]').textContent,'300');
  socket.send(JSON.stringify({type:'chat',text:'é'})); assert.match(panel.querySelector('[data-sent-bytes]').textContent,/B$/); assert.equal(list.children.length,250);
  panel.querySelector('.arcade-debug-clear').onclick(); assert.equal(list.children.length,0); assert.equal(panel.querySelector('[data-received-messages]').textContent,'0');
  env.document.listeners.keydown[0]({key:'Escape',preventDefault() {}}); assert.equal(panel.hidden,true); assert.equal(env.document.activeElement,rooms,'focus returns to the control that leads to the log');
});

test('legacy entry points delegate shared features and game shortcuts respect navigation', () => {
  for(const game of ['fighter','snake','bigtwo','typing','wordle','poll','cube','slushy','typohunt','twinspot']) {
    const html = fs.readFileSync(require.resolve(`../public/${game}.html`),'utf8');
    assert.match(html,new RegExp(`<header class="arcade-topbar" data-arcade-game="${game}">`));
    assert.match(html,/<script src="\/sso\.js"><\/script><script src="\/platform\.js"><\/script>/,'the login client loads before the platform');
    assert.doesNotMatch(html,/<nav|id="connection"|id="pollPresence"|id="fighterName"/);
  }
  const snake = fs.readFileSync(require.resolve('../public/snake.html'),'utf8'); assert.match(snake,/<header[^>]+><button id="resetButton"/);
  for(const file of ['public/app.js','public/fighter.js','src/tank-renderer.js']) assert.match(fs.readFileSync(require.resolve(`../${file}`),'utf8'),/isInteractiveTarget\(e(?:vent)?\.target\)/);
  for(const file of ['typing','wordle']) assert.match(fs.readFileSync(require.resolve(`../public/${file}.js`),'utf8'),/document\.activeElement\?\.closest\('\.arcade-topbar,\.arcade-debug-panel/);
  const env = platform(), input = env.header.querySelector('input'); assert.equal(env.context.ArcadePlatform.isInteractiveTarget(input),true);
  assert.equal(env.context.ArcadePlatform.isInteractiveTarget(env.document.createElement('canvas')),false);
});

test('toolbar styles are fluid: rem units, wrapping, collapsing labels, themes, motion, no fixed text widths', () => {
  const css = fs.readFileSync(require.resolve('../public/platform.css'),'utf8');
  const toolbar = css.slice(0, css.indexOf('/* Protocol debugger'));
  assert.match(css,/order:0/); assert.match(css,/flex-wrap:wrap!important/); assert.match(css,/text-transform:none/);
  assert.match(css,/@media \(max-width:40rem\)/); assert.match(css,/@media \(prefers-color-scheme:light\)/); assert.match(css,/@media \(prefers-reduced-motion:no-preference\)/);
  assert.match(css,/calc\(100dvh - var\(--arcade-topbar-height,3\.5rem\)\)/);
  assert.match(css,/--ab-target:max\(44px,2\.75rem\)/);
  assert.doesNotMatch(css,/platform-floating/); assert.doesNotMatch(css,/fonts\.googleapis/);
  assert.doesNotMatch(toolbar,/font(-size)?:[^;}]*\b\d+(\.\d+)?px/, 'font sizes are rem/em');
  assert.doesNotMatch(toolbar,/(^|[;{\s])(min-|max-)?width:(?!1px)\d+(\.\d+)?px/, 'no fixed pixel widths in the toolbar');
  assert.match(toolbar,/text-overflow:ellipsis/);
  assert.match(toolbar,/:focus-visible\{outline:2px solid/);
});

test('room picker lists games and occupancy, creates and joins rooms, and remembers selection', () => {
  const env=platform();const socket=env.connect();
  env.packet(socket,{type:'arcadeRooms',currentRoom:'room-a',rooms:[{id:'room-a',name:'Frosty Otters',path:'/',players:2},{id:'room-b',name:'Neon Geckos',path:'/snake',players:1}]});
  assert.equal(env.storage.get('arcade-room'),'room-a');
  assert.equal(env.header.querySelector('.arcade-current-room').textContent,'Frosty Otters');
  assert.match(env.header.querySelector('.arcade-rooms-toggle').getAttribute('aria-label'),/Current room: Frosty Otters/);
  const options=env.header.querySelectorAll('.arcade-room-option');
  assert.equal(options[0].disabled,true);assert.match(options[1].textContent,/Snake · 1 player/);
  options[1].onclick();assert.deepEqual(env.sent.pop(),{type:'joinRoom',id:'room-b'});
  env.header.querySelector('.arcade-create-room').onclick();assert.deepEqual(env.sent.pop(),{type:'createRoom'});
  const next=env.connect();assert.equal(new URL(next.url).searchParams.get('arcade'),'room-a');
  env.packet(next,{type:'roomJoined',id:'room-b',path:'/snake'});
  assert.equal(env.storage.get('arcade-room'),'room-b');assert.equal(env.context.location.assigned,'/snake');
});

test('leaving a cached page closes its sockets so it cannot keep old rooms occupied', () => {
  const env=platform(),socket=env.connect();
  env.document.listeners.pagehide[0]();assert.equal(socket.readyState,3);
  env.document.listeners.pageshow[0]({persisted:true});assert.equal(env.context.location.reloaded,true);
});

const registry = [{id:'a',name:'Whack-a-Math',url:'https://math.example/',icon:'https://math.example/i.png'},{id:'b',name:'Plain',url:'https://plain.example/',icon:null},{id:'c',name:'Bad',url:'javascript:alert(1)',icon:null}];

test('app switcher stays hidden when the server cannot read the registry', async () => {
  for (const fetchImpl of [async () => ok([]), async () => fail(502), async () => { throw new TypeError('offline'); }, async () => ok({oops:true})]) {
    const env = platform('board', false, {fetchImpl}); await tick();
    assert.equal(env.header.querySelector('.arcade-apps').hidden, true);
  }
});

test('app switcher lists the live apps from this origin, opens them in new tabs, and closes with Escape or an outside click', async () => {
  const calls = [], env = platform('board', false, {fetchImpl:async url => { calls.push(url); return String(url).startsWith('/api/') ? ok(registry) : Promise.reject(new TypeError('offline')); }});
  await tick();
  assert.deepEqual(calls.filter(url => url.startsWith('/')), ['/api/platform-apps']);
  const box = env.header.querySelector('.arcade-apps'), toggle = env.header.querySelector('.arcade-apps-toggle'), menu = env.header.querySelector('#arcade-apps-menu');
  assert.equal(box.hidden, false); assert.equal(toggle.getAttribute('aria-label'), 'Switch app'); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.parentElement.parentElement, env.header.querySelector('.arcade-end'));
  toggle.onclick(); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(menu.hidden, false);
  const tiles = env.header.querySelectorAll('.arcade-app-tile');
  assert.deepEqual(tiles.map(tile => tile.href), ['https://math.example/', 'https://plain.example/']);
  assert.ok(tiles.every(tile => tile.target === '_blank' && tile.rel === 'noopener noreferrer'));
  assert.match(tiles[0].textContent, /Whack-a-Math \(opens in a new tab\)/);
  assert.equal(tiles[0].querySelector('img').src, 'https://math.example/i.png'); assert.equal(tiles[1].querySelector('.arcade-app-letter').textContent, 'P');
  assert.equal(env.document.activeElement, tiles[0], 'focus moves into the menu');
  env.document.listeners.keydown[0]({key:'Escape', preventDefault() {}});
  assert.equal(menu.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(env.document.activeElement, toggle);
  toggle.onclick(); env.document.listeners.pointerdown[0]({target:env.document.body}); assert.equal(menu.hidden, true);
});

// --- optional login ---------------------------------------------------------------------------------------------------

const signedIn = {name:'Ada Lovelace', email:'ada@example.com'};
function authFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const key = `${options.method || 'GET'} ${String(url).replace('https://auth.hedgies.cloud', '')}`;
    calls.push(key);
    if (String(url).endsWith('/api/platform-apps')) return ok([]);
    const handler = handlers[key];
    if (!handler) throw new TypeError('Failed to fetch');
    return typeof handler === 'function' ? handler(options) : handler;
  };
  return {calls, fetchImpl};
}

test('a signed-in visitor sees their name in the toolbar and in the name field, and games get it without typing', async () => {
  const auth = authFetch({'GET /me':ok(signedIn)});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl}); env.connect(); await tick();
  assert.equal(env.storage.get('arcade-name'),'Ada Lovelace'); assert.equal(env.storage.get('arcade-name-source'),'account');
  assert.equal(env.header.querySelector('.arcade-name input').value,'Ada Lovelace');
  assert.equal(env.header.querySelector('.arcade-account-label').textContent,'Ada Lovelace');
  assert.equal(env.header.querySelector('.arcade-account-toggle').getAttribute('aria-label'),'Account: Ada Lovelace');
  assert.deepEqual(env.sent.filter(message => message.type === 'setName'),[{type:'setName',name:'Ada Lovelace'}],'an already-connected game learns the name');
});

test('a name typed by the visitor beats the account name for the whole session', async () => {
  const auth = authFetch({'GET /me':ok(signedIn)});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl}); env.connect(); await tick();
  const form = env.header.querySelector('form'), input = form.querySelector('input'); input.value = 'Zed'; form.onsubmit({preventDefault() {}});
  assert.equal(env.storage.get('arcade-name'),'Zed'); assert.equal(env.storage.get('arcade-name-source'),'manual');
  const next = env.document.createElement('header'); env.document.body.append(next); env.context.ArcadePlatform.mount(next,{game:'tank'});
  assert.equal(next.querySelector('input').value,'Zed');
});

test('a name typed before the page finished loading is kept and the account does not override it', async () => {
  const auth = authFetch({'GET /me':ok(signedIn)});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl}); env.storage.set('arcade-name','Early Bird'); env.connect(); await tick();
  assert.equal(env.storage.get('arcade-name'),'Early Bird'); assert.equal(env.sent.filter(message => message.type === 'setName').length,0);
});

test('logging out clears the name that came from the account and tells the server to forget it', async () => {
  const auth = authFetch({'GET /me':ok(signedIn),'POST /logout':{ok:true,status:204,json:async () => null}});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl}); env.connect(); await tick();
  env.header.querySelector('.arcade-account-toggle').onclick(); assert.equal(env.header.querySelector('#arcade-account-menu').hidden,false);
  assert.match(env.header.querySelector('#arcade-account-menu').textContent,/ada@example.com/);
  await env.header.querySelector('.arcade-logout').onclick(); await tick();
  assert.ok(auth.calls.includes('POST /logout'));
  assert.equal(env.storage.get('arcade-name'),undefined); assert.equal(env.header.querySelector('.arcade-name input').value,'');
  assert.deepEqual(env.sent.at(-1),{type:'setName',name:''});
  assert.equal(env.header.querySelector('.arcade-account-label').textContent,'Log in');
});

test('anonymous play is unchanged when the auth service says 401, is down, or is slow', async () => {
  const unauthenticated = authFetch({'GET /me':fail(401,'Not signed in'),'POST /refresh':fail(401,'No session')});
  const a = platform('snake', false, {fetchImpl:unauthenticated.fetchImpl}); a.connect(); await tick(); await tick();
  assert.deepEqual(unauthenticated.calls.filter(call => !call.includes('platform-apps')),['GET /me','POST /refresh']);
  assert.equal(a.header.querySelector('.arcade-account-label').textContent,'Log in'); assert.equal(a.header.querySelector('.arcade-name input').value,''); assert.equal(a.sent.length,0);
  const down = platform('snake'); down.connect(); await tick();
  assert.equal(down.header.querySelector('.arcade-account-label').textContent,'Log in');
  let release; const slow = platform('snake', false, {fetchImpl:url => String(url).endsWith('/api/platform-apps') ? ok([]) : new Promise(resolve => { release = resolve; })});
  slow.connect(); const form = slow.header.querySelector('form'), input = form.querySelector('input'); input.value = 'Quick'; form.onsubmit({preventDefault() {}});
  assert.deepEqual(slow.sent,[{type:'setName',name:'Quick'}],'a game works while the auth call is still pending');
  assert.equal(slow.header.querySelector('.arcade-account-label').textContent,'Log in');
  release?.(fail(401,'late'));
});

test('the login dialog is a labelled modal that traps focus, closes with Escape and returns focus', async () => {
  const env = platform('snake'); await tick();
  const opener = env.header.querySelector('.arcade-account-toggle'); assert.ok(opener.title.length > 0);
  opener.onclick(); const layer = env.header.querySelector('.arcade-modal'), dialog = env.header.querySelector('.arcade-dialog');
  assert.equal(layer.hidden,false); assert.equal(dialog.getAttribute('role'),'dialog'); assert.equal(dialog.getAttribute('aria-modal'),'true'); assert.equal(dialog.getAttribute('aria-labelledby'),'arcade-login-title');
  assert.equal(env.document.activeElement.id,'arcade-login-id');
  for (const label of ['arcade-login-id','arcade-login-password']) assert.ok(env.header.querySelectorAll('label').some(node => node.getAttribute('for') === label), `${label} has a label`);
  assert.equal(env.header.querySelector('[data-provider=google]').href,`https://auth.hedgies.cloud/google/start?return_to=${encodeURIComponent('https://arcade.test/snake')}`);
  assert.match(env.header.querySelector('[data-provider=microsoft]').href,/\/microsoft\/start\?return_to=/);
  assert.equal(env.header.querySelectorAll('input').some(input => /sign.?up|register/i.test(input.name || '')),false,'no sign-up form');
  const items = [...dialog.querySelectorAll('a[href],button,input')].filter(node => !node.disabled && !node.closest('[hidden]'));
  items.at(-1).focus(); layer.onkeydown({key:'Tab',shiftKey:false,preventDefault() {}}); assert.equal(env.document.activeElement,items[0]);
  items[0].focus(); layer.onkeydown({key:'Tab',shiftKey:true,preventDefault() {}}); assert.equal(env.document.activeElement,items.at(-1));
  env.document.listeners.keydown[0]({key:'Escape',preventDefault() {}}); assert.equal(layer.hidden,true); assert.equal(env.document.activeElement,opener);
});

test('logging in shows the server message on 401, 403 and 429, and signs in on success', async () => {
  let reply = fail(401,'Invalid email or password'); let meCalls = 0;
  const auth = authFetch({'GET /me':() => (++meCalls === 1 ? fail(401,'no') : ok(signedIn)),'POST /refresh':fail(401,'no'),'POST /login':() => reply});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl}); env.connect(); await tick(); await tick();
  env.header.querySelector('.arcade-account-toggle').onclick();
  const form = env.header.querySelector('.arcade-login-form'), message = env.header.querySelector('.arcade-form-message');
  form.onsubmit({preventDefault() {}}); assert.match(message.textContent,/Enter your email or username/);
  const id = env.header.querySelector('#arcade-login-id'), pw = env.header.querySelector('#arcade-login-password');
  for (const [response, text] of [[fail(401,'Invalid email or password'),/Invalid email or password/],[fail(403,'Your account is waiting for an administrator to enable it.'),/waiting for an administrator/],[fail(429,'Too many failed sign-in attempts. Try again in five minutes.'),/Too many failed/]]) {
    reply = response; id.value = 'ada'; pw.value = 'secret'; form.onsubmit({preventDefault() {}}); await tick(); await tick();
    assert.match(message.textContent,text); assert.equal(env.header.querySelector('.arcade-modal').hidden,false); assert.equal(pw.value,'','the password is cleared after a failure');
  }
  reply = ok(signedIn); id.value = 'ada'; pw.value = 'secret'; form.onsubmit({preventDefault() {}}); await tick(); await tick(); await tick();
  assert.equal(env.header.querySelector('.arcade-modal').hidden,true); assert.equal(env.storage.get('arcade-name'),'Ada Lovelace'); assert.equal(env.header.querySelector('.arcade-account-label').textContent,'Ada Lovelace');
  assert.ok(env.sent.some(item => item.type === 'setName' && item.name === 'Ada Lovelace'));
});

test('forgot password posts the email with the return address and never reveals whether an account exists', async () => {
  const bodies = []; const auth = authFetch({'POST /forgot-password':options => { bodies.push(JSON.parse(options.body)); return ok({}); }});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl}); await tick();
  env.header.querySelector('.arcade-account-toggle').onclick(); env.header.querySelector('.arcade-forgot').onclick();
  assert.equal(env.header.querySelector('.arcade-password-field').hidden,true);
  env.header.querySelector('#arcade-login-id').value = 'ada@example.com'; env.header.querySelector('.arcade-login-form').onsubmit({preventDefault() {}}); await tick(); await tick();
  assert.deepEqual(bodies,[{email:'ada@example.com',return_to:'https://arcade.test/snake'}]);
  assert.match(env.header.querySelector('.arcade-form-message').textContent,/If that address has an account/);
});

test('a failed OAuth return is reported in the dialog and removed from the address', async () => {
  const auth = authFetch({'GET /me':fail(401,'no'),'POST /refresh':fail(401,'no')});
  const env = platform('snake', false, {fetchImpl:auth.fetchImpl, query:'?room=a&auth_error=account_disabled'}); await tick(); await tick();
  assert.deepEqual(env.replaced.map(args => args[2]),['/snake?room=a']);
  assert.equal(env.header.querySelector('.arcade-modal').hidden,false);
  assert.match(env.header.querySelector('.arcade-form-message').textContent,/waiting for an administrator/);
});
