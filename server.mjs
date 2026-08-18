import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(directory, 'index.html');

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
  if (url.pathname !== '/' && url.pathname !== '/index.html') return send(res, 404, 'Не найдено');
  try {
    const page = await readFile(pagePath, 'utf8');
    send(res, 200, page, 'text/html; charset=utf-8', { 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 500, 'Не удалось загрузить сайт');
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0');
