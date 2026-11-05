const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isPublicAddress, checkUrl, safeGet, parseApps, pickIcon, nameFromId, createAppDirectory, platformCookie, DEFAULT_APPS_URL, MAX_BYTES } = require('../lib/apps');

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

test('only the platform cookie is taken from the visitor Cookie header', () => {
  assert.equal(platformCookie('theme=dark; sso_access=abc.DEF-1_2; other=1'), 'sso_access=abc.DEF-1_2');
  assert.equal(platformCookie('sso_refresh=secret; session=1'), '', 'other cookies are never forwarded');
  assert.equal(platformCookie('sso_access=bad value;'), '');
  assert.equal(platformCookie(undefined), '');
  assert.equal(platformCookie('sso_access=' + 'a'.repeat(9000)), '');
});

test('a cookie sent to the registry is not sent on to another origin after a redirect', async () => {
  const seen = [];
  const get = async (url, lookup, headers) => {
    seen.push([url, headers.cookie]);
    return url === 'https://apps.example/app.json' ? { redirect: 'https://other.example/app.json' } : { body: Buffer.from('[]') };
  };
  await safeGet('https://apps.example/app.json', { get, headers: { cookie: 'sso_access=t' } });
  assert.deepEqual(seen, [['https://apps.example/app.json', 'sso_access=t'], ['https://other.example/app.json', undefined]]);
});

function platform({ admin = true } = {}) {
  const calls = [];
  const state = { down: false, clock: 0 };
  const pages = {
    'https://math.example/': '<link rel="manifest" href="m.webmanifest">',
    'https://math.example/m.webmanifest': JSON.stringify({ short_name: 'Math', icons: [{ src: 'i.png', sizes: '192x192' }] }),
    'https://admin.example/': null, // the admin page itself refuses the scraper
    'https://admin.example/manifest.webmanifest': JSON.stringify({ short_name: 'Admin', icons: [{ src: 'a.png', sizes: '192x192' }] })
  };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, cookie: options.headers?.cookie, timeoutMs: options.timeoutMs });
    if (url === 'https://apps.example/app.json') {
      if (state.down) throw new Error('offline');
      const list = [{ id: 'arcade', url: 'https://arcade.example/' }, { id: 'math', url: 'https://math.example/' }];
      if (admin && options.headers?.cookie) list.push({ id: 'admin', url: 'https://admin.example/' });
      return { url, body: JSON.stringify(list) };
    }
    if (pages[url] === undefined || pages[url] === null) throw new Error('HTTP 403');
    return { url, body: pages[url] };
  };
  return { calls, state, fetcher, directory: () => createAppDirectory({ appsUrl: 'https://apps.example/app.json', fetcher, now: () => state.clock }) };
}

test('an administrator cookie gets the admin entry, anonymous visitors never do, and the list is never shared between visitors', async () => {
  const web = platform(); const directory = web.directory();
  const anonymous = await directory.list();
  assert.deepEqual(anonymous.map(app => app.id), ['math'], 'this app is hidden and there is no admin entry');
  const asAdmin = await directory.list('theme=dark; sso_access=admintoken; sso_refresh=nope');
  assert.deepEqual(asAdmin.map(app => app.id), ['math', 'admin']);
  assert.deepEqual(asAdmin.find(app => app.id === 'admin'), { id: 'admin', url: 'https://admin.example/', name: 'Admin', icon: 'https://admin.example/a.png' }, 'name and icon come from the public manifest');
  assert.deepEqual((await directory.list()).map(app => app.id), ['math'], 'an anonymous visitor after an administrator still gets the public list');
  assert.deepEqual((await directory.list('sso_access=othertoken')).map(app => app.id), ['math', 'admin']);
  const registryCalls = web.calls.filter(call => call.url === 'https://apps.example/app.json');
  assert.equal(registryCalls.length, 4, 'the registry is read on every request');
  assert.deepEqual(registryCalls.map(call => call.cookie), [undefined, 'sso_access=admintoken', undefined, 'sso_access=othertoken'], 'only the platform cookie is forwarded, never the rest of the header');
  assert.ok(registryCalls.every(call => call.timeoutMs === 2000), 'a 2 second limit');
  assert.ok(web.calls.filter(call => call.url !== 'https://apps.example/app.json').every(call => call.cookie === undefined), 'app pages and manifests never get the cookie');
});

test('descriptions are cached per app URL for ten minutes, not per list', async () => {
  const web = platform(); const directory = web.directory();
  await directory.list(); await directory.list('sso_access=t'); await directory.list();
  const manifest = () => web.calls.filter(call => call.url === 'https://math.example/m.webmanifest').length;
  assert.equal(manifest(), 1, 'one manifest read for three requests');
  web.state.clock = 10 * 60 * 1000 + 1; await directory.list();
  assert.equal(manifest(), 2);
});

test('when the registry fails the last public list is served, never an admin entry', async () => {
  const web = platform(); const directory = web.directory();
  await directory.list(); await directory.list('sso_access=admintoken');
  web.state.down = true;
  assert.deepEqual((await directory.list('sso_access=admintoken')).map(app => app.id), ['math'], 'an outage hides the admin entry');
  assert.deepEqual((await directory.list()).map(app => app.id), ['math']);
  const fresh = platform(); fresh.state.down = true;
  assert.deepEqual(await fresh.directory().list(), [], 'nothing was ever read: empty, so the toolbar hides the switcher');
  const unconfigured = createAppDirectory({ appsUrl: '', fetcher: async () => { throw new Error('must not be called'); } });
  assert.equal(unconfigured.enabled, false); assert.deepEqual(await unconfigured.list('sso_access=t'), []);
  assert.equal(DEFAULT_APPS_URL, 'https://apps.hedgies.cloud/app.json');
});

test('an app that is down is still listed by id, and the server answers per visitor without shared caching', async () => {
  const fetcher = async url => { if (url === 'https://apps.example/app.json') return { url, body: JSON.stringify([{ id: 'plain-app', url: 'https://plain.example/' }]) }; throw new Error('HTTP 500'); };
  const apps = await createAppDirectory({ appsUrl: 'https://apps.example/app.json', fetcher }).list();
  assert.deepEqual(apps, [{ id: 'plain-app', url: 'https://plain.example/', name: 'Plain App', icon: null }]);
  const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.match(server, /appDirectory\.list\(req\.headers\.cookie\)/);
  assert.match(server, /'Cache-Control': 'private, no-store', Vary: 'Cookie'/);
});
