#!/usr/bin/env node
'use strict';

// Captures the shared toolbar at 1280, 768 and 320 CSS pixels wide (the narrow ones as real iframes, so their media queries
// see the narrow viewport) into public/screenshots/toolbar.png. Needs Chrome or Chromium (CHROME_BIN overrides the search).
// Usage: node scripts/capture-toolbar.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'public/screenshots/toolbar.png');
const SHOTS = [
  { title: '1280 px', width: 1280, height: 260, game: 'snake' },
  { title: '768 px', width: 768, height: 260, game: 'wordle' },
  { title: '320 px', width: 320, height: 260, game: 'snake' },
  { title: '320 px, log in', width: 320, height: 260, game: 'poll', query: '?auth_error=access_denied' }
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Install Chrome or Chromium, or set CHROME_BIN to its executable.');
  return found;
}

async function main() {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), APPS_URL: '' }, stdio: 'ignore' });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-toolbar-'));
  try {
    await pause(1500);
    const gap = 24;
    const frames = SHOTS.map(shot => `<figure${shot.width > 1000 ? ' style="flex-basis:100%"' : ''}><figcaption>${shot.title}</figcaption><iframe title="${shot.title}" width="${shot.width}" height="${shot.height}" src="http://127.0.0.1:${port}/${shot.game}${shot.query || ''}"></iframe></figure>`).join('');
    const page = path.join(temporary, 'toolbar.html');
    fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:${gap}px;background:#d9ded4;font:600 14px system-ui;display:flex;flex-wrap:wrap;gap:${gap}px;align-items:flex-start}figure{margin:0}figcaption{margin:0 0 6px;color:#26332b}iframe{display:block;border:0;background:#fff;box-shadow:0 2px 10px #0003}</style>${frames}`);
    const chrome = findChrome();
    const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${path.join(temporary, 'profile')}`,
      '--window-size=1380,900', '--virtual-time-budget=12000', `--screenshot=${path.join(temporary, 'out.png')}`, `file:///${page.replace(/\\/g, '/')}`], { stdio: 'ignore', timeout: 90000 });
    if (!fs.existsSync(path.join(temporary, 'out.png'))) throw new Error(`Chrome produced no screenshot (exit ${run.status})`);
    fs.copyFileSync(path.join(temporary, 'out.png'), OUTPUT);
    console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
  } finally { server.kill(); fs.rmSync(temporary, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exit(1); });
