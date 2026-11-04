// Optional shared login for the Arcade, dependency free. Loaded before platform.js in browsers; `require`d by the tests.
//
// The platform's auth service (https://auth.<domain>) owns the session cookie. This file only asks it who the visitor is and
// offers a login / logout. Nothing here gates a game: a failed, slow or missing auth service simply means "not signed in".
// The name it returns is for DISPLAY and for pre-filling the player-name field; the Arcade server never trusts it as an identity.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ArcadeSso = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_BASE = 'https://auth.hedgies.cloud';
  const NAME_LENGTH = 24;

  /** One display name the way the Arcade server stores it: trimmed, single spaces, at most 24 characters. */
  function cleanName(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, NAME_LENGTH).trim() : '';
  }

  /** The name to show for a signed-in account: its name, else the part of the email before the @. */
  function accountName(user) {
    if (!user || typeof user !== 'object') return '';
    return cleanName(user.name) || cleanName(typeof user.email === 'string' ? user.email.split('@')[0] : '');
  }

  /**
   * Decide the player name for this browser session.
   *   stored: { name, source } as remembered for the session; source is 'manual' (typed in the field) or 'account'.
   *   user:   the signed-in account or null.
   * A name the person typed always wins for the rest of the session. Otherwise a signed-in account supplies it, and an
   * account-supplied name disappears again once nobody is signed in.
   */
  function resolvePlayerName({ stored, user } = {}) {
    const name = cleanName(stored && stored.name);
    const source = stored && stored.source === 'account' ? 'account' : 'manual';
    if (name && source === 'manual') return { name, source: 'manual' };
    const account = accountName(user);
    if (account) return { name: account, source: 'account' };
    return { name: '', source: '' };
  }

  /** `?auth_error=...` is how an OAuth return reports a problem. Returns the message and the URL without the parameter. */
  function takeAuthError(href) {
    try {
      const url = new URL(href);
      const raw = url.searchParams.get('auth_error');
      if (raw === null) return { message: '', cleanUrl: null };
      url.searchParams.delete('auth_error');
      const known = { access_denied: 'Sign-in was cancelled.', account_disabled: 'Your account is waiting for an administrator to enable it.' };
      const text = known[raw] || raw.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || 'Sign-in did not complete. Please try again.';
      return { message: text, cleanUrl: url.pathname + url.search + url.hash };
    } catch { return { message: '', cleanUrl: null }; }
  }

  /**
   * Client for the auth service. Same contract as infrastructure/clients/js/sso-auth.js: credentials are included, POSTs carry
   * `X-Auth-Request: 1`, and a 401 from /me is retried once through POST /refresh.
   */
  function createSso({ base = DEFAULT_BASE, fetchImpl, timeoutMs = 4000, locationHref = () => (typeof location === 'object' ? location.href : '') } = {}) {
    const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

    async function call(path, { method = 'GET', body, timeout = timeoutMs } = {}) {
      if (!fetcher) throw Object.assign(new Error('Sign-in is unavailable.'), { status: 0 });
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
      let response;
      try {
        response = await fetcher(base + path, {
          method,
          credentials: 'include',
          headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', 'X-Auth-Request': '1' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller ? controller.signal : undefined
        });
      } catch (error) {
        throw Object.assign(new Error('Could not reach the sign-in service.'), { status: 0, cause: error });
      } finally { if (timer) clearTimeout(timer); }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const text = typeof detail.detail === 'string' ? detail.detail : Array.isArray(detail.detail) ? 'Please check what you typed.' : '';
        throw Object.assign(new Error(text || response.statusText || 'Sign-in failed.'), { status: response.status });
      }
      return response.status === 204 ? null : response.json().catch(() => null);
    }

    return {
      base,
      /** The signed-in account, or null. Never throws: any failure means "not signed in" so a game is never held up. */
      async me() {
        try { return await call('/me'); } catch (error) {
          if (error.status !== 401) return null;
          try { await call('/refresh', { method: 'POST' }); return await call('/me'); } catch { return null; }
        }
      },
      login: (identifier, password) => call('/login', { method: 'POST', body: { email: identifier, password }, timeout: 15000 }),
      logout: () => call('/logout', { method: 'POST' }),
      forgotPassword: (email, returnTo = locationHref().split(/[?#]/)[0]) => call('/forgot-password', { method: 'POST', body: { email, return_to: returnTo }, timeout: 15000 }),
      providerUrl: (provider, returnTo = locationHref()) => `${base}/${provider}/start?return_to=${encodeURIComponent(returnTo)}`
    };
  }

  return { DEFAULT_BASE, NAME_LENGTH, cleanName, accountName, resolvePlayerName, takeAuthError, createSso };
});
