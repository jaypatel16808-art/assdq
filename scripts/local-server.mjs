// Zero-dependency local preview that behaves like Cloudflare Pages closely enough for testing:
// serves /public with the rules in public/_headers, pretty URLs (/privacy -> privacy.html),
// the custom 404 page, and routes /api/* to the Pages Functions in /functions.
//
// Usage:  node scripts/local-server.mjs [port]
// Reads environment variables from .dev.vars (same format as .env).
// For the real thing, prefer `npx wrangler pages dev` (see README).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const port = Number(process.argv[2] || process.env.PORT || 8788);

function loadEnvFile(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const env = { ...loadEnvFile(path.join(root, '.dev.vars')) };

function parseHeadersFile() {
  const rules = [];
  const file = path.join(publicDir, '_headers');
  if (!existsSync(file)) return rules;
  let current = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: {} }; rules.push(current); continue; }
    const i = line.indexOf(':');
    if (current && i > 0) current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}
const headerRules = parseHeadersFile();
function headersFor(urlPath) {
  const out = {};
  for (const r of headerRules) {
    const re = new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    if (re.test(urlPath)) Object.assign(out, r.headers);
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
};

async function resolveStatic(urlPath) {
  if (urlPath.startsWith('/_')) return null; // _headers, _routes.json are config, not content
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidates = urlPath.endsWith('/')
    ? [path.join(publicDir, clean, 'index.html')]
    : [path.join(publicDir, clean), path.join(publicDir, clean + '.html')];
  for (const file of candidates) {
    if (!file.startsWith(publicDir)) continue;
    try { if ((await stat(file)).isFile()) return file; } catch { /* next */ }
  }
  return null;
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api\//, '').replace(/[^a-z0-9-]/gi, '');
  const file = path.join(root, 'functions', 'api', `${route}.js`);
  if (!existsSync(file)) return false;
  const mod = await import(pathToFileURL(file).href);
  const method = req.method.toUpperCase();
  const handler = mod[`onRequest${method[0]}${method.slice(1).toLowerCase()}`] || mod.onRequest;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('CF-Connecting-IP', req.socket.remoteAddress || '127.0.0.1');
  const request = new Request(url.href, {
    method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handler({ request, env, params: {} });
  const outHeaders = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') outHeaders[k] = v; });
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) outHeaders['set-cookie'] = cookies;
  res.writeHead(response.status, outHeaders);
  res.end(Buffer.from(await response.arrayBuffer()));
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (await handleApi(req, res, url)) return;
    }
    if (url.pathname.endsWith('.html') && url.pathname !== '/404.html' && url.pathname !== '/500.html') {
      const to = url.pathname.replace(/(index)?\.html$/, '');
      res.writeHead(308, { Location: to || '/' });
      return res.end();
    }
    let file = await resolveStatic(url.pathname);
    let status = 200;
    if (!file) { file = path.join(publicDir, '404.html'); status = 404; }
    const body = await readFile(file);
    const servedPath = '/' + path.relative(publicDir, file).split(path.sep).join('/');
    res.writeHead(status, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      ...headersFor(url.pathname),
      ...(servedPath !== url.pathname ? headersFor(servedPath) : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    console.error('Local server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', ...headersFor('/500.html') });
    res.end(await readFile(path.join(publicDir, '500.html')));
  }
});

server.listen(port, () => console.log(`Vernon Auto Repair local preview: http://localhost:${port}`));
