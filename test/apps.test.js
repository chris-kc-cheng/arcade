const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublicAddress, checkUrl, safeGet, parseApps, pickIcon, nameFromId, createAppDirectory, DEFAULT_APPS_URL, MAX_BYTES } = require('../lib/apps');

test('only public addresses are allowed, including IPv6 and mapped forms', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', 'not-an-ip', '', undefined]) assert.equal(isPublicAddress(address), false, String(address));
});

test('URLs must be plain https without credentials and not point at a private literal', () => {
  assert.equal(checkUrl('https://apps.hedgies.cloud/app.json').hostname, 'apps.hedgies.cloud');
  for (const bad of ['http://x.example/', 'javascript:alert(1)', 'https://user:pw@x.example/', 'https://127.0.0.1/', 'https://[::1]/', 'https://10.0.0.5/a', 'nonsense']) assert.throws(() => checkUrl(bad), undefined, bad);
});

test('redirects are followed but every hop is checked, and the number of hops is limited', async () => {
  const hops = [];
  const get = async url => {
    hops.push(url);
    if (url === 'https://a.example/') return { redirect: '/b' };
    if (url === 'https://a.example/b') return { body: Buffer.from('ok') };
    if (url === 'https://evil.example/') return { redirect: 'https://169.254.169.254/latest' };
    if (url === 'https://loop.example/') return { redirect: '/' };
    if (url === 'https://downgrade.example/') return { redirect: 'http://x.example/' };
    throw new Error('unexpected');
  };
  assert.deepEqual(await safeGet('https://a.example/', { get }), { url: 'https://a.example/b', body: 'ok' });
  await assert.rejects(safeGet('https://evil.example/', { get }));
  assert.ok(!hops.includes('https://169.254.169.254/latest'), 'a private redirect target is never requested');
  await assert.rejects(safeGet('https://downgrade.example/', { get }));
  await assert.rejects(safeGet('https://loop.example/', { get }), /too many redirects/);
  await assert.rejects(safeGet('http://plain.example/', { get }));
  assert.equal(MAX_BYTES, 512 * 1024);
});

test('the registry keeps only well-formed https entries with sane unique ids', () => {
  assert.deepEqual(parseApps({ id: 'x' }), []);
  const apps = parseApps([
    { id: 'rabbit', url: 'https://learn.hedgies.cloud/' },
    { id: 'plain', url: 'http://insecure.example/' },
    { id: 'script', url: 'javascript:alert(1)' },
    { id: 'private', url: 'https://192.168.0.4/' },
    { id: 7, url: 'https://number.example/' },
    { id: 'Bad Id!', url: 'https://bad.example/' },
    { url: 'https://missing-id.example/' },
    null,
    { id: 'rabbit', url: 'https://duplicate.example/' },
    { id: 'named', url: 'https://named.example/app/', name: 'ignored', admin: true }
  ]);
  assert.deepEqual(apps, [{ id: 'rabbit', url: 'https://learn.hedgies.cloud/' }, { id: 'named', url: 'https://named.example/app/' }]);
  assert.equal(parseApps(Array.from({ length: 40 }, (_, index) => ({ id: `app-${index}`, url: `https://a${index}.example/` }))).length, 24);
  assert.equal(nameFromId('inky-unicorn'), 'Inky Unicorn');
});

test('icon choice prefers a crisp plain icon and never a non-https one', () => {
  const icons = [{ src: 'mask.png', sizes: '512x512', purpose: 'maskable' }, { src: 'small.png', sizes: '48x48' }, { src: 'big.png', sizes: '512x512' }, { src: 'mid.png', sizes: '192x192', purpose: 'any' }];
  assert.deepEqual(pickIcon(icons, 'https://x.example/m.json'), { src: 'https://x.example/mid.png', size: 192 });
  assert.equal(pickIcon([{ src: 'tiny.png', sizes: '32x32' }], 'https://x.example/m.json').src, 'https://x.example/tiny.png');
  assert.equal(pickIcon([{ src: 'http://x.example/a.png', sizes: '192x192' }], 'https://x.example/'), null);
  assert.equal(pickIcon([], 'https://x.example/'), null);
});

function fakeWeb(pages) {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (!(url in pages)) throw new Error('HTTP 404');
    if (pages[url] instanceof Error) throw pages[url];
    return { url, body: pages[url] };
  };
  return { calls, fetcher };
}

test('the directory hides this app, names apps from their manifests, falls back to initials, and caches for ten minutes', async () => {
  let clock = 0, registry = JSON.stringify([
    { id: 'arcade', url: 'https://arcade.example/' },
    { id: 'whack-a-math', url: 'https://math.example/app/' },
    { id: 'plain-app', url: 'https://plain.example/' }
  ]);
  const pages = {
    get 'https://list.example/app.json'() { return registry; },
    'https://math.example/app/': '<link rel="manifest" href="site.webmanifest"><link rel="apple-touch-icon" href="/touch.png">',
    'https://math.example/app/site.webmanifest': JSON.stringify({ short_name: 'Whack-a-Math', icons: [{ src: 'i-192.png', sizes: '192x192' }] }),
    'https://plain.example/': '<p>no manifest</p>'
  };
  const web = fakeWeb(pages);
  const directory = createAppDirectory({ appsUrl: 'https://list.example/app.json', fetcher: web.fetcher, now: () => clock });
  assert.deepEqual(await directory.list(), [
    { id: 'whack-a-math', name: 'Whack-a-Math', url: 'https://math.example/app/', icon: 'https://math.example/app/i-192.png' },
    { id: 'plain-app', name: 'Plain App', url: 'https://plain.example/', icon: null }
  ]);
  const requests = web.calls.length;
  clock = 9 * 60 * 1000; await directory.list();
  assert.equal(web.calls.length, requests, 'no refetch inside the ten-minute window');
  clock = 10 * 60 * 1000 + 1; registry = JSON.stringify([{ id: 'new-app', url: 'https://new.example/' }]);
  assert.deepEqual((await directory.list()).map(app => app.id), ['new-app']);
});

test('the last good list survives a registry outage, and with none the list is empty without hammering the registry', async () => {
  let clock = 0, down = false;
  const good = JSON.stringify([{ id: 'one', url: 'https://one.example/' }]);
  const calls = [];
  const fetcher = async url => { calls.push(url); if (url === 'https://list.example/app.json') { if (down) throw new Error('offline'); return { url, body: good }; } throw new Error('HTTP 404'); };
  const directory = createAppDirectory({ appsUrl: 'https://list.example/app.json', fetcher, now: () => clock });
  assert.equal((await directory.list()).length, 1);
  down = true; clock = 11 * 60 * 1000;
  assert.deepEqual((await directory.list()).map(app => app.id), ['one'], 'serves the last good list');
  const before = calls.length; clock += 1000; await directory.list();
  assert.equal(calls.length, before, 'waits before asking the registry again');

  const never = createAppDirectory({ appsUrl: 'https://list.example/app.json', fetcher: async () => { throw new Error('offline'); }, now: () => 0 });
  assert.deepEqual(await never.list(), []);
  const unconfigured = createAppDirectory({ appsUrl: '', fetcher: async () => { throw new Error('must not be called'); } });
  assert.equal(unconfigured.enabled, false); assert.deepEqual(await unconfigured.list(), []);
  assert.equal(DEFAULT_APPS_URL, 'https://apps.hedgies.cloud/app.json');
});
