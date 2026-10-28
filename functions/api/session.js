// GET /api/session
// Issues a fresh CSRF token (also set as a __Host- cookie) and the public Turnstile site key.
// The site key is public by design; serving it from env means no keys live in the HTML or JS.

import { issueCsrfToken } from '../../src/lib/csrf.js';
import { json, fail, methodNotAllowed } from '../../src/lib/http.js';

export async function onRequestGet({ env }) {
  if (!env.CSRF_SECRET || env.CSRF_SECRET.length < 32) {
    console.error('Config error: CSRF_SECRET is missing or shorter than 32 characters.');
    return fail(503, 'unavailable');
  }
  const { token, cookie } = await issueCsrfToken(env.CSRF_SECRET);
  // If email or CAPTCHA isn't configured yet, the page swaps the form for a "call us" panel.
  const emailReady = env.EMAIL_TRANSPORT === 'console'
    || Boolean(env.RESEND_API_KEY && env.CONTACT_TO_EMAIL && env.CONTACT_FROM_EMAIL);
  const formEnabled = Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && emailReady);
  return json(
    { csrfToken: token, turnstileSiteKey: env.TURNSTILE_SITE_KEY || '', formEnabled },
    200,
    { 'Set-Cookie': cookie },
  );
}

export function onRequest() {
  return methodNotAllowed('GET');
}
