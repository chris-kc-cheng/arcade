const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApps, pickIcon, manifestHref, nameFromId, createAppDirectory } = require('../lib/apps');

test('the app list keeps only well-formed https entries and never trusts extra fields', () => {
  assert.deepEqual(parseApps({ id: 'x' }), []);
  const apps = parseApps([
    { id: 'rabbit', url: 'https://learn.hedgies.cloud/' },
    { id: 'plain', url: 'http://insecure.example/' },
    { id: 'script', url: 'javascript:alert(1)' },
    { id: 7, url: 'https://number.example/' },
    { url: 'https://missing-id.example/' },
    null,
    { id: 'named', url: 'https://named.example/app/', name: ' Fancy ', icon: '/icon.png', admin: true },
    { id: 'bad-icon', url: 'https://icon.example/', icon: 'http://icon.example/a.png' }
  ]);
  assert.deepEqual(apps.map(app => app.id), ['rabbit', 'named', 'bad-icon']);
  assert.deepEqual(apps[1], { id: 'named', url: 'https://named.example/app/', name: 'Fancy', icon: 'https://named.example/icon.png' });
  assert.equal(apps[2].icon, null);
  assert.equal(nameFromId('inky-unicorn'), 'Inky Unicorn');
});

test('manifest discovery finds the linked manifest and picks a crisp, non-monochrome icon', () => {
  assert.equal(manifestHref('<html><head><link rel="icon" href="/a.png"><link rel="manifest" href="app.webmanifest"></head>', 'https://x.example/play/'), 'https://x.example/play/app.webmanifest');
  assert.equal(manifestHref('<link href=\'/m.json\' rel=\'manifest\'>', 'https://x.example/'), 'https://x.example/m.json');
  assert.equal(manifestHref('<link rel="manifest" href="http://x.example/m.json">', 'https://x.example/'), null);
  assert.equal(manifestHref('<p>no manifest</p>', 'https://x.example/'), null);
  const icons = [{ src: 'mono.png', sizes: '512x512', purpose: 'monochrome' }, { src: 'small.png', sizes: '48x48' }, { src: 'big.png', sizes: '512x512' }, { src: 'mid.png', sizes: '192x192' }];
  assert.equal(pickIcon(icons, 'https://x.example/m.json'), 'https://x.example/mid.png');
  assert.equal(pickIcon([{ src: 'tiny.png', sizes: '32x32' }], 'https://x.example/m.json'), 'https://x.example/tiny.png');
  assert.equal(pickIcon([], 'https://x.example/'), null);
});

test('the directory reads the live list, hides this app, fills names and icons from manifests, and caches briefly', async () => {
  const calls = [];
  let clock = 0, list = [
    { id: 'arcade', url: 'https://arcade.example/' },
    { id: 'whack-a-math', url: 'https://math.example/app/' },
    { id: 'plain-app', url: 'https://plain.example/' }
  ];
  const pages = {
    'https://math.example/app/': '<link rel="manifest" href="site.webmanifest">',
    'https://math.example/app/site.webmanifest': JSON.stringify({ short_name: 'Whack-a-Math', icons: [{ src: 'i-192.png', sizes: '192x192' }] })
  };
  const fetchImpl = async url => {
    calls.push(url);
    const body = url === 'https://list.example/app.json' ? JSON.stringify(list) : pages[url];
    return body === undefined ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => body };
  };
  const directory = createAppDirectory({ fetchImpl, listUrl: 'https://list.example/app.json', selfId: 'arcade', now: () => clock });
  const apps = await directory.list();
  assert.deepEqual(apps, [
    { id: 'whack-a-math', name: 'Whack-a-Math', url: 'https://math.example/app/', icon: 'https://math.example/app/i-192.png' },
    { id: 'plain-app', name: 'Plain App', url: 'https://plain.example/', icon: null }
  ]);
  const requests = calls.length;
  await directory.list();
  assert.equal(calls.length, requests, 'a second request inside the cache window does not refetch');
  clock = 61000; list = [{ id: 'new-app', url: 'https://new.example/' }];
  assert.deepEqual((await directory.list()).map(app => app.id), ['new-app'], 'after the window the list is read live again');
  const failing = createAppDirectory({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }), now: () => 0 });
  await assert.rejects(failing.list());
});
