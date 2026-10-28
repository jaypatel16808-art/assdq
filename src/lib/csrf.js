// CSRF protection: signed double-submit token.
//
// GET /api/session issues   token = <nonce>.<issuedAtSeconds>.<HMAC(secret, nonce.issuedAt)>
// and sets the same value in a __Host- cookie (HttpOnly, Secure, SameSite=Strict).
// POST /api/contact must send the token in the body (and X-CSRF-Token header), and it must
// match the cookie, carry a valid signature, and be younger than TOKEN_TTL_SECONDS.
// A cross-site attacker can neither read the token nor make the browser send the cookie.

import { hmac, randomToken, safeEqual } from './crypto.js';
import { getCookie } from './http.js';

export const CSRF_COOKIE = '__Host-vcsrf';
export const TOKEN_TTL_SECONDS = 2 * 60 * 60; // 2 hours
export const MIN_FILL_SECONDS = 2;            // faster than any human can fill the form

export async function issueCsrfToken(secret, now = Date.now()) {
  const nonce = randomToken(18);
  const issuedAt = Math.floor(now / 1000);
  const payload = `${nonce}.${issuedAt}`;
  const token = `${payload}.${await hmac(secret, payload)}`;
  const cookie = `${CSRF_COOKIE}=${token}; Path=/; Max-Age=${TOKEN_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
  return { token, cookie };
}

/**
 * @returns {Promise<'ok'|'missing'|'mismatch'|'invalid'|'expired'|'too_fast'>}
 */
export async function verifyCsrf(request, secret, bodyToken, now = Date.now()) {
  const cookieToken = getCookie(request, CSRF_COOKIE);
  const headerToken = request.headers.get('X-CSRF-Token');
  if (!cookieToken || !bodyToken) return 'missing';
  if (typeof bodyToken !== 'string' || bodyToken.length > 200) return 'invalid';
  if (!safeEqual(cookieToken, bodyToken)) return 'mismatch';
  if (headerToken && !safeEqual(headerToken, bodyToken)) return 'mismatch';

  const parts = bodyToken.split('.');
  if (parts.length !== 3) return 'invalid';
  const [nonce, issuedAtRaw, sig] = parts;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^\d{9,11}$/.test(issuedAtRaw)) return 'invalid';
  const expected = await hmac(secret, `${nonce}.${issuedAtRaw}`);
  if (!safeEqual(sig, expected)) return 'invalid';

  const age = Math.floor(now / 1000) - Number(issuedAtRaw);
  if (age < 0 || age > TOKEN_TTL_SECONDS) return 'expired';
  if (age < MIN_FILL_SECONDS) return 'too_fast';
  return 'ok';
}

/**
 * Same-origin check. Browsers always send Origin on cross-origin POSTs and on same-origin
 * fetch POSTs. Sec-Fetch-Site gives a second signal on modern browsers.
 */
export function isAllowedOrigin(request, allowedOriginsCsv) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return false;
  if (!origin) return false;
  const allowed = (allowedOriginsCsv || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowed.length === 0) allowed.push(new URL(request.url).origin);
  return allowed.includes(origin);
}
