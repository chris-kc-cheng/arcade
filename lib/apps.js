// The shared Hedgies app list behind the top-bar app switcher. Nothing about the other apps is hard coded: the list is
// read live from app.json, and each app's name and icon come from its own PWA manifest, found from the app URL.
// The server does the fetching so browsers need no CORS headers, and only URLs named by the list are ever requested.
const APP_LIST_URL = process.env.APP_LIST_URL || 'https://www.hedgies.cloud/app.json';
const SELF_ID = process.env.APP_ID || 'arcade';
const CACHE_MS = 60000;
const FETCH_TIMEOUT_MS = 5000;

const nameFromId = id => id.split(/[-_\s]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');

function httpsUrl(value, base) {
  try { const url = new URL(value, base); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

// Keep only well-formed https entries; `name` and `icon` are optional overrides.
function parseApps(data) {
  if (!Array.isArray(data)) return [];
  return data.flatMap(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.url !== 'string') return [];
    const url = httpsUrl(item.url);
    if (!url) return [];
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 40) : null;
    const icon = typeof item.icon === 'string' ? httpsUrl(item.icon, url) : null;
    return [{ id: item.id.trim(), url, name, icon }];
  });
}

// Prefer the smallest icon of at least 128px, else the largest; skip monochrome masks.
function pickIcon(icons, base) {
  const usable = (Array.isArray(icons) ? icons : [])
    .filter(icon => icon && typeof icon.src === 'string' && !/^monochrome$/i.test(icon.purpose || ''))
    .map(icon => ({ src: icon.src, size: Math.max(0, ...String(icon.sizes || '').split(/\s+/).map(size => parseInt(size, 10) || 0)) }));
  const best = usable.filter(icon => icon.size >= 128).sort((a, b) => a.size - b.size)[0] ?? usable.sort((a, b) => b.size - a.size)[0];
  return best ? httpsUrl(best.src, base) : null;
}

function manifestHref(html, base) {
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bmanifest\b/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = href && (href[1] ?? href[2] ?? href[3]);
    if (value) return httpsUrl(value, base);
  }
  return null;
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow', headers: { accept: 'application/json,text/html;q=0.9,*/*;q=0.5' } });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.text()).slice(0, 500000);
}

async function loadManifest(fetchImpl, app) {
  let linked = null;
  try { linked = manifestHref(await fetchText(fetchImpl, app.url), app.url); } catch { /* fall back to the conventional name */ }
  for (const url of [linked, httpsUrl('manifest.webmanifest', app.url)].filter(Boolean)) {
    try {
      const data = JSON.parse(await fetchText(fetchImpl, url));
      return { name: data.short_name || data.name || null, icon: pickIcon(data.icons, url) };
    } catch { /* try the next candidate */ }
  }
  return { name: null, icon: null };
}

function createAppDirectory({ fetchImpl = globalThis.fetch, listUrl = APP_LIST_URL, selfId = SELF_ID, now = Date.now } = {}) {
  let cached = null;
  let pending = null;
  const manifests = new Map();
  async function build() {
    const apps = parseApps(JSON.parse(await fetchText(fetchImpl, listUrl))).filter(app => app.id !== selfId);
    return Promise.all(apps.map(async app => {
      let found = manifests.get(app.url);
      if (!found || now() - found.at > 10 * CACHE_MS) { found = { at: now(), info: await loadManifest(fetchImpl, app) }; manifests.set(app.url, found); }
      const name = app.name || (typeof found.info.name === 'string' && found.info.name.trim().slice(0, 40)) || nameFromId(app.id);
      return { id: app.id, name, url: app.url, icon: app.icon || found.info.icon };
    }));
  }
  return {
    async list() {
      if (cached && now() - cached.at < CACHE_MS) return cached.apps;
      pending ??= build().then(apps => { cached = { at: now(), apps }; return apps; }).finally(() => { pending = null; });
      return pending;
    }
  };
}

module.exports = { APP_LIST_URL, SELF_ID, nameFromId, parseApps, pickIcon, manifestHref, createAppDirectory };
