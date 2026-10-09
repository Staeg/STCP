import { CLASSES, type ClassId } from '../content/classes';
import { COLLAPSE_AT, EXIT_OPENS_AT, LIGHT_DIM, LIGHT_DRAIN, LIGHT_MAX, TIER_INTERVAL } from '../content/constants';
import { ESCALATION } from '../content/enemies';
import { FIELD_MEND } from '../content/abilities';
import { clearRubble, tickEscalation, type Pack } from './escalation';
import { chooseEvent, spawnEvents, tickEvents, tickStress, villagerHere, type RoomEvent, type Villager } from './events';
import { EVENT_SEEDING, type AfflictionId, type EventKind } from '../content/events';
import { corridorBetween, generateDungeon, isCrossroads, neighbours, otherEnd, theRoom, type Dungeon } from '../dungeon/gen';
import { Rng } from '../rng';
import {
  inDungeon, isConscious, monstersIn, onHeroInRoom, REVIVE_CHANNEL, reviveHero, spawnInitialMonsters, submitChoice, tickCombat, tickDowned,
  type Choice, type Encounter, type Monster, type Statuses,
} from './combat';
import type { GearSlot, ItemId } from '../content/items';
import { notify } from './notify';
import { speedOf, type SpeedMod } from './speed';
import {
  castVote, claimAbandoned, dropItem, unequip, lockedByVote, seesInDark, spawnInitialLoot, tickLoot, useItemInField, type Pile,
} from './loot';

export type HeroPos =
  | { kind: 'room'; room: number }
  /** `t` = seconds walked from `from` toward `to`; `dur` = seconds this crossing takes (the hero's Speed when they set out). */
  | { kind: 'corridor'; corridor: number; from: number; to: number; t: number; dur: number };

export interface Hero {
  id: string;
  name: string;
  cls: ClassId;
  color: string;
  pos: HeroPos;
  /** Rooms still to visit after the current target. */
  path: number[];
  /** The room this hero chose to walk to (allies who can see them see it at once). */
  heading: number | null;
  light: number;
  /** Rooms this hero has stood in. */
  explored: number[];
  /** Rooms this hero knows the name and kind of (explored + glimpsed neighbours + the exit). */
  seen: number[];
  isBot: boolean;
  /** Where this hero last saw each other hero, and when. */
  lastKnown: Record<string, Sighting>;
  /** Chalk marks this hero has read, per crossroads room: heroId → corridor id they left by. */
  knownChalk: Record<number, Record<string, number>>;
  /** Monster count per room, as of when this hero last saw it. */
  knownThreat: Record<number, number>;

  hp: number;
  maxHp: number;
  stress: number;
  st: Statuses;
  /** Ability id → own turns until usable. Reset after each fight. */
  cooldowns: Record<string, number>;
  /** Time this hero went down, or null if standing. */
  downedAt: number | null;
  dead: boolean;
  diedAt: number | null;
  /** Room id of the fight this hero is in. */
  encounter: number | null;
  /** The room this hero last left (fleeing goes back there). */
  prevRoom: number | null;
  /** An out-of-combat action in progress. */
  channel:
    | { kind: 'revive'; target: string; until: number }
    | { kind: 'dig'; corridor: number; until: number }
    /** Carrying out an event choice in `room`; progress lives on the event itself. */
    | { kind: 'event'; room: number; choice: string; until: number }
    | null;
  /** Broken by stress (see content/events.ts). */
  affliction: AfflictionId | null;
  /** Id of the villager following this hero. */
  leading: string | null;
  /** Events this hero has seen, by room (for map icons). */
  knownEvents: Record<number, EventKind>;
  /** Lampbearer: game time when the out-of-combat Mend is ready again. */
  fieldMendAt: number;
  items: ItemId[];
  /** Temporary or run-long changes to Speed from events (see speed.ts). */
  speedMods: SpeedMod[];
  /** Equipped gear (separate from the pack). */
  weapon: ItemId | null;
  armor: ItemId | null;
  /** Carried gold. Only extracted gold counts. */
  gold: number;
  /** Short notices for this player ("+12 gold"), newest last. */
  messages: { time: number; text: string }[];
  /** Loot count per room as of when this hero last saw it. */
  knownLoot: Record<number, number>;
  /** Collapsed corridors this hero has found out about. */
  knownCollapsed: number[];
  /** Escaped through the exit. */
  extracted: boolean;
  extractedAt: number | null;
  /** How their run ended, for the results screen ("escaped with 84 gold", "bled out in the Crypt"). */
  fate: string | null;
  /** Most recent time this hero walked into the rendezvous (everyone starts there, so only returns count). */
  arrivedAt: number | null;
}

export interface Sighting {
  pos: HeroPos;
  /** Where they were headed, if they were on the move. */
  heading: number | null;
  time: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  dead: boolean;
  /** You watched them leave through the exit. */
  extracted?: boolean;
  affliction: AfflictionId | null;
}

/** collapsed: the 13:00 deadline hit · wiped: everyone died · ended: everyone left (or died) early */
export type WorldPhase = 'running' | 'collapsed' | 'wiped' | 'ended';

export interface World {
  seed: number;
  time: number;
  dungeon: Dungeon;
  heroes: Record<string, Hero>;
  phase: WorldPhase;
  /** Physical chalk marks at crossroads: room → heroId → corridor they last left by. */
  chalk: Record<number, Record<string, number>>;
  monsters: Record<string, Monster>;
  /** Active fights, keyed by room. */
  encounters: Record<number, Encounter>;
  rng: Rng;
  nextId: number;
  /** Loot lying in rooms. */
  piles: Record<number, Pile>;
  /** Points of monster slain per room since it was last cleared; paid out as items when the room is clear. */
  bounty: Record<number, number>;
  /** Current difficulty tier (see escalation.ts). */
  tier: number;
  packs: Record<string, Pack>;
  /** Collapsed corridor ids. */
  collapsed: number[];
  /** When each corridor was last dug out (it won't re-collapse for a while). */
  clearedAt: Record<number, number>;
  nextRespawn: number;
  nextWanderer: number;
  nextCollapse: number;
  nextWave: number;
  /** The full story of the run, revealed on the results screen. */
  chronicle: { time: number; text: string }[];
  escalation: boolean;
  events: Record<number, RoomEvent>;
  villagers: Record<string, Villager>;
  /** Shared objectives: every hero who escapes gets a bonus per altar/villager. */
  objectives: { altars: number; villagers: number };
  /** Counters for the results screen and the balance simulator. */
  stats: {
    /** turns: hero turns taken in fights · fightTime: total seconds spent fighting. */
    fights: number; turns: number; fightTime: number; slain: number; downs: number; revives: number; collapses: number; waves: number;
    afflictions: number; heartAttacks: number; eventsUsed: number;
  };
}

export type Intent =
  | { type: 'goto'; room: number }
  | { type: 'turnBack' }
  | { type: 'stop' }
  | { type: 'combat'; choice: Choice }
  /** Out of combat: spend a few seconds getting a downed ally in your room back up. */
  | { type: 'revive'; target: string }
  /** Loot vote: a hero id, or 'leave'. */
  | { type: 'vote'; choice: string }
  | { type: 'claim'; index: number }
  | { type: 'drop'; index: number }
  /** Take off a weapon or armor and put it on the floor. */
  | { type: 'unequip'; slot: GearSlot }
  | { type: 'useItem'; index: number; target?: string }
  /** Leave the dungeon through the open exit. */
  | { type: 'extract' }
  /** Dig through a collapsed corridor leading out of your room. */
  | { type: 'dig'; corridor: number }
  /** Pick an option of the event in your room. */
  | { type: 'event'; choice: string }
  /** Lampbearer only: heal someone in your room outside a fight. */
  | { type: 'fieldMend'; target: string };

export interface WorldOptions {
  /** Default true. Tests of pure movement turn monsters off. */
  monsters?: boolean;
  /** Default true. */
  loot?: boolean;
  /** Default true. Turn off for tests that need a static dungeon. */
  escalation?: boolean;
  /** Default: same as `monsters`. */
  events?: boolean;
}

/** Auto-paths treat each known monster in a room as this many seconds of extra walking. */
export const THREAT_DETOUR = 15;

export function createWorld(seed: number, opts: WorldOptions = {}): World {
  const world: World = {
    seed, time: 0, dungeon: generateDungeon(seed), heroes: {}, phase: 'running', chalk: {},
    monsters: {}, encounters: {}, rng: new Rng(seed ^ 0x5bd1e995), nextId: 1, piles: {}, bounty: {},
    tier: 0, packs: {}, collapsed: [], clearedAt: {}, chronicle: [], escalation: opts.escalation !== false,
    stats: { fights: 0, turns: 0, fightTime: 0, slain: 0, downs: 0, revives: 0, collapses: 0, waves: 0, afflictions: 0, heartAttacks: 0, eventsUsed: 0 },
    events: {}, villagers: {}, objectives: { altars: 0, villagers: 0 },
    nextRespawn: TIER_INTERVAL, nextWanderer: TIER_INTERVAL * 2, nextCollapse: TIER_INTERVAL * 3, nextWave: EXIT_OPENS_AT,
  };
  if (opts.monsters !== false) spawnInitialMonsters(world);
  // Events default to following `monsters` (captives come with guards).
  if (opts.events ?? opts.monsters !== false) spawnEvents(world);
  if (opts.loot !== false) spawnInitialLoot(world);
  return world;
}

export function addHero(world: World, opts: { id: string; name: string; cls: ClassId; isBot?: boolean }): Hero {
  const d = world.dungeon;
  const hero: Hero = {
    ...opts,
    isBot: opts.isBot ?? false,
    lastKnown: {},
    knownChalk: {},
    knownThreat: {},
    hp: CLASSES[opts.cls].maxHp,
    maxHp: CLASSES[opts.cls].maxHp,
    stress: 0,
    st: {},
    cooldowns: {},
    downedAt: null,
    dead: false,
    diedAt: null,
    encounter: null,
    prevRoom: null,
    channel: null,
    items: [],
    speedMods: [],
    weapon: null,
    armor: null,
    gold: 0,
    messages: [],
    knownLoot: {},
    knownCollapsed: [],
    extracted: false,
    extractedAt: null,
    fate: null,
    arrivedAt: null,
    affliction: null,
    leading: null,
    knownEvents: {},
    fieldMendAt: 0,
    color: CLASSES[opts.cls].color,
    pos: { kind: 'room', room: d.entrance },
    path: [],
    heading: null,
    light: LIGHT_MAX,
    explored: [],
    seen: [d.exit],
  };
  world.heroes[hero.id] = hero;
  explore(world, hero, d.entrance);
  updateKnowledge(world);
  return hero;
}

export function step(world: World, dt: number): void {
  if (world.phase !== 'running') return;
  world.time += dt;
  const drain = LIGHT_DRAIN * (world.tier >= 4 ? ESCALATION.lateLightDrain : 1);
  for (const hero of Object.values(world.heroes)) {
    if (!inDungeon(hero)) continue;
    hero.light = Math.max(0, hero.light - drain * dt);
    if (hero.channel) tickChannel(world, hero);
    else if (isConscious(hero) && hero.encounter === null) advance(world, hero, dt);
  }
  tickDowned(world);
  tickCombat(world);
  tickLoot(world);
  tickEvents(world, dt);
  tickStress(world, dt);
  if (world.escalation) tickEscalation(world);
  updateKnowledge(world);
  checkEnd(world);
}

function checkEnd(world: World) {
  const heroes = Object.values(world.heroes);
  if (heroes.length === 0) return;
  if (world.time >= COLLAPSE_AT) {
    for (const h of heroes) {
      if (!inDungeon(h)) continue;
      h.dead = true;
      h.diedAt = world.time;
      h.fate = `was buried when the dungeon collapsed (in ${roomName(world, h)})`;
      chronicle(world, `The dungeon collapsed on ${h.name}.`);
    }
    world.phase = 'collapsed';
  } else if (heroes.every((h) => h.dead)) {
    world.phase = 'wiped';
  } else if (heroes.every((h) => !inDungeon(h))) {
    world.phase = 'ended';
  }
  if (world.phase !== 'running') {
    const { altars, villagers } = world.objectives;
    const bonus = altars * EVENT_SEEDING.altarBonus + villagers * EVENT_SEEDING.villagerBonus;
    if (bonus > 0) {
      chronicle(world, `Objectives: ${altars} altar(s) cleansed, ${villagers} villager(s) saved. +${bonus} gold to each survivor.`);
      for (const h of heroes) {
        if (!h.extracted) continue;
        h.gold += bonus;
        h.fate = `escaped with ${h.gold} gold`;
      }
    }
    chronicle(world, 'The expedition is over.');
  }
}

export function chronicle(world: World, text: string) {
  world.chronicle.push({ time: world.time, text });
}

export function roomName(world: World, h: Hero): string {
  const room = h.pos.kind === 'room' ? h.pos.room : h.pos.to;
  return h.pos.kind === 'room' ? theRoom(world.dungeon.rooms[room].name) : `the tunnel to ${theRoom(world.dungeon.rooms[room].name)}`;
}

/** Leave the dungeon. Your gold counts; you're out of the story from here. */
export function extractHero(world: World, h: Hero) {
  h.extracted = true;
  h.extractedAt = world.time;
  h.path = [];
  h.channel = null;
  h.fate = `escaped with ${h.gold} gold`;
  chronicle(world, `${h.name} escaped with ${h.gold} gold.`);
  // Only those who saw it happen know they left.
  for (const o of Object.values(world.heroes)) {
    if (o !== h && inDungeon(o) && sameRoom(o, h)) {
      o.lastKnown[h.id] = {
        pos: { ...h.pos }, heading: null, time: world.time, hp: h.hp, maxHp: h.maxHp, downed: false, dead: false, extracted: true, affliction: h.affliction,
      };
      notify(world, o, `${h.name} escapes through the exit.`);
    }
  }
}

export function applyIntent(world: World, heroId: string, intent: Intent): void {
  const hero = world.heroes[heroId];
  if (!hero || world.phase !== 'running' || !isConscious(hero)) return;
  if (intent.type === 'combat') {
    submitChoice(world, hero, intent.choice);
    return;
  }
  if (hero.encounter !== null) return; // movement is locked during a fight
  switch (intent.type) {
    case 'vote':
      castVote(world, hero, intent.choice);
      return;
    case 'claim':
      claimAbandoned(world, hero, intent.index);
      return;
    case 'drop':
      dropItem(world, hero, intent.index);
      return;
    case 'unequip':
      unequip(world, hero, intent.slot);
      return;
    case 'useItem': {
      const err = useItemInField(world, hero, intent.index, intent.target);
      if (err) notify(world, hero, err);
      return;
    }
    case 'dig': {
      const c = world.dungeon.corridors[intent.corridor];
      if (!c || hero.pos.kind !== 'room' || (c.a !== hero.pos.room && c.b !== hero.pos.room)) return;
      if (!world.collapsed.includes(c.id)) return;
      if (lockedByVote(world, hero)) return notify(world, hero, 'Agree on the loot first.');
      hero.path = [];
      const time = hero.cls === 'warden' ? ESCALATION.digTimeWarden : ESCALATION.digTime;
      hero.channel = { kind: 'dig', corridor: c.id, until: world.time + time };
      notify(world, hero, `You start digging… (${time}s)`);
      return;
    }
    case 'event': {
      const err = chooseEvent(world, hero, intent.choice);
      if (err) notify(world, hero, err);
      return;
    }
    case 'fieldMend': {
      const t = world.heroes[intent.target];
      if (hero.cls !== 'lampbearer' || !t || !isConscious(t) || !sameRoom(hero, t)) return;
      if (world.time < hero.fieldMendAt) return notify(world, hero, `Mend is ready in ${Math.ceil(hero.fieldMendAt - world.time)}s.`);
      if (t !== hero && t.affliction === 'paranoid') return notify(world, hero, `${t.name} refuses your help. (Paranoid)`);
      if (t.hp >= t.maxHp && !t.st.bleed) return notify(world, hero, `${t === hero ? "You're" : `${t.name} is`} not hurt.`);
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + FIELD_MEND.heal);
      delete t.st.bleed;
      hero.fieldMendAt = world.time + FIELD_MEND.cooldown;
      notify(world, hero, `You mend ${t === hero ? 'yourself' : t.name} (+${t.hp - before}).`);
      if (t !== hero) notify(world, t, `${hero.name} mends your wounds (+${t.hp - before}).`);
      return;
    }
    case 'extract':
      if (hero.pos.kind !== 'room' || hero.pos.room !== world.dungeon.exit) return notify(world, hero, 'You must be at the rendezvous.');
      if (world.time < EXIT_OPENS_AT) return notify(world, hero, 'The exit is not open yet.');
      if (lockedByVote(world, hero)) return notify(world, hero, 'Agree on the loot before you go.');
      extractHero(world, hero);
      return;
    case 'revive': {
      const t = world.heroes[intent.target];
      if (t && t !== hero && inDungeon(t) && t.downedAt !== null && hero.pos.kind === 'room' && sameRoom(hero, t)) {
        hero.path = [];
        hero.channel = { kind: 'revive', target: t.id, until: world.time + REVIVE_CHANNEL };
      }
      return;
    }
    case 'stop':
      hero.path = [];
      hero.heading = null;
      hero.channel = null;
      return;
    case 'turnBack':
      hero.channel = null;
      if (hero.pos.kind === 'corridor') turnAround(world, hero);
      hero.path = [];
      hero.heading = null;
      return;
    case 'goto':
      if (lockedByVote(world, hero)) {
        notify(world, hero, 'Agree on the loot before moving on.');
        return;
      }
      // Only an actual move interrupts digging/reviving; an unreachable click shouldn't.
      if (goto(world, hero, intent.room)) {
        hero.channel = null;
        hero.heading = intent.room;
      }
      else if (hero.pos.kind === 'room' && intent.room !== hero.pos.room) notify(world, hero, "You don't know a way there.");
      return;
  }
}

function lootCount(world: World, room: number): number {
  const p = world.piles[room];
  return p ? p.items.length + p.abandoned.length + (p.vote ? 1 : 0) + (p.gold > 0 ? 1 : 0) : 0;
}

function sameRoom(a: Hero, b: Hero) {
  return a.pos.kind === 'room' && b.pos.kind === 'room' && a.pos.room === b.pos.room;
}

function tickChannel(world: World, hero: Hero) {
  const ch = hero.channel!;
  if (ch.kind === 'event') return; // see events.ts
  if (world.time < ch.until) return;
  hero.channel = null;
  if (ch.kind === 'dig') {
    if (world.collapsed.includes(ch.corridor)) clearRubble(world, ch.corridor, hero.name);
    return;
  }
  const t = world.heroes[ch.target];
  if (t && inDungeon(t) && t.downedAt !== null && sameRoom(hero, t)) reviveHero(t, undefined, world, hero);
}

// ---------------------------------------------------------------------------

function advance(world: World, hero: Hero, dt: number) {
  const d = world.dungeon;
  // Escorting a villager slows you down.
  let remaining = hero.leading ? dt * EVENT_SEEDING.villagerSpeed : dt;
  // Bounded loop: each iteration either consumes time or enters a corridor.
  for (let guard = 0; guard < 16 && remaining > 1e-9; guard++) {
    const pos = hero.pos;
    if (pos.kind === 'room') {
      const next = hero.path.shift();
      if (next === undefined) return;
      const c = corridorBetween(d, pos.room, next);
      if (!c) {
        hero.path = [];
        return;
      }
      if (world.collapsed.includes(c.id)) {
        hero.path = [];
        if (!hero.knownCollapsed.includes(c.id)) hero.knownCollapsed.push(c.id);
        notify(world, hero, `Rubble blocks the way to ${theRoom(d.rooms[next].name)}!`);
        return;
      }
      hero.pos = { kind: 'corridor', corridor: c.id, from: pos.room, to: next, t: 0, dur: speedOf(hero, world.time) };
      hero.prevRoom = pos.room;
      if (isCrossroads(d, pos.room)) (world.chalk[pos.room] ??= {})[hero.id] = c.id;
    } else {
      const need = pos.dur - pos.t;
      if (remaining < need) {
        pos.t += remaining;
        return;
      }
      remaining -= need;
      pos.t = pos.dur;
      // Heroes who took the same tunnel the same way travel together: the quicker ones wait for the rest.
      const party = companions(world, hero);
      if (party.some((o) => o.pos.kind === 'corridor' && o.pos.t < o.pos.dur)) return;
      for (const o of party) arrive(world, o);
      if (!arrive(world, hero)) return;
    }
  }
}

/** Conscious heroes in the same tunnel as `hero`, going the same way (not including `hero`). */
export function companions(world: World, hero: Hero): Hero[] {
  const pos = hero.pos;
  if (pos.kind !== 'corridor') return [];
  return Object.values(world.heroes).filter((o) =>
    o !== hero && isConscious(o) && o.pos.kind === 'corridor' && o.pos.corridor === pos.corridor && o.pos.to === pos.to);
}

/** Step out of the tunnel into the room at its end. Returns false if the hero should stop walking (fight, loot). */
function arrive(world: World, hero: Hero): boolean {
  const pos = hero.pos;
  if (pos.kind !== 'corridor') return false;
  hero.pos = { kind: 'room', room: pos.to };
  if (hero.path.length === 0) hero.heading = null;
  if (pos.to === world.dungeon.exit) hero.arrivedAt = world.time;
  explore(world, hero, pos.to);
  onHeroInRoom(world, hero, pos.to);
  if (hero.encounter !== null) return false;
  const pile = world.piles[pos.to];
  if (pile && (pile.vote || pile.items.length)) {
    hero.path = []; // stop: there's loot to agree on
    return false;
  }
  return true;
}

/** Refresh every hero's sightings of others and the chalk marks they can read. */
function updateKnowledge(world: World) {
  const heroes = Object.values(world.heroes);
  for (const a of heroes) {
    for (const b of heroes) {
      if (a !== b && inDungeon(a) && (inDungeon(b) || b.dead) && canSee(world, a, b)) {
        a.lastKnown[b.id] = {
          pos: { ...b.pos }, heading: headingOf(b), time: world.time, hp: b.hp, maxHp: b.maxHp, downed: b.downedAt !== null, dead: b.dead, affliction: b.affliction,
        };
      }
    }
    if (!inDungeon(a)) continue;
    if (a.pos.kind === 'room') {
      const room = a.pos.room;
      for (const cid of world.dungeon.rooms[room].corridors) {
        const down = world.collapsed.includes(cid);
        if (down && !a.knownCollapsed.includes(cid)) a.knownCollapsed.push(cid);
        if (!down && a.knownCollapsed.includes(cid)) a.knownCollapsed = a.knownCollapsed.filter((x) => x !== cid);
      }
      if (world.chalk[room]) a.knownChalk[room] = { ...world.chalk[room] };
      a.knownThreat[room] = monstersIn(world, room).length;
      a.knownLoot[room] = lootCount(world, room);
      const ev = world.events[room];
      if (villagerHere(world, room)) a.knownEvents[room] = 'villager';
      else if (ev && !ev.done) a.knownEvents[room] = ev.kind;
      else delete a.knownEvents[room];
      if (a.cls === 'cutthroat') for (const n of neighbours(world.dungeon, room)) a.knownLoot[n] = lootCount(world, n);
      if (a.light >= LIGHT_DIM) for (const n of neighbours(world.dungeon, room)) a.knownThreat[n] = monstersIn(world, n).length;
    }
  }
}

/** Same room, same corridor, a corridor touching your room, or (if you have light) an adjacent room. */
export function canSee(world: World, a: Hero, b: Hero): boolean {
  const d = world.dungeon;
  const pa = a.pos;
  const pb = b.pos;
  if (pa.kind === 'room' && pb.kind === 'room') {
    if (pa.room === pb.room) return true;
    return a.light >= LIGHT_DIM && corridorBetween(d, pa.room, pb.room) !== undefined;
  }
  if (pa.kind === 'corridor' && pb.kind === 'corridor') return pa.corridor === pb.corridor;
  const roomPos = pa.kind === 'room' ? pa : pb;
  const corrPos = pa.kind === 'corridor' ? pa : pb;
  if (roomPos.kind !== 'room' || corrPos.kind !== 'corridor') return false;
  const room = roomPos.room;
  const c = d.corridors[corrPos.corridor];
  return c.a === room || c.b === room;
}

function turnAround(world: World, hero: Hero) {
  const pos = hero.pos;
  if (pos.kind !== 'corridor') return;
  hero.pos = { kind: 'corridor', corridor: pos.corridor, from: pos.to, to: pos.from, t: Math.max(0, pos.dur - pos.t), dur: pos.dur };
}

export function explore(world: World, hero: Hero, room: number) {
  addUnique(hero.explored, room);
  addUnique(hero.seen, room);
  if (hero.light >= LIGHT_DIM || seesInDark(hero)) {
    for (const n of neighbours(world.dungeon, room)) addUnique(hero.seen, n);
  }
}

function addUnique(arr: number[], v: number) {
  if (!arr.includes(v)) arr.push(v);
}

/** A corridor is known to a hero once they have explored either end. */
export function knowsCorridor(hero: Hero, c: { a: number; b: number }): boolean {
  return hero.explored.includes(c.a) || hero.explored.includes(c.b);
}

/** Plan a route to `target`. Returns false if no known route exists. */
function goto(world: World, hero: Hero, target: number): boolean {
  const d = world.dungeon;
  if (!d.rooms[target]) return false;
  const pos = hero.pos;
  if (pos.kind === 'room') {
    const path = shortestPath(world, hero, pos.room, target);
    if (!path || path.length === 0) return false;
    hero.path = path;
    return true;
  }
  // In a corridor: compare continuing forward vs turning back.
  const fwd = shortestPath(world, hero, pos.to, target);
  const back = shortestPath(world, hero, pos.from, target);
  const fwdCost = fwd ? pos.dur - pos.t + pathCost(d, pos.to, fwd) : Infinity;
  const backCost = back ? pos.t + pathCost(d, pos.from, back) : Infinity;
  if (fwdCost === Infinity && backCost === Infinity) return false;
  if (backCost < fwdCost) {
    turnAround(world, hero);
    hero.path = back!;
  } else {
    hero.path = fwd!;
  }
  return true;
}

function pathCost(d: Dungeon, start: number, path: number[]): number {
  let cost = 0;
  let cur = start;
  for (const next of path) {
    cost += corridorBetween(d, cur, next)!.length;
    cur = next;
  }
  return cost;
}

/**
 * Dijkstra over corridors the hero knows. Returns rooms to visit after `start`
 * (empty if start === target), or null if unreachable.
 */
export function shortestPath(world: World, hero: Hero, start: number, target: number): number[] | null {
  const d = world.dungeon;
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  while (true) {
    let cur = -1;
    let best = Infinity;
    for (const [room, cost] of dist) {
      if (!done.has(room) && cost < best) {
        best = cost;
        cur = room;
      }
    }
    if (cur === -1) return null;
    if (cur === target) break;
    done.add(cur);
    for (const cid of d.rooms[cur].corridors) {
      const c = d.corridors[cid];
      if (!knowsCorridor(hero, c) || hero.knownCollapsed.includes(c.id)) continue;
      const n = otherEnd(c, cur);
      // Detour around rooms you know hold monsters (but never refuse to go where you clicked).
      const danger = n === target ? 0 : (hero.knownThreat[n] ?? 0) * THREAT_DETOUR;
      const nd = best + c.length + danger;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        prev.set(n, cur);
      }
    }
  }
  const path: number[] = [];
  for (let cur = target; cur !== start; cur = prev.get(cur)!) path.unshift(cur);
  return path;
}

/** The room a hero is walking toward (their chosen destination), or null if they're standing still. */
export function headingOf(h: Hero): number | null {
  const final = h.path.length ? h.path[h.path.length - 1] : h.pos.kind === 'corridor' ? h.pos.to : null;
  if (final === null || h.encounter !== null) return null;
  return h.heading ?? final;
}

/** World-space position of a hero, for rendering and distance checks. */
export function heroXY(d: Dungeon, pos: HeroPos): { x: number; y: number } {
  if (pos.kind === 'room') return { x: d.rooms[pos.room].x, y: d.rooms[pos.room].y };
  const a = d.rooms[pos.from];
  const b = d.rooms[pos.to];
  const f = Math.min(1, pos.t / pos.dur);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
