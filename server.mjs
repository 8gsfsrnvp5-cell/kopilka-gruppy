import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(directory, 'index.html');
const upstreamBase = 'https://temporary-fleet-onyx-3j7do9o.vercel.app';

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, 'ok');
  if (url.pathname === '/api/group' || url.pathname === '/api/receipt') {
    const endpoint = url.pathname === '/api/group' ? 'group' : 'receipt';
    const target = new URL(`${upstreamBase}/${endpoint}`);
    target.search = url.search;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const headers = {};
      const contentType = req.headers['content-type'];
      const session = req.headers['x-kopilka-session'];
      if (contentType) headers['content-type'] = contentType;
      if (session) headers['x-kopilka-session'] = session;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });
      const responseBody = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(responseBody);
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Сервер базы не ответил за 20 секунд'
        : 'Не удалось связаться с общей базой';
      send(res, 502, JSON.stringify({ error: message }), 'application/json; charset=utf-8');
    } finally {
      clearTimeout(timer);
    }
    return;
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') return send(res, 404, 'Не найдено');
  try {
    const page = await readFile(pagePath, 'utf8');
    send(res, 200, page, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 500, 'Не удалось загрузить сайт');
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
