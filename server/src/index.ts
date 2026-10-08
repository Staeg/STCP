import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  addHero, applyIntent, buildView, CLASS_IDS, createWorld, parseClientMsg, SERVER_TICK, step,
  type ServerMsg, type World,
} from '@stcp/shared';

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

// ---- Game (M1: one shared dev world, one hero per connection; lobbies come in M2) ----
let world: World | null = null;
const sockets = new Map<WebSocket, string>();
let nextHero = 1;

function getWorld(): World {
  if (!world || world.phase !== 'running') {
    const seed = Number(process.env.SEED ?? Math.floor(Math.random() * 1e9));
    world = createWorld(seed);
    console.log(`New world, seed ${seed}`);
    for (const [ws, id] of sockets) {
      addHero(world, { id, name: id, cls: CLASS_IDS[0] });
      send(ws, { t: 'welcome', heroId: id });
    }
  }
  return world;
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws) => {
  const w = getWorld();
  const heroId = `Hero ${nextHero}`;
  const cls = CLASS_IDS[(nextHero - 1) % CLASS_IDS.length];
  nextHero++;
  addHero(w, { id: heroId, name: heroId, cls });
  sockets.set(ws, heroId);
  send(ws, { t: 'welcome', heroId });

  ws.on('message', (data) => {
    const msg = parseClientMsg(data.toString());
    if (!msg) return;
    if (msg.t === 'ping') send(ws, { t: 'pong', id: msg.id });
    else if (msg.t === 'intent' && world) applyIntent(world, heroId, msg.intent);
  });
  ws.on('close', () => {
    sockets.delete(ws);
    if (world) delete world.heroes[heroId];
    if (sockets.size === 0) world = null;
  });
});

setInterval(() => {
  if (!world) return;
  step(world, SERVER_TICK);
  for (const [ws, id] of sockets) {
    if (world.heroes[id]) send(ws, { t: 'view', view: buildView(world, id) });
  }
}, SERVER_TICK * 1000);

http.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
