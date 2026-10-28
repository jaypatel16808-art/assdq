# Security and privacy checklist

Status key: **Done** = implemented in this code and tested · **Platform** = provided by a Cloudflare setting you switch on during deployment (steps in README §5) · **N/A** = doesn't apply to this site, with the reason.

Automated tests: `npm test` runs 27 backend tests (all passing). Browser checks were run against the local preview with Playwright.

## API keys and secrets

| Requirement | Status | Where / how |
|---|---|---|
| No API keys, tokens or credentials in front-end code | **Done** | `public/` contains no keys. The only public key (Turnstile site key) is served at runtime by `/api/session` from an env var. |
| Secrets stored only in server-side environment variables | **Done** | `CSRF_SECRET`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY` are read from `env` in `functions/`. Set with `wrangler pages secret put`. |
| Third-party calls with keys go through a backend function | **Done** | Turnstile verification (`src/lib/turnstile.js`) and email sending (`src/lib/email.js`) run only in `/api/contact`. The browser never calls them with a key. |
| Any public key restricted to this domain | **Done / Platform** | Turnstile widget is locked to your hostnames in the Turnstile dashboard, and the server can also enforce `TURNSTILE_HOSTNAMES`. Google Maps uses the key-less embed, so there's no Maps key at all (README §6 covers restricting one if added later). |
| `.env` in `.gitignore` | **Done** | `.gitignore` excludes `.env`, `.env.*` and `.dev.vars`, keeping `.env.example`. |
| `.env.example` with placeholder names only | **Done** | `.env.example` contains only `replace-with-…` placeholders. |
| Server fails closed when config is missing | **Done** | Missing secrets → generic “please call us” (503). Tested. |

## Form and input protection

| Requirement | Status | Where / how |
|---|---|---|
| Validate and sanitize on the client | **Done** | `public/js/validate.js` (inline errors, length limits, character rules). |
| Validate and sanitize on the server | **Done** | The same `validate.js` is imported by `functions/api/contact.js`, so the rules can't drift. Unicode normalized (NFKC); control, zero-width and bidi characters stripped; whitespace collapsed. |
| Length limits | **Done** | Name 2–80, vehicle 2–80, problem 10–1000, phone ≤ 20. HTML `maxlength` too. Request body capped at 8 KB. |
| Allowed characters | **Done** | Name: letters, spaces, `' . , -`. Vehicle: letters, numbers, basic punctuation. Links rejected in all fields. |
| Phone format | **Done** | Valid US (NANP) 10-digit numbers only, with or without +1. Area code and exchange can't start with 0/1. |
| Escape all output (XSS) | **Done** | Email HTML is built with `escapeHtml()` (tested with a `<script>` payload). The browser writes messages only with `textContent`, never `innerHTML` (tested). Email subject stripped of CR/LF to block header injection (tested). |
| Parameterized queries | **N/A** | There's no database. Submissions are emailed, not stored. The only storage is KV rate-limit counters with HMAC keys. |
| Spam protection: Turnstile or reCAPTCHA v3 | **Done** | Cloudflare Turnstile, verified server side with the secret key, client IP and expected `action`. Fails closed if Cloudflare can't be reached (tested). |
| Hidden honeypot field | **Done** | `company` field, off-screen, `aria-hidden`, `tabindex="-1"`. If filled, the server returns a fake success and sends nothing (tested). |
| Rate limiting (5 per IP per hour) | **Done** | `src/lib/ratelimit.js` with Cloudflare KV. The 6th request gets 429 + `Retry-After` (tested). The IP is HMAC-hashed and expires with the window. Optional WAF rule for a second layer (README §6). |
| CSRF protection | **Done** | Signed double-submit token: `/api/session` sets a `__Host-` cookie (HttpOnly, Secure, SameSite=Strict) and returns the same HMAC-signed token. The POST must match the cookie, have a valid signature and be under 2 hours old. Plus `Origin` / `Sec-Fetch-Site` same-origin checks, and a JSON content type, which forces a CORS preflight. Forged, mismatched, expired and cross-site requests are all tested. |
| Bot timing check | **Done** | Tokens younger than 2 seconds are rejected (tested). |
| Clear messages with no technical details | **Done** | Every error is plain language and offers the phone number. Internals are logged by class name only, without customer data (tested). |

## Headers and transport

| Requirement | Status | Where / how |
|---|---|---|
| HTTPS only | **Platform** | Cloudflare Pages serves HTTPS automatically with a managed certificate. |
| HTTP → HTTPS redirect | **Platform** | `*.pages.dev` redirects automatically. For a custom domain, turn on **Always Use HTTPS** (README §5). The CSP also includes `upgrade-insecure-requests`. |
| HSTS | **Done** | `Strict-Transport-Security: max-age=31536000; includeSubDomains` on all pages (`public/_headers`) and API responses (`src/lib/http.js`). |
| Content-Security-Policy with only the sources needed | **Done** | `default-src 'self'`; scripts from self, Turnstile and Plausible; styles and fonts **self only** (no inline styles or scripts anywhere); frames limited to Turnstile and Google Maps; `form-action 'self'`; `object-src 'none'`; `base-uri 'self'`. Google Fonts isn't needed because fonts are self-hosted. API responses use `default-src 'none'`. No CSP violations in browser testing. |
| `X-Content-Type-Options: nosniff` | **Done** | `_headers` and API responses. |
| `X-Frame-Options: DENY` / `frame-ancestors 'none'` | **Done** | Both are sent. |
| `Referrer-Policy: strict-origin-when-cross-origin` | **Done** | `_headers` and API responses. |
| `Permissions-Policy` disabling camera, microphone, geolocation | **Done** | Also payment, USB, sensors and topics. |
| External links use `rel="noopener noreferrer"` | **Done** | Every off-site link (Google Maps, Yelp, policy links). |
| Custom 404 and error pages | **Done** | `404.html` (served automatically by Pages, `noindex`) and `500.html`. API errors are generic JSON. |
| No stack traces or server info shown to users | **Done** | `contact.js` wraps everything in a catch-all that returns a generic message. |

## Privacy and cookies

| Requirement | Status | Where / how |
|---|---|---|
| Consent banner on first visit with Accept all / Reject non-essential / Customize | **Done** | `#cookie-banner` and `#cookie-dialog` (native `<dialog>`, keyboard accessible). |
| Nothing optional loads before opt-in | **Done** | Plausible and Google Maps are only injected after consent (tested: no script or iframe before). Maps can also be loaded once with “Show map” without saving a choice. |
| Choice remembered | **Done** | `vr_consent` first-party cookie, 12 months, SameSite=Lax, Secure on HTTPS. Versioned, so a policy change can ask again. |
| Change later via “Cookie Settings” in the footer | **Done** | On every page; withdrawing consent unloads the map and reloads to remove analytics. |
| Global Privacy Control honored | **Done** | GPC locks visit statistics off, even after “Accept all” (tested). |
| Privacy Policy: what's collected, why, how long, how to delete | **Done** | `/privacy`, with CCPA/CPRA rights, the NY SHIELD Act, a cookie table and deletion by phone or in person. Owner must confirm the commitments listed in README “Before you launch.” |
| Collect only what's needed | **Done** | Four fields. No email, no address, no account. |
| Don't keep submissions longer than necessary | **Done** | Nothing is stored by the website. Emails carry a reminder to delete once handled; the policy states 90 days (owner to confirm). Rate-limit data expires in about an hour. |
| Privacy-friendly analytics, or GA only after consent | **Done** | Plausible (cookieless), loaded only after opt-in. Easy to switch off (README §7). |

## Dependencies and maintenance

| Requirement | Status | Where / how |
|---|---|---|
| Minimal dependencies, no unused libraries | **Done** | Zero runtime dependencies. No framework, CDN, icon font or CSS library. One dev-only tool (`wrangler`). |
| Keep dependencies up to date | **Done** | README §8 covers `npm outdated` and `compatibility_date`. |
| SRI hashes where possible | **Done where possible** | Every script, style and font is first-party, so there's nothing to hash. Turnstile and Plausible are the only third-party scripts, and both providers update them in place and don't support SRI (a hash would break them). They're pinned to exact origins by the CSP instead. |

## Accessibility and SEO (from the brief)

| Requirement | Status | Notes |
|---|---|---|
| WCAG 2.1 AA contrast | **Done** | Body text 14.2:1, muted text 6.6:1, yellow on green 7.3:1, error red 7.2:1, placeholders 4.8:1, star and switch graphics ≥ 3:1. |
| Alt text / labels | **Done** | No photos. Decorative icons are `aria-hidden`; the door sign and star ratings have text labels; every input has a `<label>`. |
| Visible keyboard focus | **Done** | 3px outline (dark on light areas, yellow on dark); form fields get a yellow-and-green ring. |
| Semantic HTML | **Done** | Landmarks, a single `h1`, ordered steps, `dl` for contact facts, `figure`/`blockquote` for reviews, skip link. |
| Respects prefers-reduced-motion | **Done** | Motion is limited to small hover/press transitions, all disabled under reduced motion, including smooth scrolling. |
| Title, meta description, Open Graph, AutoRepair JSON-LD | **Done** | With address, phone, 24/7 hours, 4.6 rating from 157 reviews, Yelp link. 1200×630 share image. `robots.txt` and `sitemap.xml`. |
