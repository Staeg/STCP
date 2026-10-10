import { Stash } from './stash';
import { isHealthy, loadoutOf, type Character } from './village';
import { Rng } from './rng';
import { CLASS_IDS, type ClassId } from './content/classes';
import { titleFor } from './content/titles';
import { SERVER_TICK, escalationAt } from './content/constants';
import { Game, type PlayerSlot } from './sim/game';
import { buildView } from './sim/views';
import { addToPile } from './sim/loot';
import { onHeroInRoom, spawnGroup } from './sim/combat';
import { MAX_PLAYERS, type ClientMsg, type LobbyState, type LobbyView, type ServerMsg } from './protocol';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, to avoid confusion when read aloud
const BOT_NAMES = ['Aldric', 'Brynn', 'Corvin', 'Dagny', 'Edda', 'Fenn', 'Gisla', 'Hob', 'Ilse', 'Jory'];

/** A player's Character in a run: what to write back to their Village when it ends. */
interface RosterEntry {
  heroId: string;
  owner: string;
  charId: string;
}
/** Lobbies with nobody connected are removed after this long. */
const ABANDON_MS = 10 * 60 * 1000;

/** The bits of a WebSocket the lobby uses, so it runs against `ws` on the server and an in-page fake for solo play. */
export interface Socket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface LobbyOptions {
  /** Allow the debug* client messages. */
  debug?: boolean;
  /** Fixed seed for every game (reproducing a run). */
  seed?: number;
  log?: (msg: string) => void;
}

interface Member {
  token: string;
  /** Public id (also the hero id). Never reveal tokens to other clients. */
  id: string;
  name: string;
  cls: ClassId | null;
  ready: boolean;
  ws: Socket | null;
}

export class Lobby {
  members: Member[] = [];
  state: LobbyState = 'lobby';
  game: Game | null = null;
  hostToken: string;
  emptySince: number | null = null;
  /** Gold from the finished run has been added to stashes. */
  private banked = false;
  /** Dev-only fast-forward multiplier. */
  speed = 1;
  /** Players' Characters in the current run (bots' borrowed ones aren't here: they leave no mark). */
  private roster: RosterEntry[] = [];

  constructor(readonly code: string, host: Member, private stash: Stash, private opts: LobbyOptions) {
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
      members: this.members.map((m) => {
        const c = m.cls ? this.stash.characterFor(m.name, m.cls) : null;
        return {
          id: m.id, name: m.name, cls: m.cls, ready: m.ready, connected: !!m.ws, stash: this.stash.get(m.name), title: titleFor(this.stash.get(m.name)),
          character: c && { name: c.name, talent: c.talent, xp: c.xp, injuries: c.injuries, affliction: c.affliction },
        };
      }),
      cr: this.members.filter((m) => m.cls && this.stash.characterFor(m.name, m.cls).talent).length,
    };
  }

  broadcast() {
    for (const m of this.members) if (m.ws) send(m.ws, { t: 'lobby', lobby: this.view(m.token) });
  }

  start(rng: Rng): string | null {
    if (this.members.some((m) => !m.cls || !m.ready)) return 'Everyone must pick a class and ready up.';
    // Each player brings their Village's Character of the class they picked.
    const slots: PlayerSlot[] = this.members.map((m) => {
      const c = this.stash.characterFor(m.name, m.cls!);
      return { id: m.id, name: `${c.name} (${m.name})`, cls: m.cls!, isBot: false, loadout: loadoutOf(m.name, c) };
    });
    this.roster = slots.map((s) => ({ heroId: s.id, owner: s.loadout!.owner, charId: s.loadout!.charId }));
    slots.push(...this.botSlots(rng, slots));
    const seed = this.opts.seed ?? rng.int(1, 2 ** 30);
    this.opts.log?.(`[${this.code}] starting game, seed ${seed}`);
    this.game = new Game(seed, slots);
    this.state = 'game';
    this.banked = false;
    return null;
  }

  /**
   * Bots borrow Characters from the players' Villages: a random healthy one nobody brought, preferring classes
   * nobody picked, or any one at all if none is healthy. They use its Talent and suffer its injuries, but what
   * happens to them in the run never goes back to the Village.
   */
  private botSlots(rng: Rng, slots: PlayerSlot[]): PlayerSlot[] {
    const owners = [...new Map(this.members.map((m) => [m.name.toLowerCase(), m.name])).values()];
    const inUse = new Set(slots.map((s) => `${s.loadout!.owner.toLowerCase()}:${s.loadout!.charId}`));
    let pool: { owner: string; c: Character }[] = owners
      .flatMap((owner) => this.stash.characters(owner).map((c) => ({ owner, c })))
      .filter((x) => !inUse.has(`${x.owner.toLowerCase()}:${x.c.id}`));
    const taken = new Set(slots.map((s) => s.cls));
    const out: PlayerSlot[] = [];
    const botNames = rng.shuffle(BOT_NAMES);
    for (let i = 0; slots.length + out.length < MAX_PLAYERS; i++) {
      const healthy = pool.filter((x) => isHealthy(x.c));
      const fresh = healthy.filter((x) => !taken.has(x.c.cls));
      const from = fresh.length ? fresh : healthy.length ? healthy : pool;
      if (from.length === 0) {
        // No Villages to borrow from (shouldn't happen): a plain bot of a class nobody has.
        const cls = rng.pick(CLASS_IDS.filter((c) => !taken.has(c)));
        taken.add(cls);
        out.push({ id: `bot${i}`, name: botNames[i], cls, isBot: true });
        continue;
      }
      const pick = rng.pick(from);
      pool = pool.filter((x) => x !== pick);
      taken.add(pick.c.cls);
      out.push({ id: `bot${i}`, name: pick.c.name, cls: pick.c.cls, isBot: true, loadout: loadoutOf(pick.owner, pick.c) });
    }
    return out;
  }

  tick() {
    if (!this.game) return;
    for (let i = 0; i < this.speed; i++) this.game.tick(SERVER_TICK);
    if (this.game.world.phase !== 'running' && !this.banked) {
      this.banked = true;
      // Fast-forwarded (debug) games don't count toward anyone's career.
      if (this.speed === 1) {
        for (const m of this.members) {
          const h = this.game.world.heroes[m.id];
          if (h) this.stash.recordRun(m.name, h.extracted, h.gold, h.legacy);
        }
        // Players' Characters carry the run home (even if their player left mid-run and a bot finished it).
        for (const r of this.roster) {
          const h = this.game.world.heroes[r.heroId];
          if (!h) continue;
          this.stash.recordCharacter(r.owner, r.charId, { escaped: h.extracted, lowestHp: h.lowestHp, downedMajor: h.downedMajor, affliction: h.affliction });
        }
        for (const m of this.members) if (m.ws) send(m.ws, { t: 'village', village: this.stash.village(m.name) });
      }
      this.opts.log?.(`[${this.code}] run over (${this.game.world.phase})`);
      this.broadcast();
      const board: ServerMsg = { t: 'leaderboard', entries: this.stash.leaderboard() };
      for (const m of this.members) if (m.ws) send(m.ws, board);
    }
    for (const m of this.members) {
      if (m.ws && this.game.world.heroes[m.id]) send(m.ws, { t: 'view', view: buildView(this.game.world, m.id) });
    }
  }
}

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();
  private rng = new Rng(Date.now() & 0x7fffffff);

  constructor(private stash: Stash, private opts: LobbyOptions = {}) {}

  private find(token: string): { lobby: Lobby; member: Member } | null {
    for (const lobby of this.lobbies.values()) {
      const member = lobby.members.find((m) => m.token === token);
      if (member) return { lobby, member };
    }
    return null;
  }

  /** Handle one message from a client that has said hello (token known). */
  handle(ws: Socket, token: string, name: string, msg: ClientMsg) {
    const found = this.find(token);
    // Unnamed players share the 'Nameless' Village, like their lobby name.
    name ||= 'Nameless';
    const err = (text: string) => send(ws, { t: 'error', msg: text });

    switch (msg.t) {
      case 'village':
        send(ws, { t: 'village', village: this.stash.village(name) });
        return;
      case 'chooseTalent':
      case 'treat': {
        const problem = msg.t === 'treat' ? this.stash.treat(name, msg.charId, msg.what) : this.stash.chooseTalent(name, msg.charId, msg.talent);
        if (problem) err(problem);
        send(ws, { t: 'village', village: this.stash.village(name) });
        // Lobby cards show your Character, and the CR counts Talents.
        if (found?.lobby.state === 'lobby') found.lobby.broadcast();
        return;
      }
      case 'hello': {
        send(ws, { t: 'leaderboard', entries: this.stash.leaderboard() });
        send(ws, { t: 'village', village: this.stash.village(name) });
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
        const lobby = new Lobby(this.newCode(), this.newMember(token, name, ws), this.stash, this.opts);
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

    // Renaming on the menu is fine: the connection remembers the name for create/join.
    if (msg.t === 'setName' && msg.name) send(ws, { t: 'village', village: this.stash.village(msg.name) });
    if (!found) return msg.t === 'setName' ? undefined : err('You are not in a lobby.');
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
        if (!this.opts.debug) return err('Debug commands are disabled.');
        const w = lobby.game?.world;
        const h = w?.heroes[member.id];
        if (!w || !h || h.pos.kind !== 'room') return;
        h.hp = h.maxHp;
        h.downedAt = null;
        h.dead = false;
        spawnGroup(w, h.pos.room, msg.enemies, escalationAt(w.time));
        onHeroInRoom(w, h, h.pos.room);
        return;
      }
      case 'debugSpeed':
        if (!this.opts.debug) return err('Debug commands are disabled.');
        lobby.speed = msg.speed;
        return;
      case 'debugEvent': {
        if (!this.opts.debug) return err('Debug commands are disabled.');
        const w = lobby.game?.world;
        const h = w?.heroes[member.id];
        if (!w || h?.pos.kind !== 'room') return;
        const room = h.pos.room;
        if (msg.kind === 'villager') {
          const id = `v${w.nextId++}`;
          w.villagers[id] = { id, room, leader: null, hp: 10, maxHp: 10, state: 'captive' };
        } else {
          w.events[room] = { room, kind: msg.kind, done: false, progress: 0, by: null, spawned: false };
        }
        return;
      }
      case 'debugLoot': {
        if (!this.opts.debug) return err('Debug commands are disabled.');
        const h = lobby.game?.world.heroes[member.id];
        if (lobby.game && h?.pos.kind === 'room') addToPile(lobby.game.world, h.pos.room, msg.gold, msg.items);
        return;
      }
      case 'debugSkip':
        if (!this.opts.debug) return err('Debug commands are disabled.');
        if (lobby.game) for (let t = 0; t < msg.seconds; t += SERVER_TICK) lobby.game.tick(SERVER_TICK);
        return;
      default:
        return;
    }
    lobby.broadcast();
  }

  disconnected(ws: Socket, token: string) {
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
        this.opts.log?.(`[${code}] abandoned, removing`);
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

  private newMember(token: string, name: string, ws: Socket): Member {
    return { token, id: `p${this.rng.int(100000, 999999)}`, name: name || 'Nameless', cls: null, ready: false, ws };
  }

  private newCode(): string {
    for (;;) {
      const code = Array.from({ length: 4 }, () => this.rng.pick([...CODE_CHARS])).join('');
      if (!this.lobbies.has(code)) return code;
    }
  }
}

export function send(ws: Socket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
