// Fixed-window rate limit backed by Cloudflare KV.
// Keys never contain the raw IP: it's HMAC'd with a server secret and the entry expires
// with the window, so nothing identifying is kept beyond an hour.
//
// KV is eventually consistent, so treat this as a strong deterrent rather than an exact
// counter. For a hard edge limit, also add the Cloudflare WAF rate-limiting rule described
// in the README.

import { hmac } from './crypto.js';

const memory = new Map(); // fallback for local development only

export async function checkRateLimit({ kv, secret, ip, limit = 5, windowSeconds = 3600, now = Date.now() }) {
  const windowId = Math.floor(now / 1000 / windowSeconds);
  const ipKey = (await hmac(secret, `rl:${ip}`)).slice(0, 32);
  const key = `rl:contact:${ipKey}:${windowId}`;
  const retryAfter = windowSeconds - (Math.floor(now / 1000) % windowSeconds);

  let count;
  if (kv) {
    count = Number((await kv.get(key)) || 0);
    if (count >= limit) return { allowed: false, retryAfter };
    await kv.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds + 60) });
  } else {
    for (const [k, v] of memory) if (v.expires < now) memory.delete(k);
    const entry = memory.get(key) || { count: 0, expires: now + windowSeconds * 1000 };
    count = entry.count;
    if (count >= limit) return { allowed: false, retryAfter };
    entry.count += 1;
    memory.set(key, entry);
  }
  return { allowed: true, remaining: limit - count - 1, retryAfter };
}

export function _resetMemoryStore() { memory.clear(); }
