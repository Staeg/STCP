/**
 * Multi-client playtest harness (M10): N real WebSocket clients play a full game against a running
 * dev server, driven by the bot brains, while every snapshot they receive is checked for fog leaks.
 *
 *   npm run dev                                   (in another terminal)
 *   npx tsx tools/playtest-harness.ts --players 4 [--speed 10] [--port 3001]
 *
 * --speed needs the server's --debug mode; it fast-forwards the lobby so a run takes ~1–2 minutes.
 * Exit code 1 if any invariant is violated.
 */
import WebSocket from 'ws';
import {
  botThink, chooseCombatAction, CLASS_IDS, createBotMemory, Rng,
  type BotMemory, type ClientMsg, type LobbyView, type PlayerView, type ServerMsg,
} from '@stcp/shared';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const PLAYERS = Number(args.get('players') ?? 4);
const PORT = Number(args.get('port') ?? 3001);
const SPEED = Number(args.get('speed') ?? 1);
const URL = `ws://localhost:${PORT}/ws`;

const violations: string[] = [];
const timeline: string[] = [];
let viewsChecked = 0;
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

class Client {
  ws!: WebSocket;
  lobby: LobbyView | null = null;
  view: PlayerView | null = null;
  mem: BotMemory;
  rng: Rng;
  combatKey = '';
  decideAt = 0;
  done = false;
  reconnects = 0;
  /** Stuck detector: where we last saw movement or action, and when. */
  stillSince = 0;
  stillKey = '';
  stuckReported = false;
  readonly token: string;

  constructor(readonly name: string, readonly index: number, readonly allTokens: string[]) {
    this.token = `harness${index}x${Math.floor(Math.random() * 1e9)}`;
    allTokens.push(this.token);
    this.mem = createBotMemory(1000 + index);
    this.rng = new Rng(2000 + index);
  }

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => {
        this.send({ t: 'hello', token: this.token, name: this.name });
        resolve();
      });
      this.ws.on('message', (raw) => this.onMessage(raw.toString()));
    });
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(raw: string) {
    // Invariant: no other player's secret token ever reaches this client.
    for (const t of this.allTokens) if (t !== this.token && raw.includes(t)) violations.push(`${this.name} received another player's token`);
    const msg = JSON.parse(raw) as ServerMsg;
    if (msg.t === 'lobby') this.lobby = msg.lobby;
    if (msg.t === 'error') timeline.push(`${this.name}: server error "${msg.msg}"`);
    if (msg.t === 'view') {
      this.view = msg.view;
      checkFog(this.name, msg.view);
      this.act(msg.view);
    }
  }

  /** Same decisions the server-side bots make, but sent over the network as a "human". */
  act(v: PlayerView) {
    // Flag heroes that sit idle in one place for a long time (outside fights, channels and the exit).
    const key = JSON.stringify(v.you.pos) + (v.encounter ? 'E' : '') + (v.you.channel ? 'C' : '');
    if (key !== this.stillKey) {
      this.stillKey = key;
      this.stillSince = v.time;
    } else if (!this.stuckReported && v.time - this.stillSince > 45 && !v.encounter && !v.you.channel && !v.you.dead && !v.you.extracted
      && v.you.downedAt === null && !(v.you.pos.kind === 'room' && v.you.pos.room === v.exitRoom) && v.phase === 'running') {
      this.stuckReported = true;
      const room = v.you.pos.kind === 'room' ? v.rooms.find((r) => r.id === (v.you.pos as { room: number }).room)?.name : 'a corridor';
      timeline.push(`${fmt(v.time)} ${this.name}: idle for 45s in ${room} (vote: ${!!v.loot?.vote}, event: ${v.event?.kind ?? '-'}, route: ${this.mem.route.length})`);
    }
    if (v.phase !== 'running' || v.you.dead || v.you.extracted) {
      if (!this.done) {
        this.done = true;
        timeline.push(`${fmt(v.time)} ${this.name}: ${v.you.extracted ? `escaped with ${v.you.gold} gold` : v.you.dead ? 'died' : `run over (${v.phase})`}`);
      }
      return;
    }
    if (v.encounter) {
      const enc = v.encounter;
      const key = `${enc.room}:${enc.round}`;
      if (key !== this.combatKey) {
        this.combatKey = key;
        this.decideAt = v.time + this.rng.float(0.5, 2.5);
      }
      if (enc.phase === 'choosing' && !enc.yourChoice && v.time >= this.decideAt) {
        const choice = chooseCombatAction(v, this.rng);
        if (choice) this.send({ t: 'intent', intent: { type: 'combat', choice } });
      }
      return;
    }
    const intent = botThink(v, this.mem);
    if (intent) this.send({ t: 'intent', intent });
  }
}

/** Everything a client is shown must be derivable from what that hero has seen. */
function checkFog(who: string, v: PlayerView) {
  viewsChecked++;
  const you = v.you;
  const fail = (s: string) => {
    if (violations.length < 200) violations.push(`${fmt(v.time)} ${who}: ${s}`);
  };
  const explored = new Set(you.explored);
  const seen = new Set(you.seen);
  for (const r of v.rooms) {
    if (r.knowledge === 'explored' && !explored.has(r.id)) fail(`room ${r.id} marked explored but never visited`);
    if (r.knowledge === 'seen' && !seen.has(r.id)) fail(`room ${r.id} marked seen but never glimpsed`);
    if (r.knowledge === 'unknown' && (r.name || r.kind)) fail(`unknown room ${r.id} leaks its name/kind`);
  }
  for (const c of v.corridors) {
    if (!explored.has(c.a) && !explored.has(c.b)) fail(`corridor ${c.id} known without exploring either end`);
  }
  if (v.encounter && you.encounter === null) fail('received an encounter it is not part of');
  if (!v.encounter && you.encounter !== null && v.phase === 'running') {
    // allowed only transiently (encounter ended this tick)
  }
  // Live allies must actually be in sight.
  const adjacent = (a: number, b: number) => v.corridors.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  for (const a of v.allies) {
    if (!a.live) {
      if (a.seenAt > v.time + 1e-6) fail(`ghost ${a.name} seen in the future`);
      continue;
    }
    const p = you.pos;
    const q = a.pos;
    let ok = false;
    if (p.kind === 'room' && q.kind === 'room') ok = p.room === q.room || (!v.dim && adjacent(p.room, q.room)) || (you.items.includes('catseye') && adjacent(p.room, q.room));
    else if (p.kind === 'corridor' && q.kind === 'corridor') ok = p.corridor === q.corridor;
    else if (p.kind === 'room' && q.kind === 'corridor') ok = q.from === p.room || q.to === p.room;
    else if (p.kind === 'corridor' && q.kind === 'room') ok = q.room === p.from || q.room === p.to;
    if (!ok && !a.dead) fail(`live ally ${a.name} visible from out of sight (${JSON.stringify(p)} vs ${JSON.stringify(q)})`);
  }
  // Nothing about other heroes' private knowledge should be present.
  const raw = v as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (['heroes', 'monsters', 'packs', 'piles', 'chalkAll'].includes(key)) fail(`view exposes global field "${key}"`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tokens: string[] = [];
  const clients = Array.from({ length: PLAYERS }, (_, i) => new Client(`P${i + 1}`, i, tokens));
  for (const c of clients) await c.connect();
  await sleep(300);
  clients[0].send({ t: 'create' });
  await sleep(400);
  const code = clients[0].lobby?.code;
  if (!code) throw new Error('lobby not created');
  for (const c of clients.slice(1)) c.send({ t: 'join', code });
  await sleep(400);
  clients.forEach((c, i) => c.send({ t: 'pickClass', cls: CLASS_IDS[i % CLASS_IDS.length] }));
  await sleep(300);
  for (const c of clients) c.send({ t: 'ready', ready: true });
  await sleep(300);
  clients[0].send({ t: 'start' });
  await sleep(500);
  if (SPEED > 1) clients[0].send({ t: 'debugSpeed', speed: SPEED } as unknown as ClientMsg);
  timeline.push(`lobby ${code} started with ${PLAYERS} networked players${SPEED > 1 ? ` at ×${SPEED}` : ''}`);

  // Scripted chaos: reconnects (one plain, one mid-fight).
  let plainDone = false;
  let fightDone = false;
  const t0 = Date.now();
  while (clients.some((c) => !c.done) && Date.now() - t0 < 20 * 60 * 1000) {
    await sleep(200);
    const c1 = clients[1 % PLAYERS];
    if (!plainDone && (c1.view?.time ?? 0) > 120) {
      plainDone = true;
      const id = c1.lobby?.youId;
      c1.ws.close();
      await sleep(1500);
      await c1.connect();
      await sleep(800);
      const ok = c1.lobby?.youId === id && c1.lobby?.state === 'game';
      timeline.push(`${fmt(c1.view?.time ?? 0)} ${c1.name}: disconnected and reconnected → ${ok ? 'resumed same hero' : 'FAILED to resume'}`);
      if (!ok) violations.push(`${c1.name} failed to resume after reconnect`);
    }
    const fighter = clients.find((c) => c.view?.encounter && !c.done);
    if (!fightDone && fighter && (fighter.view?.time ?? 0) > 60) {
      fightDone = true;
      const before = fighter.view!.encounter!.room;
      fighter.ws.close();
      await sleep(1000);
      await fighter.connect();
      await sleep(800);
      const after = fighter.view?.encounter?.room;
      const ok = after === before || fighter.view?.you.encounter === null;
      timeline.push(`${fmt(fighter.view?.time ?? 0)} ${fighter.name}: reconnected mid-fight → ${after === before ? 'back in the same fight' : 'fight already over'}`);
      if (!ok) violations.push(`${fighter.name} lost its fight state after reconnect`);
    }
  }
  const final = clients[0].view?.results;
  if (final) {
    timeline.push('--- results ---');
    for (const h of final.heroes) timeline.push(`${h.name} (${h.cls}${h.isBot ? ', bot' : ''}): ${h.fate}`);
  }
  for (const c of clients) c.ws.close();
  console.log(timeline.join('\n'));
  console.log(`\nviews checked: ${viewsChecked}`);
  console.log(violations.length ? `VIOLATIONS (${violations.length}):\n${violations.slice(0, 40).join('\n')}` : 'no fog/identity violations');
  process.exit(violations.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
