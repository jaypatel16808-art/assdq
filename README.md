# Vernon Auto Repair website

The website for Vernon Auto Repair, 38-01 Vernon Blvd, Long Island City, NY 11101.

It's a fast static site (plain HTML, CSS and JavaScript, no framework) with two small serverless functions that handle the callback form. It's built for **Cloudflare Pages**, which provides free hosting, automatic HTTPS, the Turnstile spam check and the key-value store used for rate limiting.

- No runtime dependencies. The only dev dependency is Cloudflare's `wrangler` CLI.
- No API keys or secrets in the front-end code. All of them live in Cloudflare environment variables.
- Fonts (Big Shoulders Display and Public Sans, both SIL Open Font License) are self-hosted, so no Google Fonts requests.

```
public/                 Everything that gets published
  index.html            Home page (all sections)
  privacy.html          Privacy Policy (served at /privacy)
  404.html, 500.html    Custom error pages
  css/site.css          All styles
  js/site.js            Menu, cookie consent, map loader, callback form
  js/validate.js        Form validation, shared by the browser AND the server
  img/                  Icon sprite, social share image
  fonts/                Self-hosted fonts + licences
  _headers              Security headers (CSP, HSTS, etc.) for static files
  _routes.json          Only /api/* runs serverless code; everything else is static
functions/api/
  session.js            GET  /api/session  → CSRF token + public CAPTCHA site key
  contact.js            POST /api/contact  → validate, check, email the shop
src/lib/                Server helpers: CSRF, rate limit, Turnstile, email, HTTP
tests/api.test.mjs      27 automated tests for the form backend (npm test)
scripts/
  local-server.mjs      No-install local preview that mimics Cloudflare Pages
  set-domain.mjs        Switches canonical/OG/sitemap URLs to your real domain
SECURITY-CHECKLIST.md   Every security and privacy requirement, and where it's done
```

---

## Before you launch: confirm these with the owner

The site uses only the business details supplied. A few things in the Privacy Policy are commitments the shop has to actually keep, so get a yes on each:

1. **Callback emails are deleted within 90 days** of being handled (Privacy Policy → “How long we keep it”). Change the number in `public/privacy.html` if the owner prefers another period.
2. **Only shop staff can read the inbox** that receives callback requests (mentioned under “New York residents”).
3. **Deletion requests are taken by phone or in person**, answered within 45 days. There's no shop email address in the brief, so none is listed. If the owner wants one, add it to the Privacy Policy.
4. **Visit statistics**: the site is wired for Plausible Analytics (paid, privacy-friendly). If the owner doesn't want analytics, see “Turning analytics off” below.

Also worth knowing: Google doesn't show review stars in search results for a business's own rating markup. The rating is in the structured data because it's accurate and useful to other services, but it won't make stars appear on Google.

---

## Hosting on GitHub Pages (static, form switched off)

The site is currently live on GitHub Pages at **https://jaypatel16808-art.github.io/assdq/**. GitHub Pages can't run the form backend or send custom headers, so this version:

- shows a “Call the shop” panel instead of the callback form, so no customer data is collected,
- has no analytics,
- sets its Content-Security-Policy and Referrer-Policy as `<meta>` tags (GitHub serves `github.io` over HTTPS with HSTS).

To update it after editing files in `public/`:

```bash
node scripts/build-static.mjs https://jaypatel16808-art.github.io/assdq/ dist
# then publish the contents of dist/ to the gh-pages branch
```

If you rename the repository, pass the new address to the build script and republish. To switch on the callback form, deploy to Cloudflare Pages as described above. The form then appears automatically once the email and Turnstile settings are in place.

---

## 1. Accounts you need

| Service | Why | Cost |
|---|---|---|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | Hosting, HTTPS, Turnstile, KV | Free plan is enough |
| [Resend](https://resend.com) | Delivers callback requests to the shop's inbox | Free tier covers a small shop |
| [Plausible](https://plausible.io) | Optional visit statistics | Paid; optional |

In **Cloudflare → Turnstile → Add widget**: name it “Vernon Auto Repair”, add your domain (and `localhost` for testing), mode **Managed**. Copy the **site key** and **secret key**.

In **Resend**: add and verify the domain you'll send from (for example `vernonautorepair.com`), then create an API key with **Sending access** only.

## 2. Environment variables

Set these in Cloudflare, never in the code. `.env.example` lists them with placeholder values.

| Name | Secret? | What it is |
|---|---|---|
| `CSRF_SECRET` | Yes | Random string, 32+ characters. Signs form tokens and hashes IPs. Generate with `openssl rand -base64 48`. |
| `TURNSTILE_SECRET_KEY` | Yes | Turnstile secret key |
| `RESEND_API_KEY` | Yes | Resend API key (sending access only) |
| `TURNSTILE_SITE_KEY` | No (public) | Turnstile site key. Served by `/api/session`, so nothing is hard-coded in the HTML. |
| `CONTACT_TO_EMAIL` | No | Inbox that receives requests (comma-separate several) |
| `CONTACT_FROM_EMAIL` | No | Sender on your verified Resend domain, e.g. `Vernon Auto Repair Website <callbacks@yourdomain.com>` |
| `ALLOWED_ORIGINS` | No | Sites allowed to post the form, e.g. `https://yourdomain.com,https://www.yourdomain.com` |
| `TURNSTILE_HOSTNAMES` | No | Optional. Hostnames Turnstile must report, e.g. `yourdomain.com,www.yourdomain.com` |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS` | No | Default 5 per 3600 s, set in `wrangler.toml` |
| `RATE_LIMIT` | — | KV namespace **binding** (not a variable), set in `wrangler.toml` |

If a required secret is missing, the form fails closed: visitors see “please call us” and the reason is written to the Cloudflare function log, never to the page.

## 3. Run it locally

Needs Node.js 20 or newer.

```bash
npm install
cp .env.example .dev.vars        # .dev.vars is git-ignored
```

Edit `.dev.vars` for local testing. Cloudflare publishes test keys that always pass:

```
CSRF_SECRET=any-local-string-at-least-32-characters-long
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
EMAIL_TRANSPORT=console          # don't send real email while testing
```

Then:

```bash
npm run dev        # Cloudflare's local runtime → http://localhost:8788
npm test           # backend tests
```

`EMAIL_TRANSPORT=console` only works on `localhost`. On any other host the form refuses to run with it.

No-install alternative for a quick look: `node scripts/local-server.mjs`. It serves the site with the same headers and runs the functions on Node.

## 4. Deploy to Cloudflare Pages

```bash
npx wrangler login

# Rate-limit store: create it, then paste the printed id into wrangler.toml
npx wrangler kv namespace create RATE_LIMIT

# First deploy creates the project
npm run deploy

# Add each secret/variable (you'll be prompted for the value)
npx wrangler pages secret put CSRF_SECRET
npx wrangler pages secret put TURNSTILE_SECRET_KEY
npx wrangler pages secret put RESEND_API_KEY
npx wrangler pages secret put TURNSTILE_SITE_KEY
npx wrangler pages secret put CONTACT_TO_EMAIL
npx wrangler pages secret put CONTACT_FROM_EMAIL
npx wrangler pages secret put ALLOWED_ORIGINS
npx wrangler pages secret put TURNSTILE_HOSTNAMES

# Deploy again so the functions pick them up
npm run deploy
```

Prefer clicking? In the dashboard, **Workers & Pages → Create → Pages → Connect to Git**, pick the repo, leave the build command empty and set the output directory to `public`. Add the variables under **Settings → Variables and Secrets** (mark the secret ones as *Encrypted*), and the KV binding `RATE_LIMIT` under **Settings → Bindings**.

The site is then live at `https://vernon-auto-repair.pages.dev`.

## 5. Custom domain and HTTPS

1. **Pages project → Custom domains → Set up a domain.** Add both `yourdomain.com` and `www.yourdomain.com`.
2. Update the site's own URLs: `npm run set-domain -- https://yourdomain.com`, then redeploy.
3. Set `ALLOWED_ORIGINS` and `TURNSTILE_HOSTNAMES` to the new domain, and add it to the Turnstile widget's hostname list.
4. In the domain's **SSL/TLS** settings:
   - **Edge Certificates → Always Use HTTPS: On** (redirects every `http://` request to `https://`).
   - **Minimum TLS Version: 1.2**.
   - HSTS is already sent by the site (`max-age` one year, subdomains included). Only add `preload` once you're sure every subdomain serves HTTPS.
5. To send `www` to the bare domain (or the reverse), add a **Bulk Redirect** in the Cloudflare dashboard.

## 6. Extra hardening (recommended)

- **Edge rate limit.** The function already limits 5 requests per IP per hour. For a second layer, add a WAF rate-limiting rule in **Security → WAF → Rate limiting rules** matching `URI Path equals /api/contact` and `Method equals POST`. Available periods depend on your plan.
- **Google Maps.** The map uses Google's key-less embed, so there's no Maps key to leak. If you ever switch to the Maps Embed API with a key, restrict it in Google Cloud Console to **HTTP referrers** `https://yourdomain.com/*` and to the **Maps Embed API** only.
- **Resend key** should have *Sending access* for your domain only, not full access.
- **Rotate secrets** (`CSRF_SECRET`, Turnstile secret, Resend key) if anyone who had access leaves.

## 7. Common changes

- **Phone, hours, services or text:** edit `public/index.html`. The business details also appear in the JSON-LD block in its `<head>`, in the footer of every page and in `public/privacy.html`.
- **Turning analytics off:** set `analyticsSrc: ''` in `public/js/site.js`, remove `https://plausible.io` from the CSP in `public/_headers`, and remove the “Visit statistics” row from the cookie dialog and Privacy Policy.
- **Changing the Privacy Policy materially:** bump `consentVersion` in `public/js/site.js` so visitors are asked again, and update the date at the top of the policy.
- **Cache busting:** after editing CSS or JS, bump `?v=1` on the `<link>`/`<script>` tags in each HTML file.

## 8. Maintenance

- `npm outdated` every few months; keep `wrangler` current. It's the only dependency and it never reaches the browser.
- Move `compatibility_date` in `wrangler.toml` forward when you upgrade.
- Check the Cloudflare function logs now and then for `Config error` or `Turnstile verification unavailable`.
- Review the Privacy Policy once a year, or whenever what the form collects changes.

This README and the Privacy Policy are practical guidance, not legal advice. A short review by a lawyer is worthwhile before launch.
