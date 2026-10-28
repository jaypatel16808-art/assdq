// Run with:  npm test   (Node 20+, no dependencies)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet as sessionGet, onRequest as sessionOther } from '../functions/api/session.js';
import { onRequestPost as contactPost, onRequest as contactOther } from '../functions/api/contact.js';
import { issueCsrfToken, CSRF_COOKIE } from '../src/lib/csrf.js';
import { _resetMemoryStore } from '../src/lib/ratelimit.js';
import { escapeHtml, headerSafe, buildCallbackEmail } from '../src/lib/email.js';
import { validateCallback, normalizePhone, clean } from '../public/js/validate.js';

const ORIGIN = 'https://vernonauto.example';
const SECRET = 'test-secret-that-is-definitely-longer-than-32-chars';

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
  };
}

function makeEnv(overrides = {}) {
  return {
    CSRF_SECRET: SECRET,
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    RESEND_API_KEY: 're_test_key',
    CONTACT_TO_EMAIL: 'shop@vernonauto.example',
    CONTACT_FROM_EMAIL: 'Website <web@vernonauto.example>',
    ALLOWED_ORIGINS: ORIGIN,
    RATE_LIMIT: makeKv(),
    ...overrides,
  };
}

const goodFields = {
  name: 'Maria Lopez',
  phone: '(718) 555-0123',
  vehicle: 'Honda Accord',
  problem: 'Battery light is on and the car will not start in the morning.',
  company: '',
  turnstileToken: 'turnstile-ok',
};

async function oldToken(ageSeconds = 30) {
  return issueCsrfToken(SECRET, Date.now() - ageSeconds * 1000);
}

async function contactRequest({ body, token, cookieToken, headers = {}, ip = '203.0.113.7' } = {}) {
  const t = token ?? (await oldToken()).token;
  const payload = body ?? { ...goodFields, csrfToken: t };
  const h = {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': ip,
    Cookie: `${CSRF_COOKIE}=${cookieToken ?? t}`,
    'X-CSRF-Token': t,
    ...headers,
  };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  return new Request(`${ORIGIN}/api/contact`, {
    method: 'POST',
    headers: h,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

// --- fetch mock for Turnstile + Resend ---
let calls;
let turnstileResult;
let resendStatus;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  turnstileResult = { success: true, action: 'callback', hostname: 'vernonauto.example' };
  resendStatus = 200;
  _resetMemoryStore();
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('turnstile')) {
      if (turnstileResult === 'network') throw new TypeError('network down');
      return new Response(JSON.stringify(turnstileResult), { status: 200 });
    }
    if (String(url).includes('resend')) return new Response('{}', { status: resendStatus });
    throw new Error('unexpected fetch ' + url);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const emailCalls = () => calls.filter((c) => c.url.includes('resend'));
const body = async (res) => res.json();

/* ---------------- /api/session ---------------- */

test('session issues a signed token and a hardened __Host- cookie', async () => {
  const res = await sessionGet({ env: makeEnv() });
  assert.equal(res.status, 200);
  const data = await body(res);
  assert.match(data.csrfToken, /^[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+$/);
  assert.equal(data.turnstileSiteKey, 'site-key');
  const cookie = res.headers.get('Set-Cookie');
  assert.match(cookie, /^__Host-vcsrf=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(flag), flag);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('session fails closed without a strong CSRF secret, without leaking config names', async () => {
  const res = await sessionGet({ env: makeEnv({ CSRF_SECRET: 'short' }) });
  assert.equal(res.status, 503);
  const text = JSON.stringify(await body(res));
  assert.ok(!text.includes('CSRF_SECRET'));
});

test('session rejects other methods', async () => {
  assert.equal(sessionOther().status, 405);
});

/* ---------------- /api/contact: happy path ---------------- */

test('valid request sends one email with the key in the server-side header only', async () => {
  const res = await contactPost({ request: await contactRequest(), env: makeEnv() });
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { ok: true });
  const sent = emailCalls();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.headers.Authorization, 'Bearer re_test_key');
  const payload = JSON.parse(sent[0].init.body);
  assert.deepEqual(payload.to, ['shop@vernonauto.example']);
  assert.ok(payload.text.includes('(718) 555-0123'));
  // Turnstile was verified with the secret and client IP
  const ts = calls.find((c) => c.url.includes('turnstile'));
  assert.equal(ts.init.body.get('secret'), 'turnstile-secret');
  assert.equal(ts.init.body.get('remoteip'), '203.0.113.7');
});

test('HTML in the message is escaped in the email (no XSS)', async () => {
  const t = (await oldToken()).token;
  const payload = { ...goodFields, problem: 'Brakes squeal <script>alert(1)</script> & grind "badly"', csrfToken: t };
  const res = await contactPost({ request: await contactRequest({ body: payload, token: t }), env: makeEnv() });
  assert.equal(res.status, 200);
  const html = JSON.parse(emailCalls()[0].init.body).html;
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; grind &quot;badly&quot;'));
});

/* ---------------- origin / CSRF ---------------- */

test('rejects a foreign Origin', async () => {
  const res = await contactPost({ request: await contactRequest({ headers: { Origin: 'https://evil.example' } }), env: makeEnv() });
  assert.equal(res.status, 403);
  assert.equal(emailCalls().length, 0);
});

test('rejects cross-site Sec-Fetch-Site and a missing Origin', async () => {
  let res = await contactPost({ request: await contactRequest({ headers: { 'Sec-Fetch-Site': 'cross-site' } }), env: makeEnv() });
  assert.equal(res.status, 403);
  res = await contactPost({ request: await contactRequest({ headers: { Origin: undefined } }), env: makeEnv() });
  assert.equal(res.status, 403);
});

test('rejects a missing CSRF cookie', async () => {
  const req = await contactRequest({ headers: { Cookie: undefined } });
  const res = await contactPost({ request: req, env: makeEnv() });
  assert.equal(res.status, 403);
});

test('rejects a token that does not match the cookie', async () => {
  const other = (await oldToken()).token;
  const res = await contactPost({ request: await contactRequest({ cookieToken: other }), env: makeEnv() });
  assert.equal(res.status, 403);
});

test('rejects a forged signature', async () => {
  const forged = `${'a'.repeat(24)}.${Math.floor(Date.now() / 1000) - 60}.${'b'.repeat(43)}`;
  const res = await contactPost({ request: await contactRequest({ token: forged }), env: makeEnv() });
  assert.equal(res.status, 403);
  assert.equal((await body(res)).error, 'forbidden');
});

test('expired token asks the browser to refresh', async () => {
  const t = (await oldToken(3 * 60 * 60)).token;
  const res = await contactPost({ request: await contactRequest({ token: t }), env: makeEnv() });
  assert.equal(res.status, 403);
  assert.equal((await body(res)).error, 'session_expired');
});

test('instant submissions are treated as bots', async () => {
  const t = (await issueCsrfToken(SECRET)).token;
  const res = await contactPost({ request: await contactRequest({ token: t }), env: makeEnv() });
  assert.equal(res.status, 400);
  assert.equal(emailCalls().length, 0);
});

/* ---------------- body handling ---------------- */

test('rejects non-JSON and oversized bodies', async () => {
  let res = await contactPost({ request: await contactRequest({ headers: { 'Content-Type': 'text/plain' } }), env: makeEnv() });
  assert.equal(res.status, 400);
  const t = (await oldToken()).token;
  const huge = { ...goodFields, csrfToken: t, problem: 'x'.repeat(10000) };
  res = await contactPost({ request: await contactRequest({ body: huge, token: t }), env: makeEnv() });
  assert.equal(res.status, 400);
  res = await contactPost({ request: await contactRequest({ body: '{not json', token: t }), env: makeEnv() });
  assert.equal(res.status, 400);
});

/* ---------------- spam ---------------- */

test('honeypot gets a fake success and no email', async () => {
  const t = (await oldToken()).token;
  const res = await contactPost({ request: await contactRequest({ body: { ...goodFields, company: 'Spam LLC', csrfToken: t }, token: t }), env: makeEnv() });
  assert.equal(res.status, 200);
  assert.equal(emailCalls().length, 0);
  assert.equal(calls.length, 0, 'Turnstile not even called');
});

test('failed Turnstile check blocks the request', async () => {
  turnstileResult = { success: false, 'error-codes': ['invalid-input-response'] };
  const res = await contactPost({ request: await contactRequest(), env: makeEnv() });
  assert.equal(res.status, 400);
  assert.equal((await body(res)).error, 'captcha');
  assert.equal(emailCalls().length, 0);
});

test('Turnstile outage fails closed', async () => {
  turnstileResult = 'network';
  const res = await contactPost({ request: await contactRequest(), env: makeEnv() });
  assert.equal(res.status, 400);
  assert.equal(emailCalls().length, 0);
});

test('Turnstile hostname must match when configured', async () => {
  turnstileResult = { success: true, action: 'callback', hostname: 'evil.example' };
  const res = await contactPost({ request: await contactRequest(), env: makeEnv({ TURNSTILE_HOSTNAMES: 'vernonauto.example' }) });
  assert.equal(res.status, 400);
});

/* ---------------- rate limit ---------------- */

test('allows 5 requests per IP per hour, then 429 with Retry-After', async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) {
    const res = await contactPost({ request: await contactRequest(), env });
    assert.equal(res.status, 200, `request ${i + 1}`);
  }
  const res = await contactPost({ request: await contactRequest(), env });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('Retry-After')) > 0);
  // a different IP is unaffected
  const other = await contactPost({ request: await contactRequest({ ip: '198.51.100.2' }), env });
  assert.equal(other.status, 200);
  // raw IPs are never stored
  for (const key of env.RATE_LIMIT.store.keys()) assert.ok(!key.includes('203.0.113.7'));
});

/* ---------------- validation ---------------- */

test('invalid fields return 422 with per-field messages', async () => {
  const t = (await oldToken()).token;
  const bad = { ...goodFields, name: '', phone: '12345', vehicle: 'x', problem: 'short', csrfToken: t };
  const res = await contactPost({ request: await contactRequest({ body: bad, token: t }), env: makeEnv() });
  assert.equal(res.status, 422);
  const data = await body(res);
  assert.deepEqual(Object.keys(data.errors).sort(), ['name', 'phone', 'problem', 'vehicle']);
  assert.equal(emailCalls().length, 0);
});

test('phone normalisation accepts US formats and rejects junk', () => {
  for (const ok of ['(718) 666-7592', '718-666-7592', '+1 718 666 7592', '17186667592', '718.666.7592']) {
    assert.equal(normalizePhone(ok), '7186667592', ok);
  }
  for (const bad of ['12345', '(018) 666-7592', '718-066-7592', '718666759', '718-666-7592 ext 2', '+44 20 7946 0958', 'call me']) {
    assert.equal(normalizePhone(bad), null, bad);
  }
});

test('clean() strips control, zero-width and bidi characters', () => {
  const zw = String.fromCharCode(0x200b);
  const rlo = String.fromCharCode(0x202e);
  const nul = String.fromCharCode(0);
  assert.equal(clean(`Ma${zw}ria${nul} ${rlo}Lopez`), 'Maria Lopez');
  assert.equal(clean('line one\r\n\r\n\r\n\r\nline two', { multiline: true }), 'line one\n\nline two');
});

test('validation rejects links and odd characters', () => {
  const base = { name: 'Sam Lee', phone: '7185550123', vehicle: 'Ford F-150', problem: 'Engine light came on yesterday.' };
  assert.ok(validateCallback(base).ok);
  assert.ok(validateCallback({ ...base, problem: 'Cheap parts at https://spam.example now' }).errors.problem);
  assert.ok(validateCallback({ ...base, name: '<img src=x>' }).errors.name);
  assert.ok(validateCallback({ ...base, vehicle: 'www.spam.example' }).errors.vehicle);
  assert.ok(validateCallback({ ...base, name: "José O'Brien-Núñez" }).ok);
});

/* ---------------- failure handling ---------------- */

test('missing server config fails closed with a generic message', async () => {
  const res = await contactPost({ request: await contactRequest(), env: makeEnv({ RESEND_API_KEY: '' }) });
  assert.equal(res.status, 503);
  const data = await body(res);
  assert.equal(data.error, 'unavailable');
  assert.ok(!/RESEND|API|key|stack|exception/i.test(data.message), data.message);
});

test('console email transport is refused outside localhost', async () => {
  const res = await contactPost({ request: await contactRequest(), env: makeEnv({ EMAIL_TRANSPORT: 'console' }) });
  assert.equal(res.status, 503);
});

test('email provider failure returns a friendly 502 with no details', async () => {
  resendStatus = 500;
  const res = await contactPost({ request: await contactRequest(), env: makeEnv() });
  assert.equal(res.status, 502);
  const data = await body(res);
  assert.match(data.message, /call us/i);
});

test('other methods on /api/contact get 405', async () => {
  const res = contactOther();
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
});

/* ---------------- email helpers ---------------- */

test('email subject cannot carry header injection', () => {
  assert.equal(headerSafe('Hi\r\nBcc: victim@example.com'), 'Hi Bcc: victim@example.com');
  const { subject } = buildCallbackEmail({ name: 'A B', phone: '7185550123', vehicle: 'Kia Soul', problem: 'Noise from the back' });
  assert.ok(!/[\r\n]/.test(subject));
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
