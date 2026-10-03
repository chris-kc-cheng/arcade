const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const publicDir = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(publicDir, file));
const manifest = JSON.parse(read('manifest.webmanifest'));

// Decode the RGBA PNGs we ship so safe-zone and alpha checks validate pixels,
// rather than trusting a file name or SVG comment. This is test-only code.
function pngPixels(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8, 'icons must use 8-bit channels');
  assert.equal(bytes[25], 6, 'icons must use RGBA channels');
  assert.equal(bytes[28], 0, 'icons must not be interlaced');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)), stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (left, up, corner) => {
    const prediction = left + up - corner;
    const a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - corner);
    return a <= b && a <= c ? left : b <= c ? up : corner;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const up = y ? pixels[index - stride] : 0;
      const corner = y && x >= 4 ? pixels[index - stride - 4] : 0;
      const predictors = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)];
      pixels[index] = (raw[y * (stride + 1) + x + 1] + predictors[filter]) & 255;
    }
  }
  return { width, height, pixels };
}

test('all HTML entry points share Arcade favicon, Apple icon, and app identity', () => {
  const pages = fs.readdirSync(publicDir).filter(file => file.endsWith('.html'));
  assert.ok(pages.length >= 8);
  for (const page of pages) {
    const html = read(page).toString();
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
    assert.ok(head, `${page}: head exists`);
    assert.match(head, /<meta name="application-name" content="Arcade">/, page);
    assert.match(head, /<meta name="apple-mobile-web-app-title" content="Arcade">/, page);
    assert.match(head, /<meta name="mobile-web-app-capable" content="yes">/, page);
    assert.match(head, /<meta name="theme-color" content="#[a-f\d]{6}">/i, page);
    assert.match(head, /<link rel="icon" href="\/favicon\.ico" sizes="16x16 32x32 48x48">/, page);
    assert.match(head, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" sizes="any">/, page);
    assert.match(head, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" sizes="180x180">/, page);
    assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest">/, page);
    assert.equal((head.match(/rel="manifest"/g) || []).length, 1, `${page}: one manifest`);
  }
});

test('manifest is one root-scoped Arcade app with real 192 and 512 pixel icons', () => {
  assert.equal(manifest.name, 'Arcade');
  assert.equal(manifest.short_name, 'Arcade');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#141824');
  assert.equal(manifest.theme_color, '#141824');
  for (const purpose of ['any', 'maskable']) {
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(icon => icon.purpose === purpose && icon.sizes === `${size}x${size}`);
      assert.ok(icon, `${purpose} ${size} icon exists`);
      assert.equal(icon.type, 'image/png');
      const decoded = pngPixels(read(icon.src));
      assert.equal(decoded.width, size);
      assert.equal(decoded.height, size);
    }
  }
});

test('maskable artwork is opaque and stays within the central 80% safe circle', () => {
  for (const icon of manifest.icons.filter(icon => icon.purpose === 'maskable')) {
    const { width, height, pixels } = pngPixels(read(icon.src));
    let artworkPixels = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        assert.equal(pixels[offset + 3], 255, `${icon.src} has an opaque background`);
        const isBackground = pixels[offset] === 20 && pixels[offset + 1] === 24 && pixels[offset + 2] === 36;
        if (!isBackground) {
          artworkPixels++;
          const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
          assert.ok(distance <= width * 0.4, `${icon.src} artwork at ${x},${y} is inside the safe circle`);
        }
      }
    }
    assert.ok(artworkPixels > width * height * 0.1, 'icon contains substantial visible artwork');
  }
});

test('Apple touch icon is opaque at 180px and ICO contains 16/32/48px images', () => {
  const apple = pngPixels(read('apple-touch-icon.png'));
  assert.equal(apple.width, 180);
  assert.equal(apple.height, 180);
  for (let offset = 3; offset < apple.pixels.length; offset += 4) assert.equal(apple.pixels[offset], 255);
  const ico = read('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    const frame = pngPixels(ico.subarray(offset, offset + length));
    assert.equal(frame.width, size);
    assert.equal(frame.height, size);
  }
  assert.deepEqual(read('favicon.svg'), read('icons/arcade.svg'), 'favicon uses the maintained source artwork');
});

test('HTTP serves the manifest and icon formats with their correct content types', async t => {
  const { server, wss } = require('../server');
  t.after(async () => {
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const assets = [
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/favicon.ico', 'image/x-icon'],
    ['/apple-touch-icon.png', 'image/png'],
    ...manifest.icons.map(icon => [icon.src, icon.type]),
  ];
  for (const [asset, type] of assets) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get('content-type'), type, asset);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, read(asset), `${asset} returns its actual file`);
  }
});
