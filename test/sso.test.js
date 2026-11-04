const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanName, accountName, resolvePlayerName, takeAuthError, createSso, DEFAULT_BASE } = require('../public/sso');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
function fakeFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

test('names are normalized the way the server stores them', () => {
  assert.equal(cleanName('  Ada   Lovelace  '), 'Ada Lovelace');
  assert.equal(cleanName('x'.repeat(40)).length, 24);
  assert.equal(cleanName(42), '');
  assert.equal(accountName({ name: ' Grace ', email: 'g@example.com' }), 'Grace');
  assert.equal(accountName({ name: '', email: 'grace.hopper@example.com' }), 'grace.hopper');
  assert.equal(accountName(null), '');
});

test('a signed-in account fills the name, a typed name wins for the session, and signing out clears only the account name', () => {
  const user = { name: 'Ada' };
  assert.deepEqual(resolvePlayerName({ stored: undefined, user }), { name: 'Ada', source: 'account' });
  assert.deepEqual(resolvePlayerName({ stored: { name: 'Zed', source: 'manual' }, user }), { name: 'Zed', source: 'manual' }, 'an edit is respected');
  assert.deepEqual(resolvePlayerName({ stored: { name: 'Old Account', source: 'account' }, user }), { name: 'Ada', source: 'account' }, 'a new account replaces an account name');
  assert.deepEqual(resolvePlayerName({ stored: { name: 'Old Account', source: 'account' }, user: null }), { name: '', source: '' });
  assert.deepEqual(resolvePlayerName({ stored: { name: 'Zed', source: 'manual' }, user: null }), { name: 'Zed', source: 'manual' });
  assert.deepEqual(resolvePlayerName({ stored: { name: 'Legacy' }, user }), { name: 'Legacy', source: 'manual' }, 'a name stored before accounts existed counts as typed');
  assert.deepEqual(resolvePlayerName({}), { name: '', source: '' });
  assert.equal(resolvePlayerName({ stored: undefined, user: { name: 'x'.repeat(60) } }).name.length, 24);
});

test('an OAuth error is read from the URL and stripped from it', () => {
  assert.deepEqual(takeAuthError('https://arcade.hedgies.cloud/snake?room=a&auth_error=access_denied#top'),
    { message: 'Sign-in was cancelled.', cleanUrl: '/snake?room=a#top' });
  assert.equal(takeAuthError('https://arcade.hedgies.cloud/?auth_error=Your%20account%20is%20disabled').message, 'Your account is disabled');
  assert.equal(takeAuthError('https://arcade.hedgies.cloud/?auth_error=').message, 'Sign-in did not complete. Please try again.');
  assert.deepEqual(takeAuthError('https://arcade.hedgies.cloud/?q=1'), { message: '', cleanUrl: null });
  assert.deepEqual(takeAuthError('not a url'), { message: '', cleanUrl: null });
});

test('me() sends credentials and returns the signed-in account', async () => {
  const web = fakeFetch(json(200, { name: 'Ada', email: 'ada@example.com' }));
  const user = await createSso({ fetchImpl: web.fetchImpl }).me();
  assert.equal(user.name, 'Ada');
  assert.equal(web.calls[0].url, `${DEFAULT_BASE}/me`);
  assert.equal(web.calls[0].credentials, 'include');
  assert.equal(web.calls[0].headers['X-Auth-Request'], undefined, 'reads are plain GETs');
});

test('a 401 from /me tries one refresh and then /me again; a failed refresh means signed out', async () => {
  const ok = fakeFetch(json(401, { detail: 'expired' }), json(204), json(200, { name: 'Ada' }));
  assert.equal((await createSso({ fetchImpl: ok.fetchImpl }).me()).name, 'Ada');
  assert.deepEqual(ok.calls.map(call => `${call.method} ${call.url.replace(DEFAULT_BASE, '')}`), ['GET /me', 'POST /refresh', 'GET /me']);
  assert.equal(ok.calls[1].headers['X-Auth-Request'], '1', 'POSTs carry the CSRF header');
  assert.equal(ok.calls[1].credentials, 'include');

  const refused = fakeFetch(json(401, {}), json(401, { detail: 'Your session ended.' }));
  assert.equal(await createSso({ fetchImpl: refused.fetchImpl }).me(), null);
  assert.equal(refused.calls.length, 2, 'only one refresh attempt');

  const second401 = fakeFetch(json(401, {}), json(204), json(401, {}));
  assert.equal(await createSso({ fetchImpl: second401.fetchImpl }).me(), null);
});

test('an unreachable or broken auth service never throws from me()', async () => {
  assert.equal(await createSso({ fetchImpl: fakeFetch(new TypeError('Failed to fetch')).fetchImpl }).me(), null);
  assert.equal(await createSso({ fetchImpl: fakeFetch(json(503, { detail: 'down' })).fetchImpl }).me(), null);
  assert.equal(await createSso({ fetchImpl: fakeFetch(json(200)).fetchImpl }).me(), null, 'a body that is not JSON');
});

test('a slow auth service is abandoned after the timeout so it cannot hold a game up', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  assert.equal(await createSso({ fetchImpl, timeoutMs: 20 }).me(), null);
  assert.ok(Date.now() - started < 1000);
});

test('login posts the identifier and password, and shows the server detail for 401, 403 and 429', async () => {
  const good = fakeFetch(json(200, { name: 'Ada' }));
  assert.equal((await createSso({ fetchImpl: good.fetchImpl }).login('ada', 'pw')).name, 'Ada');
  assert.deepEqual(JSON.parse(good.calls[0].body), { email: 'ada', password: 'pw' });
  assert.equal(good.calls[0].method, 'POST'); assert.equal(good.calls[0].headers['X-Auth-Request'], '1');
  for (const [status, detail] of [[401, 'Invalid email or password'], [403, 'Your account is waiting for an administrator to enable it.'], [429, 'Too many failed sign-in attempts. Try again in five minutes.']]) {
    const web = fakeFetch(json(status, { detail }));
    await assert.rejects(createSso({ fetchImpl: web.fetchImpl }).login('a', 'b'), error => error.message === detail && error.status === status);
  }
  await assert.rejects(createSso({ fetchImpl: fakeFetch(json(422, { detail: [{ msg: 'x' }] })).fetchImpl }).login('a', 'b'), /check what you typed/);
  await assert.rejects(createSso({ fetchImpl: fakeFetch(new TypeError('offline')).fetchImpl }).login('a', 'b'), error => error.status === 0 && /Could not reach/.test(error.message));
});

test('logout, forgot password and the provider links use the platform contract', async () => {
  const web = fakeFetch(json(204), json(200, {}));
  const sso = createSso({ fetchImpl: web.fetchImpl, locationHref: () => 'https://arcade.hedgies.cloud/snake?room=a#x' });
  assert.equal(await sso.logout(), null);
  await sso.forgotPassword('ada@example.com');
  assert.equal(web.calls[0].url, `${DEFAULT_BASE}/logout`);
  assert.deepEqual(JSON.parse(web.calls[1].body), { email: 'ada@example.com', return_to: 'https://arcade.hedgies.cloud/snake' });
  assert.equal(sso.providerUrl('google'), `${DEFAULT_BASE}/google/start?return_to=${encodeURIComponent('https://arcade.hedgies.cloud/snake?room=a#x')}`);
  assert.equal(sso.providerUrl('microsoft', 'https://a.example/'), `${DEFAULT_BASE}/microsoft/start?return_to=https%3A%2F%2Fa.example%2F`);
});

test('the real /me and /login answers wrap the account in a user field', async () => {
  const wrapped = { user: { id: 1, email: 'ada@example.com', name: 'Ada Lovelace' }, session_id: 5, expires_in: 900 };
  const sso = createSso({ fetchImpl: fakeFetch(json(200, wrapped), json(200, wrapped)).fetchImpl });
  assert.equal((await sso.me()).name, 'Ada Lovelace');
  assert.equal(accountName(await sso.login('ada', 'pw')), 'Ada Lovelace');
  assert.equal(accountName(wrapped.user), 'Ada Lovelace');
});
