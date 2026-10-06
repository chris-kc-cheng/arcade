#!/usr/bin/env node
'use strict';

// Capture the real app from an isolated local server. Fixtures enter through its
// normal WebSocket protocol; no DOM, canvas, score, or game-state mock is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const net = require('node:net');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const GAMES = ['board', 'tank', 'penalty', 'fighter', 'snake', 'bigtwo', 'typing', 'wordle', 'poll', 'cube'];
const WIDTH = 1920, HEIGHT = 1080;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function dimensions(file) {
  const data = fs.readFileSync(file);
  if (file.endsWith('.png')) {
    if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`Invalid PNG: ${file}`);
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    if (!width || !height) throw new Error(`Invalid PNG dimensions: ${file}`);
    return { width, height };
  }
  const root = data.toString().match(/<svg\b[^>]*>/)?.[0];
  const width = Number(root?.match(/\bwidth="(\d+)"/)?.[1]);
  const height = Number(root?.match(/\bheight="(\d+)"/)?.[1]);
  if (!width || !height) throw new Error(`Missing SVG dimensions: ${file}`);
  return { width, height };
}

function checkShowcase(root = ROOT) {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const images = [...readme.matchAll(/<img\b[^>]*src="(public\/screenshots\/([^".]+)\.(?:png|svg))"[^>]*>/g)];
  if (images.length !== GAMES.length) throw new Error('README must showcase exactly ten experiences');
  let common;
  const found = new Set();
  for (const [tag, source, game] of images) {
    if (!GAMES.includes(game) || found.has(game)) throw new Error(`Unknown or duplicate screenshot: ${game}`);
    found.add(game);
    if (!/\bwidth="320"/.test(tag) || !/\bheight="180"/.test(tag)) throw new Error(`${game}: thumbnail must be 320×180`);
    const size = dimensions(path.join(root, source));
    if (size.width * 9 !== size.height * 16) throw new Error(`${game}: source must have a 16:9 aspect ratio`);
    common ||= size;
    if (size.width !== common.width || size.height !== common.height) throw new Error(`${game}: source dimensions differ from other previews`);
  }
  return { count: images.length, ...common };
}

async function waitFor(check, description, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await pause(60);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.handlers = [];
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      } else this.handlers.forEach(handler => handler(message));
    });
  }
  call(method, params = {}, sessionId) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function freePort() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}

async function capture() {
  const browser = process.env.CHROME_BIN || ['chromium', 'google-chrome', 'chromium-browser'].find(name => spawnSync('which', [name]).status === 0);
  if (!browser) throw new Error('Install Chrome/Chromium, or set CHROME_BIN to its executable.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-screenshots-'));
  const staging = path.join(temporary, 'screenshots'); fs.mkdirSync(staging);
  const children = [], peers = new Set(); let cdp;
  const cleanup = () => { peers.forEach(peer => peer.socket.close()); cdp?.socket.close(); children.forEach(child => child.kill()); };
  process.once('SIGINT', cleanup); process.once('SIGTERM', cleanup);
  try {
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(server);
    let serverOutput = '', serverError; server.on('error', error => serverError = error); server.stdout.on('data', chunk => serverOutput += chunk); server.stderr.on('data', chunk => serverOutput += chunk);
    await waitFor(() => {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error(`Local server failed: ${serverOutput}`);
      return serverOutput.includes('Doodle Together is live');
    }, 'local server');
    const flags = ['--headless', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${path.join(temporary, 'profile')}`, 'about:blank'];
    if (process.env.CHROME_NO_SANDBOX === '1') flags.unshift('--no-sandbox');
    const chrome = spawn(browser, flags, { stdio: ['ignore', 'ignore', 'pipe'] }); children.push(chrome);
    let browserOutput = '', browserError; chrome.on('error', error => browserError = error); chrome.stderr.on('data', chunk => browserOutput += chunk);
    const endpoint = await waitFor(() => {
      if (browserError) throw browserError;
      if (chrome.exitCode !== null || chrome.signalCode) throw new Error(`Chromium could not start: ${browserOutput}`);
      return browserOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    }, 'Chromium debugging endpoint');
    const transport = new WebSocket(endpoint); await once(transport, 'open'); cdp = new CDP(transport);

    async function peer(room, name, extra = {}) {
      const params = new URLSearchParams({ room, client: `capture-${randomUUID()}`, ...extra });
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?${params}`), messages = {};
      socket.on('message', raw => { const message = JSON.parse(raw); messages[message.type] = message; });
      const actor = { socket, messages, send: message => socket.send(JSON.stringify(message)) }; peers.add(actor);
      await once(socket, 'open'); actor.send({ type: 'setName', name }); return actor;
    }
    async function page(route, name = 'Alex') {
      const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
      const call = (method, params) => cdp.call(method, params, sessionId), errors = [];
      cdp.handlers.push(event => { if (event.sessionId === sessionId && event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text); });
      await call('Page.enable'); await call('Runtime.enable');
      await call('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
      // Only the isolated synthetic capture tab gets this protocol observer.
      await call('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('arcade-name',${JSON.stringify(name)}); sessionStorage.setItem('arcade-client','capture-'+crypto.randomUUID()); window.__capture={sockets:[],messages:{}}; const CaptureSocket=window.WebSocket; window.WebSocket=class extends CaptureSocket { constructor(...args){super(...args);window.__capture.sockets.push(this);this.addEventListener('message',event=>{try{const m=JSON.parse(event.data);window.__capture.messages[m.type]=m;}catch{}});} };` });
      const evaluate = async expression => {
        const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) throw new Error(`Capture browser evaluation failed: ${response.exceptionDetails.text}`);
        return response.result.value;
      };
      await call('Page.navigate', { url: origin + route });
      await waitFor(() => evaluate(`document.readyState==='complete' && !!document.querySelector('.arcade-nav')`), `page ${route}`);
      await evaluate('document.fonts.ready.then(()=>true)');
      const actor = {
        call, evaluate, errors,
        send: message => evaluate(`window.__capture.sockets.find(s=>s.readyState===1).send(${JSON.stringify(JSON.stringify(message))})`),
        state: type => evaluate(`window.__capture.messages[${JSON.stringify(type)}]`),
        close: () => cdp.call('Target.closeTarget', { targetId })
      };
      await waitFor(() => evaluate('window.__capture.sockets.some(s=>s.readyState===1)'), 'live WebSocket');
      return actor;
    }
    const evidence = [];
    for (const game of GAMES) {
      const route = game === 'board' ? '/' : `/${game}`;
      const coordinator = await peer('doodle', 'Capture coordinator');
      coordinator.send({ type: 'switchGame', path: route }); await pause(100); coordinator.socket.close(); peers.delete(coordinator);
      let tab;
      if (game === 'poll') {
        const lobby = await peer('poll', 'Poll host'); lobby.send({ type: 'createPoll', question: 'What should we play next?', choices: ['Tank arena', 'Line Fighter', 'Big-D card room'] });
        const created = await waitFor(() => lobby.messages.pollCreated, 'new poll');
        const host = await peer('poll', 'Poll host', { poll: created.id, creator: created.creatorToken });
        tab = await page(`/poll?id=${created.id}`);
        await waitFor(() => tab.state('pollState'), 'poll state');
        for (const [index, name] of ['Sam', 'Jo', 'Riley'].entries()) {
          const voter = await peer('poll', name, { poll: created.id }); voter.send({ type: 'vote', choice: index % 2 });
        }
        await tab.send({ type: 'vote', choice: 0 });
        await waitFor(async () => (await tab.state('pollState'))?.submitted === 4, 'four poll votes');
        host.send({ type: 'showResults', creatorToken: created.creatorToken });
        await waitFor(async () => (await tab.state('pollState'))?.showingResults, 'poll results');
      } else {
        tab = await page(route);
        if (game === 'cube') {
          await waitFor(() => tab.state('cubeState'), 'cube state');
          await tab.send({type:'scramble'}); await peer('cube', 'Sam');
        } else if (game === 'board') {
          const sam = await peer('doodle', 'Sam'), jo = await peer('doodle', 'Jo');
          const stroke = async (actor, points, size = 5) => {
            for (let i = 1; i < points.length; i++) actor.send({ type: 'stroke', from: { x: points[i-1][0], y: points[i-1][1] }, to: { x: points[i][0], y: points[i][1] }, size, tool: 'pen' });
          };
          await stroke(sam, [[.12,.72],[.12,.4],[.23,.27],[.34,.4],[.34,.72],[.12,.72],[.46,.72],[.46,.34],[.57,.34],[.57,.72],[.7,.72],[.7,.48],[.82,.48],[.82,.72]], 6);
          await stroke(jo, [[.16,.49],[.2,.49],[.2,.55],[.16,.55],[.16,.49]]);
          await stroke(jo, [[.26,.49],[.3,.49],[.3,.55],[.26,.55],[.26,.49]]);
          await stroke(jo, Array.from({ length: 49 }, (_, i) => [.75 + Math.cos(i/48*Math.PI*2)*.055, .22 + Math.sin(i/48*Math.PI*2)*.075]), 6);
          sam.send({ type: 'chat', text: 'Our next arcade world?' }); jo.send({ type: 'chat', text: 'I added the sunshine!' });
          sam.send({ type: 'cursor', point: { x: .35, y: .4 } }); jo.send({ type: 'cursor', point: { x: .81, y: .24 } });
        } else if (game === 'tank') {
          await peer('tanks', 'Sam'); await peer('tanks', 'Jo');
          await waitFor(async () => (await tab.state('tankState'))?.players.length === 3, 'tank players');
        } else if (game === 'penalty') {
          const sam = await peer('penalty', 'Sam');
          await waitFor(async () => (await tab.state('penaltyState'))?.game.phase === 'choosing', 'penalty match');
          await tab.send({ type: 'penaltyChoose', zone: 'top-left' }); sam.send({ type: 'penaltyChoose', zone: 'bottom-right' });
          await waitFor(async () => (await tab.state('penaltyState'))?.game.phase === 'result', 'penalty result');
        } else if (game === 'fighter') {
          const sam = await peer('fighter', 'Sam');
          await tab.send({ type: 'fighterInput', right: true }); sam.send({ type: 'fighterInput', left: true }); await pause(400);
          await tab.send({ type: 'fighterInput' }); sam.send({ type: 'fighterInput' });
          await tab.send({ type: 'fighterCombo', combo: 'hadoken' });
        } else if (game === 'snake') {
          await peer('snake', 'Sam'); await peer('snake', 'Jo'); await tab.send({ type: 'snakeStart' });
        } else if (game === 'bigtwo') {
          const others = await Promise.all(['Sam', 'Jo', 'Riley'].map(name => peer('bigtwo', name)));
          const state = await waitFor(async () => { const value = await tab.state('bigTwoState'); return value?.onlineCount === 4 && value.players.every(player => !player.computer) && value; }, 'four card players');
          if (state.turn === state.selfId) await tab.send({ type: 'play', cards: [state.openingCard] });
          else {
            const starter = await waitFor(() => others.find(actor => actor.messages.bigTwoState?.selfId === state.turn), 'opening card holder');
            starter.send({ type: 'play', cards: [state.openingCard] });
          }
        } else if (game === 'typing') {
          const sam = await peer('typing', 'Sam');
          const state = await waitFor(async () => { const value = await tab.state('typingState'); return value?.phase === 'racing' && value; }, 'typing countdown');
          for (let count = 1; count <= 52; count++) {
            await tab.send({ type: 'input', value: state.paragraph.slice(0, count) });
            if (count <= 37) sam.send({ type: 'input', value: state.paragraph.slice(0, count) });
            await pause(25);
          }
        } else if (game === 'wordle') {
          await waitFor(() => tab.state('wordleState'), 'word puzzle');
          for (const word of ['crane', 'spoil']) { await tab.send({ type: 'guess', word }); await pause(100); }
        }
      }
      await pause(game === 'fighter' ? 150 : 350);
      await tab.evaluate('document.activeElement?.blur(); window.scrollTo(0,0)');
      const navigation = await tab.evaluate(`({ path:location.pathname, links:[...document.querySelectorAll('.arcade-nav a')].map(a=>({href:a.getAttribute('href'),current:a.getAttribute('aria-current')})), header:document.querySelector('header').getBoundingClientRect().toJSON(), scrollWidth:document.documentElement.scrollWidth })`);
      if (tab.errors.length) throw new Error(`${game}: browser exceptions: ${tab.errors.join(', ')}`);
      if (navigation.path !== route || navigation.links.length !== GAMES.length || navigation.links.filter(link => link.current === 'page').length !== 1) throw new Error(`${game}: navigation is not ready`);
      if (navigation.header.top < 0 || navigation.header.right > WIDTH + 1 || navigation.scrollWidth > WIDTH) throw new Error(`${game}: header or page overflows the capture viewport`);
      const shot = await tab.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(staging, `${game}.png`), Buffer.from(shot.data, 'base64'));
      const size = dimensions(path.join(staging, `${game}.png`));
      if (size.width !== WIDTH || size.height !== HEIGHT) throw new Error(`${game}: wrong screenshot size`);
      evidence.push({ game, route, width: WIDTH, height: HEIGHT, syntheticParticipants: true, navigation });
      console.log(`Captured ${game} at ${WIDTH}×${HEIGHT}`);
      await tab.close(); peers.forEach(actor => actor.socket.close()); peers.clear();
    }
    // Publish only after every genuine browser capture has passed validation.
    for (const game of GAMES) fs.copyFileSync(path.join(staging, `${game}.png`), path.join(ROOT, 'public/screenshots', `${game}.png`));
    let readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    readme = readme.replace(/public\/screenshots\/(typing|wordle|poll)\.svg/g, 'public/screenshots/$1.png');
    readme = readme.replace(/(alt="[^"]*) illustration"/g, '$1 screenshot"');
    readme = readme.replace(/<!-- screenshot-status:start -->[\s\S]*?<!-- screenshot-status:end -->/, `<!-- screenshot-status:start -->\nAll ten previews are actual local app captures at ${WIDTH}×${HEIGHT}, using synthetic test players. Every thumbnail is displayed at 320×180.\n<!-- screenshot-status:end -->`);
    fs.writeFileSync(path.join(ROOT, 'README.md'), readme);
    fs.writeFileSync(path.join(ROOT, 'public/screenshots/capture-manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), method: 'Chromium CDP, local server, 100% scale', scenes: evidence }, null, 2) + '\n');
    checkShowcase();
  } finally {
    cleanup(); process.removeListener('SIGINT', cleanup); process.removeListener('SIGTERM', cleanup);
    await pause(200); fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (process.argv.includes('--check')) console.log(checkShowcase());
  else capture().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { GAMES, dimensions, checkShowcase };
