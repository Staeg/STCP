import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { LobbyManager, parseClientMsg, send, SERVER_TICK, Stash } from '@stcp/shared';
import { fileStore } from './persistence';

const PORT = Number(process.env.GAME_PORT ?? 3001);
const CLIENT_DIST = resolve(fileURLToPath(import.meta.url), '../../../client/dist');

// ---- Static files (production build). In dev, Vite serves the client and proxies /ws here. ----
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
};

const http = createServer((req, res) => {
  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Game server running. In dev, open the Vite client (http://localhost:5180).');
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(CLIENT_DIST, urlPath));
  if (!file.startsWith(CLIENT_DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(CLIENT_DIST, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// ---- Lobbies & games ----
const DEBUG = process.argv.includes('--debug');
const lobbies = new LobbyManager(new Stash(fileStore(process.env.STASH_PATH || undefined)), {
  debug: DEBUG,
  seed: process.env.SEED ? Number(process.env.SEED) : undefined,
  log: (msg) => console.log(msg),
});

const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws) => {
  let token: string | null = null;
  let name = '';

  ws.on('message', (data) => {
    const msg = parseClientMsg(data.toString());
    if (!msg) return;
    if (msg.t === 'ping') return send(ws, { t: 'pong', id: msg.id });
    if (msg.t === 'hello') {
      token = msg.token;
      name = msg.name;
    }
    if (msg.t === 'setName' && msg.name) name = msg.name;
    if (!token) return send(ws, { t: 'error', msg: 'Say hello first.' });
    lobbies.handle(ws, token, name, msg);
  });
  ws.on('close', () => {
    if (token) lobbies.disconnected(ws, token);
  });
});

setInterval(() => lobbies.tick(), SERVER_TICK * 1000);

http.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}${DEBUG ? ' (debug commands enabled)' : ''}`));
