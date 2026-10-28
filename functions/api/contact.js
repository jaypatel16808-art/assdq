// POST /api/contact — receives a callback request.
//
// Order of checks (cheapest first, nothing expensive before the request is known to be ours):
//   1. Required server config present (fail closed)
//   2. Same-origin request (Origin / Sec-Fetch-Site)
//   3. JSON body under 8 KB
//   4. Rate limit: 5 per IP per hour (hashed IP, KV)
//   5. CSRF token: cookie == body, valid HMAC, not expired, not instant
//   6. Honeypot (bots get a fake success)
//   7. Input validation + sanitisation (shared rules with the browser)
//   8. Turnstile verification (server side, secret key from env)
//   9. Email to the shop; nothing is stored by the website

import { isAllowedOrigin, verifyCsrf } from '../../src/lib/csrf.js';
import { checkRateLimit } from '../../src/lib/ratelimit.js';
import { verifyTurnstile } from '../../src/lib/turnstile.js';
import { sendCallbackEmail } from '../../src/lib/email.js';
import { json, fail, methodNotAllowed, clientIp, readJsonBody } from '../../src/lib/http.js';
import { validateCallback } from '../../public/js/validate.js';

const MAX_BODY_BYTES = 8 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function configProblems(env, isLocal) {
  const missing = [];
  if (!env.CSRF_SECRET || env.CSRF_SECRET.length < 32) missing.push('CSRF_SECRET');
  if (!env.TURNSTILE_SECRET_KEY) missing.push('TURNSTILE_SECRET_KEY');
  const consoleTransport = env.EMAIL_TRANSPORT === 'console';
  if (consoleTransport && !isLocal) missing.push('EMAIL_TRANSPORT=console is only allowed on localhost');
  if (!consoleTransport) {
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!env.CONTACT_TO_EMAIL) missing.push('CONTACT_TO_EMAIL');
    if (!env.CONTACT_FROM_EMAIL) missing.push('CONTACT_FROM_EMAIL');
  }
  return missing;
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const isLocal = LOCAL_HOSTS.has(url.hostname);

    const problems = configProblems(env, isLocal);
    if (problems.length) {
      console.error(`Config error: ${problems.join(', ')}`);
      return fail(503, 'unavailable');
    }

    if (!isAllowedOrigin(request, env.ALLOWED_ORIGINS)) {
      return fail(403, 'forbidden', 'This request couldn’t be accepted. Please reload the page and try again.');
    }

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body) return fail(400, 'bad_request', 'This request couldn’t be read. Please reload the page and try again.');

    const ip = clientIp(request);
    const limit = await checkRateLimit({
      kv: env.RATE_LIMIT,
      secret: env.CSRF_SECRET,
      ip,
      limit: Number(env.RATE_LIMIT_MAX) || 5,
      windowSeconds: Number(env.RATE_LIMIT_WINDOW_SECONDS) || 3600,
    });
    if (!env.RATE_LIMIT && !isLocal) console.warn('RATE_LIMIT KV binding missing: using per-instance memory fallback.');
    if (!limit.allowed) {
      return json(
        {
          ok: false,
          error: 'rate_limited',
          message: 'You’ve sent several requests in the last hour. Please call us at (718) 666-7592 instead. We’re open 24 hours.',
        },
        429,
        { 'Retry-After': String(limit.retryAfter) },
      );
    }

    const csrf = await verifyCsrf(request, env.CSRF_SECRET, body.csrfToken);
    if (csrf === 'expired') {
      return fail(403, 'session_expired', 'This page was open for a while. Please press Request callback again.');
    }
    if (csrf === 'too_fast') {
      return fail(400, 'too_fast', 'That was quick. Please check your details and press Request callback again.');
    }
    if (csrf !== 'ok') {
      return fail(403, 'forbidden', 'This request couldn’t be accepted. Please reload the page and try again.');
    }

    // Honeypot: pretend everything worked so bots learn nothing.
    if (typeof body.company === 'string' && body.company.trim() !== '') {
      return json({ ok: true });
    }

    const { ok, values, errors } = validateCallback(body);
    if (!ok) {
      return json({ ok: false, error: 'invalid', message: 'Please check the highlighted fields.', errors }, 422);
    }

    const allowedHostnames = (env.TURNSTILE_HOSTNAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
    const captcha = await verifyTurnstile({
      token: body.turnstileToken,
      secret: env.TURNSTILE_SECRET_KEY,
      ip,
      allowedHostnames,
    });
    if (!captcha.ok) {
      if (captcha.reason === 'unavailable') console.error('Turnstile verification unavailable.');
      return fail(400, 'captcha', 'The security check didn’t go through. Please try it again, or call us at (718) 666-7592.');
    }

    const sent = await sendCallbackEmail(env, values);
    if (!sent.ok) return fail(502, 'delivery_failed');

    return json({ ok: true });
  } catch (err) {
    // Log the error class only. Never echo internals or customer data.
    console.error('Unhandled error in /api/contact:', err?.name || 'Error');
    return fail(500, 'server_error');
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
