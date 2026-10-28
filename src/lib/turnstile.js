// Server-side verification of a Cloudflare Turnstile token.
// The secret key only ever lives in server environment variables.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile({ token, secret, ip, expectedAction = 'callback', allowedHostnames = [], fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return { ok: false, reason: 'missing' };

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip && ip !== '0.0.0.0') body.append('remoteip', ip);
  body.append('idempotency_key', crypto.randomUUID());

  let outcome;
  try {
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    outcome = await res.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (!outcome || outcome.success !== true) return { ok: false, reason: 'rejected' };
  if (expectedAction && outcome.action && outcome.action !== expectedAction) return { ok: false, reason: 'action' };
  if (allowedHostnames.length && outcome.hostname && !allowedHostnames.includes(outcome.hostname)) {
    return { ok: false, reason: 'hostname' };
  }
  return { ok: true };
}
