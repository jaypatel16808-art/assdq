// Point canonical URLs, Open Graph tags, JSON-LD, robots.txt and sitemap.xml at your real domain.
// Usage:  node scripts/set-domain.mjs https://www.example.com
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT = 'https://vernon-auto-repair.pages.dev';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const arg = (process.argv[2] || '').replace(/\/+$/, '');
let next;
try {
  next = new URL(arg);
  if (next.protocol !== 'https:') throw new Error();
} catch {
  console.error('Give the full https address, for example: node scripts/set-domain.mjs https://www.example.com');
  process.exit(1);
}

const files = (await readdir(root)).filter((f) => /\.(html|txt|xml)$/.test(f));
// Replace the default and any domain set previously (recorded in robots.txt).
const robots = await readFile(path.join(root, 'robots.txt'), 'utf8');
const current = /Sitemap:\s*(https:\/\/[^/\s]+)/.exec(robots)?.[1] || DEFAULT;
let changed = 0;
for (const f of files) {
  const p = path.join(root, f);
  const text = await readFile(p, 'utf8');
  const out = text.split(current).join(next.origin).split(DEFAULT).join(next.origin);
  if (out !== text) { await writeFile(p, out); changed++; }
}
console.log(`Updated ${changed} file(s) to ${next.origin}. Also set ALLOWED_ORIGINS and TURNSTILE_HOSTNAMES in Cloudflare.`);
