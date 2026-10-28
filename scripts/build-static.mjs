// Builds a static-only copy of the site for hosts without serverless functions
// (for example GitHub Pages). The callback form is replaced by a "call us" panel,
// analytics is switched off, and security headers that the host can't send are
// added as <meta> tags where browsers support that.
//
// Usage:  node scripts/build-static.mjs https://user.github.io/repo/ [outDir]
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public');
const out = path.resolve(process.argv[3] || path.join(root, 'dist'));
const DEFAULT = 'https://vernon-auto-repair.pages.dev/';

let site;
try {
  site = new URL(process.argv[2]);
  if (site.protocol !== 'https:') throw new Error();
} catch {
  console.error('Usage: node scripts/build-static.mjs https://user.github.io/repo/ [outDir]');
  process.exit(1);
}
const siteUrl = site.href.endsWith('/') ? site.href : site.href + '/';
const base = new URL(siteUrl).pathname; // e.g. "/repo/"

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  'frame-src https://www.google.com',
  "form-action 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

function transformHtml(html) {
  html = html.split(DEFAULT).join(siteUrl);
  html = html.replace('<html lang="en-US">', '<html lang="en-US" data-form="off">');
  html = html.replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">\n  <meta name="referrer" content="strict-origin-when-cross-origin">`,
  );
  // Root-relative links and assets → under the base path
  html = html.replace(/\b(href|src)="\/(?!\/)/g, `$1="${base}`);
  // No analytics on the static build: drop that option and its mention
  html = html.replace(/\s*<div class="consent-row">\s*<label for="consent-analytics">[\s\S]*?<\/div>/, '');
  html = html.replace(/\s*<p class="gpc-note"[\s\S]*?<\/p>/, '');
  html = html.replace(
    'With your OK, we’ll also count visits with privacy-friendly analytics and load Google Maps.',
    'With your OK, we’ll also load Google Maps.',
  );
  html = html.replace(
    'We use essential cookies to keep this site and the callback form working.',
    'We use one essential cookie to remember your choice.',
  );
  return html;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });
for (const f of ['_headers', '_routes.json']) await rm(path.join(out, f), { force: true });

for (const f of await readdir(out)) {
  const p = path.join(out, f);
  if (f.endsWith('.html')) await writeFile(p, transformHtml(await readFile(p, 'utf8')));
  if (f === 'robots.txt' || f === 'sitemap.xml') {
    await writeFile(p, (await readFile(p, 'utf8')).split(DEFAULT).join(siteUrl));
  }
}

const cssPath = path.join(out, 'css', 'site.css');
await writeFile(cssPath, (await readFile(cssPath, 'utf8')).replace(/url\("\/fonts\//g, `url("${base}fonts/`));

const jsPath = path.join(out, 'js', 'site.js');
await writeFile(jsPath, (await readFile(jsPath, 'utf8')).replace("analyticsSrc: 'https://plausible.io/js/script.js'", "analyticsSrc: ''"));

await writeFile(path.join(out, '.nojekyll'), '');
console.log(`Static build written to ${out} for ${siteUrl}`);
