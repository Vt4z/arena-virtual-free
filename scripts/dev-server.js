import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../lib/application.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT) || 3000;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function text(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(value);
}

const server = createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch {
    return text(response, 400, 'Endereço inválido.');
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      json(response, 500, { error: error.message || 'Não foi possível concluir a solicitação.' });
    }
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return text(response, 400, 'Endereço inválido.');
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return text(response, 403, 'Acesso negado.');

  try {
    const contents = readFileSync(filePath);
    const contentType = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(contents);
  } catch {
    text(response, 404, 'Página não encontrada.');
  }
});

function announceAddresses() {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`Vestiário disponível em http://localhost:${activePort}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const networkAddress of addresses || []) {
      if (networkAddress.family === 'IPv4' && !networkAddress.internal) console.log(`Acesso na rede local: http://${networkAddress.address}:${activePort}`);
    }
  }
}

server.once('listening', announceAddresses);
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && server.address() === null && server.portFallback !== true) {
    server.portFallback = true;
    console.log(`A porta ${port} já está em uso; tentando ${port + 1}.`);
    server.listen(port + 1, '0.0.0.0');
    return;
  }
  console.error('Não foi possível iniciar o Vestiário:', error.message);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
