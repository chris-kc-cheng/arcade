// The shared platform's app list behind the toolbar app switcher (GET /api/platform-apps).
//
// The registry (APPS_URL, default https://apps.hedgies.cloud/app.json) holds only `[{"id": ..., "url": ...}]`. Browsers cannot
// read it (no CORS), so this server reads it, then reads each app's page and web manifest for a name and an icon, and returns
// `[{id, url, name, icon}]`. Nothing about the other apps is stored in this repository. Results are cached for ten minutes; when
// the registry cannot be read the last good list is served, and when there never was one the list is empty (the toolbar then
// hides the switcher).
//
// The addresses come from a file other people can edit, so every fetch is https only, refuses private and loopback addresses
// (also after a redirect, and on the address actually connected to), reads at most 512 KB and gives up after a few seconds.
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

const DEFAULT_APPS_URL = 'https://apps.hedgies.cloud/app.json';
const SELF_ID = 'arcade';
const TTL_MS = 10 * 60 * 1000;
const REGISTRY_TIMEOUT_MS = 2000;
const ACCESS_COOKIE = 'sso_access';
const MAX_APPS = 24;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 6000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const nameFromId = id => id.split(/[-_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');

// --- Address policy -------------------------------------------------------------------------------------------------------

function ipv4Parts(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

/** True only for a public, globally routable IP address. Everything private, loopback, link-local or reserved is refused. */
function isPublicAddress(address) {
  if (typeof address !== 'string') return false;
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = ipv4Parts(address);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;        // carrier-grade NAT
    if (a === 169 && b === 254) return false;                  // link local, including cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return false;
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false;             // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false;             // link local fe80::/10
    if ((first & 0xff00) === 0xff00) return false;             // multicast
    if (lower.startsWith('2001:db8')) return false;            // documentation
    return true;
  }
  return false;
}

/** A dns.lookup replacement: it resolves the name itself and only ever hands back public addresses. */
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || !addresses.every(entry => isPublicAddress(entry.address))) {
      return callback(Object.assign(new Error(`${hostname} is not a public address`), { code: 'EBLOCKED' }));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('not a URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('only plain https addresses are allowed');
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal) && !isPublicAddress(literal)) throw new Error('not a public address');
  return url;
}

// --- Fetching -------------------------------------------------------------------------------------------------------------

function getOnce(url, lookup, extraHeaders = {}, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup, timeout: timeoutMs, headers: { 'user-agent': 'Arcade-app-switcher', accept: 'application/json, text/html, */*', ...extraHeaders } }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) { response.resume(); resolve({ redirect: response.headers.location }); return; }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`HTTP ${status}`)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) { request.destroy(); resolve({ body: Buffer.concat(chunks).subarray(0, MAX_BYTES) }); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

/**
 * Resolves `{ url, body }`: the final address after redirects and at most 512 KB of the response. Every hop is re-checked.
 * `headers` (for example the visitor's platform cookie) are sent only to the origin that was asked for, never after a redirect
 * to another origin.
 */
async function safeGet(address, { lookup = publicLookup, get = getOnce, headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  let url = checkUrl(address).href;
  const origin = new URL(url).origin;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await get(url, lookup, new URL(url).origin === origin ? headers : {}, timeoutMs);
    if (result.redirect === undefined) return { url, body: result.body.toString('utf8') };
    url = checkUrl(new URL(result.redirect, url).href).href;
  }
  throw new Error('too many redirects');
}

// --- Registry and manifests -----------------------------------------------------------------------------------------------

/** Keep only well-formed https entries with a sane id; everything else in the file is ignored. */
function parseApps(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set(), apps = [];
  for (const item of data) {
    if (!item || typeof item.id !== 'string' || typeof item.url !== 'string' || !ID_PATTERN.test(item.id) || seen.has(item.id)) continue;
    let url;
    try { url = checkUrl(item.url).href; } catch { continue; }
    seen.add(item.id); apps.push({ id: item.id, url });
  }
  return apps.slice(0, MAX_APPS);
}

function attributes(tag) {
  const found = {};
  for (const [, name, value] of tag.matchAll(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) found[name.toLowerCase()] = value.replace(/^["']|["']$/g, '');
  return found;
}

function iconSize(icon) {
  const sizes = [...String(icon.sizes || '').matchAll(/(\d+)x(\d+)/g)].map(match => Number(match[1]));
  return sizes.length ? Math.min(...sizes) : 0;
}

/** `{ src, size }` of the smallest plain icon of at least 128 px, else the biggest, resolved to an https address. */
function pickIcon(icons, base) {
  const usable = (Array.isArray(icons) ? icons : []).filter(icon => icon && typeof icon.src === 'string');
  const plain = usable.filter(icon => String(icon.purpose || 'any').split(/\s+/).includes('any'));
  const pool = plain.length ? plain : usable;
  const big = pool.filter(icon => iconSize(icon) >= 128).sort((a, b) => iconSize(a) - iconSize(b));
  const chosen = big[0] || [...pool].sort((a, b) => iconSize(b) - iconSize(a))[0];
  if (!chosen) return null;
  try {
    const src = new URL(chosen.src, base).href;
    return src.startsWith('https://') ? { src, size: iconSize(chosen) } : null;
  } catch { return null; }
}

/** Name and icon from the app's own page and manifest. Anything unreadable falls back to the id and an initial letter. */
async function describe(entry, fetcher) {
  let name = null, icon = null, size = 0, links = [], base = entry.url;
  // The page may refuse us (an administrator-only app answers the scraper with 403); its manifest and icons are public,
  // so the conventional manifest address is still tried.
  try { const page = await fetcher(entry.url); links = (page.body.match(/<link\b[^>]*>/gi) || []).map(attributes); base = page.url; } catch { /* page unreadable */ }
  const touch = links.find(link => (link.rel || '').toLowerCase().includes('apple-touch-icon') && link.href);
  const manifest = links.find(link => (link.rel || '').toLowerCase() === 'manifest' && link.href)?.href || 'manifest.webmanifest';
  try {
    const document = await fetcher(new URL(manifest, base).href);
    const data = JSON.parse(document.body);
    name = data.short_name || data.name || null;
    const picked = pickIcon(data.icons, document.url);
    if (picked) { icon = picked.src; size = picked.size; }
  } catch { /* the app may have no manifest */ }
  if (touch && (!icon || size > 512)) {
    try { const href = new URL(touch.href, base).href; icon = href.startsWith('https://') ? href : icon; } catch { /* keep what we have */ }
  }
  return { id: entry.id, url: entry.url, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : nameFromId(entry.id), icon };
}

async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]); }
  }));
  return results;
}

/** The platform cookie is the only thing forwarded to the registry: just `sso_access`, taken out of the visitor's Cookie header. */
function platformCookie(header) {
  if (typeof header !== 'string' || header.length > 8192) return '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === ACCESS_COOKIE && value.length) { const token = value.join('='); if (/^[\w.~+/=-]{1,4096}$/.test(token)) return `${ACCESS_COOKIE}=${token}`; }
  }
  return '';
}

function createAppDirectory({ appsUrl = process.env.APPS_URL === undefined ? DEFAULT_APPS_URL : process.env.APPS_URL, selfId = SELF_ID, fetcher = safeGet, now = Date.now } = {}) {
  // Names and icons come from each app's own manifest and are the same for every visitor, so they are cached per app URL.
  // The LIST is never cached across visitors: an administrator's registry answer contains an extra, admin-only entry.
  const descriptions = new Map(), describing = new Map();
  let lastPublic = [], anonymousPending = null;
  function describeCached(entry) {
    const cached = descriptions.get(entry.url);
    if (cached && now() - cached.at < TTL_MS) return Promise.resolve({ ...cached.app, id: entry.id });
    if (!describing.has(entry.url)) {
      describing.set(entry.url, describe(entry, fetcher).then(app => { descriptions.set(entry.url, { at: now(), app }); return app; }).finally(() => describing.delete(entry.url)));
    }
    return describing.get(entry.url).then(app => ({ ...app, id: entry.id }));
  }
  async function build(cookie) {
    const headers = cookie ? { cookie } : {};
    const registry = JSON.parse((await fetcher(appsUrl, { headers, timeoutMs: REGISTRY_TIMEOUT_MS })).body);
    const entries = parseApps(registry).filter(entry => entry.id !== selfId);
    return mapLimit(entries, 8, describeCached);
  }
  return {
    enabled: Boolean(appsUrl),
    /**
     * Apps in registry order for ONE visitor. `cookieHeader` is the visitor's Cookie header; only the platform cookie in it is
     * forwarded, and only to the registry. The registry is read on every request (2 s limit). When it cannot be read, the last
     * list read WITHOUT a cookie (the public one) is served, so a failure never leaks or invents an admin entry.
     */
    async list(cookieHeader = '') {
      if (!appsUrl) return [];
      const cookie = platformCookie(cookieHeader);
      try {
        if (cookie) return await build(cookie);
        // Anonymous visitors all get the same answer, so concurrent requests share one registry call.
        anonymousPending ??= build('').then(apps => { lastPublic = apps; return apps; }).finally(() => { anonymousPending = null; });
        return await anonymousPending;
      } catch { return lastPublic; }
    }
  };
}

module.exports = { platformCookie, DEFAULT_APPS_URL, SELF_ID, TTL_MS, MAX_BYTES, nameFromId, isPublicAddress, publicLookup, checkUrl, safeGet, parseApps, pickIcon, describe, createAppDirectory };
