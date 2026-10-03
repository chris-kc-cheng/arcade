const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// A small, dependency-free DOM model executes the real platform script. Layout is
// intentionally not emulated; responsive geometry still requires browser QA.
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {setProperty() {}}; this.hidden = false; this.disabled = false; this.listeners = {}; this._text = ''; }
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
      for (const match of part.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(match[1], match[2] ?? '');
      stack.at(-1).append(node); if (!['input','br','img','meta','link'].includes(tag)) stack.push(node);
    }
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'hidden') this.hidden = true; if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
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
function platform(game = 'board', legacy = false) {
  const document = {listeners:{}, activeElement:null, createElement(tag) { return new Element(tag, this); }, addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }};
  document.body = document.createElement('body'); document.documentElement = document.createElement('html'); document.documentElement.append(document.body);
  document.querySelector = selector => document.body.querySelector(selector);
  const header = document.createElement('header'); header.setAttribute('data-arcade-game', game); document.body.append(header);
  let reset;
  if (legacy) { reset = document.createElement('button'); reset.id = game === 'snake' ? 'resetButton' : 'reset'; reset.textContent = 'RESET MATCH'; reset.disabled = true; header.append(reset); }
  const sent = [], prompts = [], sockets = [], timers = new Map(), storage = new Map(); let nextTimer = 0;
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.listeners = {}; sockets.push(this); }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    emit(type, event = {}) { if (type === 'open') this.readyState = 1; if (type === 'close') this.readyState = 3; this.listeners[type]?.forEach(callback => callback(event)); }
    send(data) { sent.push(JSON.parse(data)); }
  }
  const context = {document, WebSocket:FakeSocket, TextEncoder, Date, sessionStorage:{getItem:key => storage.get(key), setItem:(key,value) => storage.set(key,value)}, confirm:message => { prompts.push(message); return context.approve; }, approve:true, setInterval:callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearInterval:id => timers.delete(id), ResizeObserver:class {observe() {} disconnect() {}}, location:{pathname:game === 'board' ? '/' : `/${game}`}};
  context.window = context; vm.runInNewContext(fs.readFileSync(require.resolve('../public/platform.js'), 'utf8'), context);
  return {context, document, header, reset, sent, prompts, sockets, storage, timers, connect() { const socket = new context.WebSocket('ws://localhost/?room=test'); socket.emit('open'); return socket; }, packet(socket, message) { socket.emit('message',{data:JSON.stringify(message)}); }};
}
const routes = ['board','tank','penalty','fighter','snake','bigtwo','typing','wordle','poll'];

test('all nine games mount one identical shared shell and current route', () => {
  const signature = node => `${node.tagName}.${node.className}[${node.children.map(signature).join(',')}]`;
  let expected;
  for (const game of routes) {
    const env = platform(game); const {header,document,context} = env;
    const api = context.ArcadePlatform.mount(header,{game});
    const links = header.querySelectorAll('.arcade-nav a'); assert.equal(links.length,9);
    assert.equal(links.filter(link => link.getAttribute('aria-current') === 'page').length,1);
    assert.equal(links.find(link => link.getAttribute('aria-current') === 'page').href,game === 'board' ? '/' : `/${game}`);
    links.forEach(link => assert.ok(link.getAttribute('aria-label')));
    const shape = signature(header).replace(/A\.active/g,'A.'); expected ??= shape; assert.equal(shape,expected,game);
    assert.equal(header.querySelectorAll('.arcade-name').length,1); assert.equal(header.querySelectorAll('.arcade-presence').length,1);
    assert.equal(document.body.querySelectorAll('.arcade-debug-panel').length,1);
    assert.equal(context.ArcadePlatform.mount(header,{game}),api,'mounting twice is idempotent');
    assert.equal(env.timers.size,1);
  }
});

test('navigation confirms once, sends only through the active socket, and does not navigate locally', () => {
  const env = platform('bigtwo'), link = env.header.querySelectorAll('a')[0]; let prevented = 0;
  const click = () => link.onclick({preventDefault() { prevented++; }});
  click(); assert.equal(env.sent.length,0); assert.equal(env.prompts.length,0);
  const old = env.connect(); env.context.approve = false; click(); assert.equal(env.sent.length,0);
  env.context.approve = true; click(); assert.deepEqual(env.sent,[{type:'switchGame',path:'/'}]);
  const current = env.connect(); old.emit('close'); click(); assert.equal(env.sent.length,2);
  current.emit('close'); click(); assert.equal(env.sent.length,2); assert.equal(prevented,5);
});

test('presence shows all required fields safely, room count, focus/hover, and disconnect cleanup', () => {
  const env = platform('board'), socket = env.connect(), badge = env.header.querySelector('.arcade-presence-toggle'), details = env.header.querySelector('.arcade-player-details'), presence = env.header.querySelector('.arcade-presence');
  env.packet(socket,{type:'platformPresence',players:[{id:'1',name:'<img onerror=alert(1)>',ip:'127.0.0.1',room:'doodle',connectedAt:Date.now()-62000},{id:'2',name:'Other',ip:'127.0.0.2',room:'snake',connectedAt:Date.now()-1000}]});
  assert.equal(badge.querySelector('strong').textContent,'2'); assert.equal(badge.querySelector('span').textContent,'1 HERE');
  assert.match(details.textContent,/<img onerror=alert\(1\)>127.0.0.1 · doodle · connected 1m ago/); assert.equal(details.querySelector('img'),null);
  assert.equal(details.getAttribute('tabindex'),'0');
  presence.onfocusin(); assert.equal(details.hidden,false); assert.equal(badge.getAttribute('aria-expanded'),'true');
  env.document.listeners.keydown[0]({key:'Escape'}); assert.equal(details.hidden,true);
  presence.onmouseenter(); assert.equal(details.hidden,false); presence.onmouseleave(); assert.equal(details.hidden,true);
  env.context.ArcadePlatform.setRoomCount(4); assert.equal(badge.querySelector('span').textContent,'4 HERE');
  socket.emit('close'); assert.equal(badge.querySelector('strong').textContent,'0'); assert.equal(badge.querySelector('span').textContent,'0 HERE');
});

test('username sends a single normalized session name and locks across remounts', () => {
  const env = platform(), form = env.header.querySelector('form'), input = form.querySelector('input');
  assert.equal(input.disabled,true); env.connect(); input.value = '  Ada   Player  '; form.onsubmit({preventDefault() {}});
  assert.deepEqual(env.sent,[{type:'setName',name:'Ada Player'}]); assert.equal(input.disabled,true);
  input.value = 'Different'; form.onsubmit({preventDefault() {}}); assert.equal(env.sent.length,1);
  const next = env.document.createElement('header'); env.document.body.append(next); env.context.ArcadePlatform.mount(next,{game:'tank'});
  assert.equal(next.querySelector('input').value,'Ada Player'); assert.equal(next.querySelector('input').disabled,true);
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
  const env = platform(), socket = env.connect(), toggle = env.header.querySelector('.arcade-debug-toggle');
  for(let i=0;i<300;i++) env.packet(socket,{type:'sample',value:i});
  toggle.onclick(); const panel = env.document.querySelector('.arcade-debug-panel'), list = panel.querySelector('.arcade-debug-list');
  assert.equal(panel.hidden,false); assert.equal(list.children.length,250); assert.equal(panel.querySelector('[data-received-messages]').textContent,'300');
  socket.send(JSON.stringify({type:'chat',text:'é'})); assert.match(panel.querySelector('[data-sent-bytes]').textContent,/B$/); assert.equal(list.children.length,250);
  panel.querySelector('.arcade-debug-clear').onclick(); assert.equal(list.children.length,0); assert.equal(panel.querySelector('[data-received-messages]').textContent,'0');
  env.document.listeners.keydown[0]({key:'Escape',preventDefault() {}}); assert.equal(panel.hidden,true); assert.equal(env.document.activeElement,toggle);
});

test('legacy entry points delegate shared features and game shortcuts respect navigation', () => {
  for(const game of ['fighter','snake','bigtwo','typing','wordle','poll']) {
    const html = fs.readFileSync(require.resolve(`../public/${game}.html`),'utf8');
    assert.match(html,new RegExp(`<header class="arcade-topbar" data-arcade-game="${game}">`));
    assert.doesNotMatch(html,/<nav|id="connection"|id="pollPresence"|id="fighterName"/);
  }
  const snake = fs.readFileSync(require.resolve('../public/snake.html'),'utf8'); assert.match(snake,/<header[^>]+><button id="resetButton"/);
  for(const file of ['public/app.js','public/fighter.js','src/tank-renderer.js']) assert.match(fs.readFileSync(require.resolve(`../${file}`),'utf8'),/isInteractiveTarget\(e(?:vent)?\.target\)/);
  for(const file of ['typing','wordle']) assert.match(fs.readFileSync(require.resolve(`../public/${file}.js`),'utf8'),/document\.activeElement\?\.closest\('\.arcade-topbar,\.arcade-debug-panel/);
  const env = platform(), input = env.header.querySelector('input'); assert.equal(env.context.ArcadePlatform.isInteractiveTarget(input),true);
  assert.equal(env.context.ArcadePlatform.isInteractiveTarget(env.document.createElement('canvas')),false);
});

test('shared styles neutralize legacy header layout and reserve responsive game space', () => {
  const css = fs.readFileSync(require.resolve('../public/platform.css'),'utf8');
  assert.match(css,/order:0!important/);
  assert.match(css,/flex-wrap:nowrap!important;width:auto!important/);
  assert.match(css,/text-transform:none!important/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/calc\(100dvh - var\(--arcade-topbar-height,76px\)\)/);
  assert.doesNotMatch(css,/platform-floating/);
});
