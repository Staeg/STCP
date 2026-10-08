import type { WebSocket } from 'ws';
import {
  buildView, CLASS_IDS, Game, MAX_PLAYERS, onHeroInRoom, Rng, SERVER_TICK, spawnGroup, tierAt,
  type ClassId, type ClientMsg, type LobbyState, type LobbyView, type PlayerSlot, type ServerMsg,
} from '@stcp/shared';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, to avoid confusion when read aloud
const BOT_NAMES = ['Aldric', 'Brynn', 'Corvin', 'Dagny', 'Edda', 'Fenn', 'Gisla', 'Hob', 'Ilse', 'Jory'];
const DEBUG = process.argv.includes('--debug');
/** Lobbies with nobody connected are removed after this long. */
const ABANDON_MS = 10 * 60 * 1000;

interface Member {
  token: string;
  /** Public id (also the hero id). Never reveal tokens to other clients. */
  id: string;
  name: string;
  cls: ClassId | null;
  ready: boolean;
  ws: WebSocket | null;
}

export class Lobby {
  members: Member[] = [];
  state: LobbyState = 'lobby';
  game: Game | null = null;
  hostToken: string;
  emptySince: number | null = null;

  constructor(readonly code: string, host: Member) {
    this.hostToken = host.token;
    this.members.push(host);
  }

  view(forToken: string): LobbyView {
    const you = this.members.find((m) => m.token === forToken)!;
    return {
      code: this.code,
      youId: you.id,
      hostId: this.members.find((m) => m.token === this.hostToken)?.id ?? '',
      state: this.state,
      maxPlayers: MAX_PLAYERS,
      members: this.members.map((m) => ({ id: m.id, name: m.name, cls: m.cls, ready: m.ready, connected: !!m.ws })),
    };
  }

  broadcast() {
    for (const m of this.members) if (m.ws) send(m.ws, { t: 'lobby', lobby: this.view(m.token) });
  }

  start(rng: Rng): string | null {
    if (this.members.some((m) => !m.cls || !m.ready)) return 'Everyone must pick a class and ready up.';
    const taken = new Set(this.members.map((m) => m.cls));
    const freeClasses = rng.shuffle(CLASS_IDS.filter((c) => !taken.has(c)));
    const botNames = rng.shuffle(BOT_NAMES);
    const slots: PlayerSlot[] = this.members.map((m) => ({ id: m.id, name: m.name, cls: m.cls!, isBot: false }));
    for (let i = 0; slots.length < MAX_PLAYERS; i++) {
      slots.push({ id: `bot${i}`, name: botNames[i], cls: freeClasses[i], isBot: true });
    }
    const seed = Number(process.env.SEED ?? rng.int(1, 2 ** 30));
    console.log(`[${this.code}] starting game, seed ${seed}`);
    this.game = new Game(seed, slots);
    this.state = 'game';
    return null;
  }

  tick() {
    if (!this.game) return;
    this.game.tick(SERVER_TICK);
    for (const m of this.members) {
      if (m.ws && this.game.world.heroes[m.id]) send(m.ws, { t: 'view', view: buildView(this.game.world, m.id) });
    }
  }
}

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();
  private rng = new Rng(Date.now() & 0x7fffffff);

  private find(token: string): { lobby: Lobby; member: Member } | null {
    for (const lobby of this.lobbies.values()) {
      const member = lobby.members.find((m) => m.token === token);
      if (member) return { lobby, member };
    }
    return null;
  }

  /** Handle one message from a client that has said hello (token known). */
  handle(ws: WebSocket, token: string, name: string, msg: ClientMsg) {
    const found = this.find(token);
    const err = (text: string) => send(ws, { t: 'error', msg: text });

    switch (msg.t) {
      case 'hello': {
        if (found) {
          if (found.member.ws && found.member.ws !== ws) found.member.ws.close(4000, 'Connected elsewhere');
          found.member.ws = ws;
          found.lobby.emptySince = null;
          found.lobby.broadcast();
        } else {
          send(ws, { t: 'lobby', lobby: null });
        }
        return;
      }
      case 'create': {
        if (found) this.leave(found.lobby, found.member);
        const lobby = new Lobby(this.newCode(), this.newMember(token, name, ws));
        this.lobbies.set(lobby.code, lobby);
        lobby.broadcast();
        return;
      }
      case 'join': {
        if (found?.lobby.code === msg.code) return found.lobby.broadcast();
        const lobby = this.lobbies.get(msg.code);
        if (!lobby) return err(`No lobby with code ${msg.code}.`);
        if (lobby.state !== 'lobby') return err('That expedition has already set out.');
        if (lobby.members.length >= MAX_PLAYERS) return err('That lobby is full.');
        if (found) this.leave(found.lobby, found.member);
        lobby.members.push(this.newMember(token, name, ws));
        lobby.broadcast();
        return;
      }
    }

    if (!found) return err('You are not in a lobby.');
    const { lobby, member } = found;
    const isHost = lobby.hostToken === token;

    switch (msg.t) {
      case 'leave':
        this.leave(lobby, member);
        send(ws, { t: 'lobby', lobby: null });
        return;
      case 'setName':
        if (lobby.state === 'lobby' && msg.name) member.name = msg.name;
        break;
      case 'pickClass':
        if (lobby.state !== 'lobby') return;
        if (msg.cls && lobby.members.some((m) => m !== member && m.cls === msg.cls)) return err('Someone already picked that class.');
        member.cls = msg.cls;
        if (!msg.cls) member.ready = false;
        break;
      case 'ready':
        if (lobby.state !== 'lobby') return;
        if (msg.ready && !member.cls) return err('Pick a class first.');
        member.ready = msg.ready;
        break;
      case 'start': {
        if (!isHost) return err('Only the host can start.');
        if (lobby.state !== 'lobby') return;
        const problem = lobby.start(this.rng);
        if (problem) return err(problem);
        break;
      }
      case 'toLobby':
        if (!isHost || !lobby.game || lobby.game.world.phase === 'running') return;
        lobby.state = 'lobby';
        lobby.game = null;
        for (const m of lobby.members) m.ready = false;
        break;
      case 'intent':
        lobby.game?.intent(member.id, msg.intent);
        return;
      case 'debugSpawn': {
        if (!DEBUG) return err('Debug commands are disabled.');
        const w = lobby.game?.world;
        const h = w?.heroes[member.id];
        if (!w || !h || h.pos.kind !== 'room') return;
        h.hp = h.maxHp;
        h.downedAt = null;
        h.dead = false;
        spawnGroup(w, h.pos.room, msg.enemies, tierAt(w.time));
        onHeroInRoom(w, h, h.pos.room);
        return;
      }
      case 'debugSkip':
        if (!DEBUG) return err('Debug commands are disabled.');
        if (lobby.game) for (let t = 0; t < msg.seconds; t += SERVER_TICK) lobby.game.tick(SERVER_TICK);
        return;
      default:
        return;
    }
    lobby.broadcast();
  }

  disconnected(ws: WebSocket, token: string) {
    const found = this.find(token);
    if (!found || found.member.ws !== ws) return;
    found.member.ws = null;
    if (found.lobby.members.every((m) => !m.ws)) found.lobby.emptySince = Date.now();
    found.lobby.broadcast();
  }

  tick() {
    const now = Date.now();
    for (const [code, lobby] of this.lobbies) {
      if (lobby.emptySince !== null && now - lobby.emptySince > ABANDON_MS) {
        console.log(`[${code}] abandoned, removing`);
        this.lobbies.delete(code);
        continue;
      }
      lobby.tick();
    }
  }

  private leave(lobby: Lobby, member: Member) {
    lobby.members = lobby.members.filter((m) => m !== member);
    lobby.game?.makeBot(member.id);
    if (lobby.members.length === 0) {
      this.lobbies.delete(lobby.code);
      return;
    }
    if (lobby.hostToken === member.token) lobby.hostToken = lobby.members[0].token;
    lobby.broadcast();
  }

  private newMember(token: string, name: string, ws: WebSocket): Member {
    return { token, id: `p${this.rng.int(100000, 999999)}`, name: name || 'Nameless', cls: null, ready: false, ws };
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 4 }, () => this.rng.pick([...CODE_CHARS])).join('');
      if (!this.lobbies.has(code)) return code;
    }
  }
}

export function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
