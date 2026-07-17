// Anonymous pilot session against the relay's better-auth endpoints.
// The token lives in localStorage: same browser = same pilot, and nobody
// can wear your name/color without it. CloudFront strips the Authorization
// header, so authenticated calls send the token as x-auth-token instead
// (the relay shims it back).
const TOKEN_KEY = 'akash.session.v1';

export const RELAY_HTTP = import.meta.env.VITE_AKASH_RELAY
  || 'https://d1pksxqb8ts7db.cloudfront.net';

export async function ensureSession(httpBase = RELAY_HTTP) {
  const cached = localStorage.getItem(TOKEN_KEY);
  if (cached) return cached;
  const res = await fetch(`${httpBase}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`anonymous sign-in failed: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const token = res.headers.get('set-auth-token') || body.token;
  if (!token) throw new Error('anonymous sign-in returned no token');
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

// Single-use, short-lived websocket connection ticket (the session token
// itself never rides a ws URL). Minted fresh for every connect/reconnect.
export async function mintTicket(httpBase = RELAY_HTTP) {
  const token = await ensureSession(httpBase);
  const res = await fetch(`${httpBase}/ws-ticket`, {
    method: 'POST',
    headers: { 'x-auth-token': token },
  });
  if (res.status === 401) {
    clearSession(); // stale session — the next attempt signs in fresh
    throw new Error('session expired');
  }
  if (!res.ok) throw new Error(`ticket mint failed: ${res.status}`);
  return (await res.json()).ticket;
}

export async function pushProfile({ name, color }, httpBase = RELAY_HTTP) {
  const token = await ensureSession(httpBase);
  const res = await fetch(`${httpBase}/api/auth/update-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth-token': token },
    body: JSON.stringify({ name: name || '', color: color || '' }),
  });
  return res.ok;
}
