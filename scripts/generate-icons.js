#!/usr/bin/env node
'use strict';

// Renders the Arcade app icon set from one drawing (a joystick on evergreen):
//   public/icons/arcade.svg, public/favicon.svg        vector sources (rounded, transparent corners)
//   public/icons/arcade-{192,512}.png                  "any" PWA icons with rounded corners
//   public/icons/arcade-maskable-{192,512}.png         opaque, full-bleed, artwork inside the central 80% safe circle
//   public/apple-touch-icon.png                        opaque 180 x 180
//   public/favicon.ico                                 16, 32 and 48 px PNG frames
// Usage: node scripts/generate-icons.js     (needs Chrome or Chromium: set CHROME_BIN if it is not found automatically)
// The PNGs are rasterised by headless Chrome from the SVG, so nothing is drawn or edited by hand.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const ICONS = path.join(PUBLIC, 'icons');
const GREEN = '#0f2723', LIME = '#b9f36b', CORAL = '#ff8f73';

const MARK = `<rect x="29" y="25" width="6" height="19" rx="3" fill="${LIME}"/><circle cx="32" cy="19" r="10" fill="${LIME}"/><rect x="10" y="40" width="44" height="14" rx="7" fill="${LIME}"/><circle cx="21" cy="47" r="2.6" fill="${CORAL}"/><circle cx="43" cy="47" r="2.6" fill="${GREEN}"/>`;
const centered = scale => `<g transform="translate(32 32) scale(${scale}) translate(-32 -31.5)">${MARK}</g>`;

function svg({ rounded = true, scale = 1, size = 512 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-labelledby="title desc">
  <title id="title">Arcade joystick</title>
  <desc id="desc">A lime-green arcade joystick with a round ball top and a coral button, on evergreen.</desc>
  <rect width="64" height="64"${rounded ? ' rx="14"' : ''} fill="${GREEN}"/>
  ${scale === 1 ? `<g>${MARK}</g>` : centered(scale)}
</svg>
`;
}

function findChrome() {
  const candidates = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!found) throw new Error('Install Chrome or Chromium, or set CHROME_BIN to its executable.');
  return found;
}

function pngSize(file) {
  const data = fs.readFileSync(file);
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Not a PNG: ${file}`);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function render(chrome, source, destination, size, transparent, temporary) {
  const page = path.join(temporary, `page-${size}-${path.basename(destination)}.html`);
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source.replace(/ width="\d+" height="\d+"/, '')}`);
  const output = path.join(temporary, `out-${size}-${path.basename(destination)}`);
  const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${path.join(temporary, 'profile')}`,
    ...(transparent ? ['--default-background-color=00000000'] : []), `--window-size=${size},${size}`, `--screenshot=${output}`, `file:///${page.replace(/\\/g, '/')}`], { stdio: 'ignore', timeout: 60000 });
  if (!fs.existsSync(output)) throw new Error(`Chrome produced no image for ${path.basename(destination)} (exit ${run.status})`);
  const [width, height] = pngSize(output);
  if (width !== size || height !== size) throw new Error(`${path.basename(destination)} rendered ${width}x${height}, expected ${size}x${size}. Chrome clamps tiny windows; try a newer Chrome.`);
  fs.copyFileSync(output, destination);
}

function ico(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size; header[entry + 1] = size; header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += data.length;
  });
  return Buffer.concat([header, ...frames.map(frame => frame.data)]);
}

function main() {
  const chrome = findChrome();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-icons-'));
  try {
    fs.writeFileSync(path.join(ICONS, 'arcade.svg'), svg());
    fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), svg({ size: 64 }));
    const rounded = svg(), maskable = svg({ rounded: false, scale: 0.8 }), apple = svg({ rounded: false, scale: 0.9 });
    for (const size of [192, 512]) {
      render(chrome, rounded, path.join(ICONS, `arcade-${size}.png`), size, true, temporary);
      render(chrome, maskable, path.join(ICONS, `arcade-maskable-${size}.png`), size, false, temporary);
    }
    render(chrome, apple, path.join(PUBLIC, 'apple-touch-icon.png'), 180, false, temporary);
    const frames = [16, 32, 48].map(size => {
      // Small sizes draw the mark a little larger so it stays readable at 16 px.
      const destination = path.join(temporary, `favicon-${size}.png`);
      render(chrome, svg({ scale: size < 48 ? 1.12 : 1 }), destination, size, true, temporary);
      return { size, data: fs.readFileSync(destination) };
    });
    fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico(frames));
    console.log('Arcade icons written.');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) main();
module.exports = { svg, ico };
