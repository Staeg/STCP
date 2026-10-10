import { Stash } from './stash';
import { heroCr, isHealthy, loadoutOf, type Character } from './village';
import { Rng } from './rng';
import { CLASS_IDS, type ClassId } from './content/classes';
import { titleFor } from './content/titles';
import { SERVER_TICK, escalationAt } from './content/constants';
import { combinedCr, Game, type PlayerSlot } from './sim/game';
import { buildView } from './sim/views';
import { addToPile } from './sim/loot';
import { carriedHome, emergencyDone } from './sim/emergency';
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
/** A bot in the lobby: the Character it borrows (`charId` null: a plain bot, when there's no Village to borrow from). */
interface LobbyBot {
  owner: string;
  charId: string | null;
  cls: ClassId;
  name: string;
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
  /** The bots filling the empty slots, chosen once every player has picked a class and kept until they must change. */
  bots: LobbyBot[] = [];

  constructor(readonly code: string, host: Member, private stash: Stash, private opts: LobbyOptions, private rng: Rng) {
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
          kit: this.stash.kitOf(m.name),
          emergency: this.stash.emergencyOf(m.name),
        };
      }),
      bots: this.bots.map((b) => {
        const c = this.botCharacter(b);
        return { name: b.name, cls: b.cls, owner: b.owner, character: c && { name: c.name, talent: c.talent, xp: c.xp, injuries: c.injuries, affliction: c.affliction } };
      }),
      cr: Math.round((this.members.reduce((s, m) => s + heroCr(m.cls ? this.stash.characterFor(m.name, m.cls).talent : null, this.stash.kitOf(m.name)), 0)
        + this.bots.reduce((s, b) => s + heroCr(this.botCharacter(b)?.talent, undefined), 0)) * 100) / 100,
      relic: this.members.some((m) => this.stash.kitOf(m.name).rites.includes('relic')),
    };
  }

  broadcast() {
    if (this.state === 'lobby') this.syncBots();
    for (const m of this.members) if (m.ws) send(m.ws, { t: 'lobby', lobby: this.view(m.token) });
  }

  start(rng: Rng): string | null {
    if (this.members.some((m) => !m.cls || !m.ready)) return 'Everyone must pick a class and ready up.';
    const unpicked = this.members.find((m) => !this.stash.emergencyOf(m.name));
    if (unpicked) return `${unpicked.name} must pick their Village's Emergency first.`;
    // Each player brings their Village's Character of the class they picked.
    const slots: PlayerSlot[] = this.members.map((m) => {
      const c = this.stash.characterFor(m.name, m.cls!);
      // What they chose in the Village leaves the Stash now (Rites spend their Resources).
      const loadout = { ...loadoutOf(m.name, c), kit: this.stash.takeKit(m.name), emergency: this.stash.emergencyOf(m.name) };
      return { id: m.id, name: `${c.name} (${m.name})`, cls: m.cls!, isBot: false, loadout };
    });
    this.roster = slots.map((s) => ({ heroId: s.id, owner: s.loadout!.owner, charId: s.loadout!.charId }));
    this.syncBots();
    slots.push(...this.bots.map((b, i): PlayerSlot => {
      const c = this.botCharacter(b);
      return { id: `bot${i}`, name: b.name, cls: b.cls, isBot: true, loadout: c ? loadoutOf(b.owner, c) : undefined };
    }));
    const seed = this.opts.seed ?? rng.int(1, 2 ** 30);
    this.game = new Game(seed, slots);
    this.opts.log?.(`[${this.code}] starting game, seed ${seed}, CR ${combinedCr(slots)} → ${this.game.world.cr}`);
    this.state = 'game';
    this.banked = false;
    // The kits have left the Stash.
    for (const m of this.members) if (m.ws) send(m.ws, { t: 'village', village: this.stash.village(m.name) });
    return null;
  }

  private botCharacter(b: LobbyBot): Character | null {
    return b.charId ? this.stash.characters(b.owner).find((c) => c.id === b.charId) ?? null : null;
  }

  /** `owner:charId` of every Character a player is bringing. */
  private playersChars(except?: Member): Set<string> {
    return new Set(this.members.filter((m) => m.cls && m !== except).map((m) => `${m.name.toLowerCase()}:${this.stash.characterFor(m.name, m.cls!).id}`));
  }

  /**
   * A player switched from `from` to `to`. A bot of the class they took swaps with them: it borrows the Character
   * they put down if that one is healthy, and otherwise makes way for a fresh pick.
   */
  classChanged(member: Member, from: ClassId | null, to: ClassId | null) {
    const i = to ? this.bots.findIndex((b) => b.cls === to) : -1;
    if (i < 0) return;
    const c = from ? this.stash.characterFor(member.name, from) : null;
    if (c && isHealthy(c) && !this.playersChars(member).has(`${member.name.toLowerCase()}:${c.id}`)) {
      this.bots[i] = { owner: member.name, charId: c.id, cls: c.cls, name: c.name };
    } else {
      this.bots.splice(i, 1);
    }
  }

  /**
   * Bots fill the empty slots once every player has picked a class, and stay put until they must change: a bot
   * leaves if its Character's owner left, a player now brings it, or the lobby filled up. New bots borrow
   * Characters from the players' Villages: a random healthy one nobody brought, preferring classes nobody has, or
   * any one at all if none is healthy. They use its Talent and suffer its injuries, but what happens to them in the
   * run never goes back to the Village.
   */
  syncBots() {
    if (this.bots.length === 0 && this.members.some((m) => !m.cls)) return;
    const owners = [...new Map(this.members.map((m) => [m.name.toLowerCase(), m.name])).values()];
    const inUse = this.playersChars();
    this.bots = this.bots
      .filter((b) => b.charId === null || (owners.some((o) => o.toLowerCase() === b.owner.toLowerCase())
        && !inUse.has(`${b.owner.toLowerCase()}:${b.charId}`) && this.botCharacter(b)))
      .slice(0, Math.max(0, MAX_PLAYERS - this.members.length));
    for (const b of this.bots) if (b.charId) inUse.add(`${b.owner.toLowerCase()}:${b.charId}`);
    let pool: { owner: string; c: Character }[] = owners
      .flatMap((owner) => this.stash.characters(owner).map((c) => ({ owner, c })))
      .filter((x) => !inUse.has(`${x.owner.toLowerCase()}:${x.c.id}`));
    const taken = new Set<ClassId>([...this.members.flatMap((m) => (m.cls ? [m.cls] : [])), ...this.bots.map((b) => b.cls)]);
    while (this.members.length + this.bots.length < MAX_PLAYERS) {
      const healthy = pool.filter((x) => isHealthy(x.c));
      const fresh = healthy.filter((x) => !taken.has(x.c.cls));
      const from = fresh.length ? fresh : healthy.length ? healthy : pool;
      if (from.length === 0) {
        // No Villages to borrow from (shouldn't happen): a plain bot of a class nobody has.
        const cls = this.rng.pick(CLASS_IDS.filter((c) => !taken.has(c)));
        const used = new Set(this.bots.map((b) => b.name));
        taken.add(cls);
        this.bots.push({ owner: '', charId: null, cls, name: this.rng.pick(BOT_NAMES.filter((n) => !used.has(n))) });
        continue;
      }
      const pick = this.rng.pick(from);
      pool = pool.filter((x) => x !== pick);
      taken.add(pick.c.cls);
      this.bots.push({ owner: pick.owner, charId: pick.c.id, cls: pick.c.cls, name: pick.c.name });
    }
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
          // Everything carried out (pack and Gear) goes into the player's Village Stash, with whatever an Undertaker
          // or the Tome Rite brought home for a hero who fell.
          const line = this.stash.storeLoot(r.owner, carriedHome(h));
          if (line) this.stash.addReport(r.owner, line);
          // The Emergency: +1 Wellbeing if done, −1 if not.
          if (h.emergency) this.stash.settleEmergency(r.owner, h.emergency, emergencyDone(this.game.world, h));
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
      case 'treat':
      case 'setKit':
      case 'chooseEmergency':
      case 'chooseFate': {
        const busy = found?.lobby.state === 'game' ? 'Not while your expedition is underway.' : null;
        const problem = msg.t === 'treat' ? this.stash.treat(name, msg.charId, msg.what)
          : msg.t === 'chooseEmergency' ? (busy ?? this.stash.chooseEmergency(name, msg.id))
          : msg.t === 'chooseFate' ? (busy ?? this.stash.chooseFate(name, msg.choice))
          : msg.t === 'setKit' ? (found?.lobby.state === 'game' ? 'Not while your expedition is underway.' : this.stash.setKit(name, msg.kit))
          : this.stash.chooseTalent(name, msg.charId, msg.talent);
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
        const lobby = new Lobby(this.newCode(), this.newMember(token, name, ws), this.stash, this.opts, this.rng);
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
        lobby.classChanged(member, member.cls, msg.cls);
        member.cls = msg.cls;
        if (!msg.cls) member.ready = false;
        break;
      case 'ready':
        if (lobby.state !== 'lobby') return;
        if (msg.ready && !member.cls) return err('Pick a class first.');
        if (msg.ready && !this.stash.emergencyOf(member.name)) return err('Pick your Village’s Emergency first (in the Village).');
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
        // A new run, new bots.
        lobby.bots = [];
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
