// Response helpers for API routes. Pages Functions responses don't get the
// static _headers file, so every API response carries its own security headers.

export const API_SECURITY_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

export function json(body, status = 200, extraHeaders = {}) {
  const headers = new Headers(API_SECURITY_HEADERS);
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (k.toLowerCase() === 'set-cookie') headers.append(k, v);
    else headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** Generic, non-technical failure. Never include error details, stack traces or config names. */
export const GENERIC_ERROR =
  'We couldn’t send your request just now. Please call us at (718) 666-7592. We’re open 24 hours.';

export function fail(status, error, message = GENERIC_ERROR, extra = {}) {
  return json({ ok: false, error, message, ...extra }, status);
}

export function methodNotAllowed(allow) {
  return json({ ok: false, error: 'method_not_allowed', message: 'Not allowed.' }, 405, { Allow: allow });
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export function clientIp(request) {
  // Set by Cloudflare's edge and can't be spoofed by the client there.
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

/** Reads a JSON body with a hard size cap. Returns null on anything unexpected. */
export async function readJsonBody(request, maxBytes) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) return null;
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
