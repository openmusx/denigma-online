// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const [, , rootArg = 'dist', portArg = '8080'] = process.argv;
const root = resolve(rootArg);
const port = Number(portArg);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid port: ${portArg}`);
}
if (!existsSync(root) || !statSync(root).isDirectory()) {
  throw new Error(`Static site directory does not exist: ${root}`);
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(root, relative);
  return candidate.startsWith(`${root}${sep}`) ? candidate : undefined;
}

console.log(`Starting Denigma development server on port ${port}`);

const server = createServer((request, response) => {
  let filePath;
  try {
    filePath = resolveRequestPath(request.url || '/');
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(request.headers['accept-encoding'] || '');
  const gzipPath = `${filePath}.gz`;
  const servedPath = acceptsGzip && existsSync(gzipPath) ? gzipPath : filePath;
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'Vary': 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff'
  };
  if (servedPath === gzipPath) headers['Content-Encoding'] = 'gzip';
  response.writeHead(200, headers);
  createReadStream(servedPath).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Denigma development server ready: http://127.0.0.1:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
