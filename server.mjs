import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(directory, 'index.html');
const upstream = {
  group: 'https://bhlhnwmdvcyksbeujemd.supabase.co/functions/v1/group',
  receipt: 'https://bhlhnwmdvcyksbeujemd.supabase.co/functions/v1/receipt'
};
const MAX_BODY_BYTES = 9 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 9000;

function send(res, status, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    ...extra
  });
  res.end(body);
}

async function readBody(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new Error('Файл слишком большой');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function passthroughHeaders(req) {
  const headers = {};
  const contentType = req.headers['content-type'];
  const session = req.headers['x-kopilka-session'];
  if (contentType) headers['Content-Type'] = contentType;
  if (session) headers['X-Kopilka-Session'] = session;
  return headers;
}

async function fetchUpstream(target, options = {}) {
  const response = await fetch(target, {
    ...options,
    signal: options.signal || AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  });
  const payload = Buffer.from(await response.arrayBuffer());
  const headers = {};
  for (const name of ['content-type', 'content-disposition']) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return { status: response.status, payload, headers };
}

// Supabase Edge Functions can be cold on their first request. Warm the public
// read once when the Layero runtime starts so the browser's first API call does
// not spend the whole request budget waiting for the external function.
let warmGroupPromise = null;
function startGroupWarmup() {
  warmGroupPromise = fetchUpstream(upstream.group, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }).catch(() => null);
  return warmGroupPromise;
}
startGroupWarmup();

async function proxy(req, res, target) {
  try {
    const method = req.method || 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
    const session = req.headers['x-kopilka-session'];

    if (target === upstream.group && method === 'GET' && !session) {
      const warmed = await warmGroupPromise;
      if (warmed) {
        send(res, warmed.status, warmed.payload, warmed.headers['content-type'] || 'application/json; charset=utf-8', {
          ...(warmed.headers['content-disposition'] ? { 'Content-Disposition': warmed.headers['content-disposition'] } : {})
        });
        startGroupWarmup();
        return;
      }
    }

    const targetUrl = target === upstream.receipt
      ? `${target}${new URL(req.url, 'http://localhost').search}`
      : target;
    const result = await fetchUpstream(targetUrl, {
      method,
      headers: passthroughHeaders(req),
      body: body?.length ? body : undefined
    });
    send(res, result.status, result.payload, result.headers['content-type'] || 'application/octet-stream', {
      ...(result.headers['content-disposition'] ? { 'Content-Disposition': result.headers['content-disposition'] } : {})
    });
    if (target === upstream.group && method !== 'GET') startGroupWarmup();
  } catch (error) {
    send(res, 502, JSON.stringify({ error: 'Не удалось связаться с базой. Повторите через минуту.' }), 'application/json; charset=utf-8');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/api/group') return proxy(req, res, upstream.group);
  if (url.pathname === '/api/receipt') return proxy(req, res, upstream.receipt);
  if (url.pathname === '/health') return send(res, 200, 'ok');
  if (url.pathname !== '/' && url.pathname !== '/index.html') return send(res, 404, 'Не найдено');

  try {
    const source = await readFile(pagePath, 'utf8');
    const localPage = source
      .replace("const API='https://bhlhnwmdvcyksbeujemd.supabase.co/functions/v1/group';", "const API='/api/group';")
      .replace("const RECEIPT='https://bhlhnwmdvcyksbeujemd.supabase.co/functions/v1/receipt';", "const RECEIPT='/api/receipt';");
    send(res, 200, localPage, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 500, 'Не удалось загрузить сайт');
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
