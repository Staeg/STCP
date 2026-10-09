import { CLASSES, SPARE_COLORS, type ClassId } from '../content/classes';
import { COLLAPSE_AT, EXIT_OPENS_AT, LIGHT_DIM, LIGHT_DRAIN, LIGHT_MAX, TIER_INTERVAL } from '../content/constants';
import { ESCALATION } from '../content/enemies';
import { CLASS_RULES } from '../content/abilities';
import { clearRubble, tickEscalation, type Pack } from './escalation';
import { chooseEvent, spawnEvents, tickEvents, tickStress, villagerHere, type RoomEvent, type Villager } from './events';
import { EVENT_SEEDING, type AfflictionId, type EventKind } from '../content/events';
import { corridorBetween, generateDungeon, isCrossroads, neighbours, otherEnd, theRoom, type Dungeon } from '../dungeon/gen';
import { Rng } from '../rng';
import {
  bleedOut, inDungeon, isConscious, monstersIn, onHeroInRoom, REVIVE_CHANNEL, reviveHero, spawnInitialMonsters, submitChoice, tickCombat, tickCooldowns, tickDowned, tickFieldCooldowns,
  type Choice, type Encounter, type Monster, type Statuses,
} from './combat';
import type { GearSlot, ItemId } from '../content/items';
import { notify } from './notify';
import { fmtSpeed, speedOf, type SpeedMod } from './speed';
import { checkSkill, fieldSkillsOf, hearsToll, tickBrew, useSkill, type FieldSkill } from './skills';
import {
  activeItems, castVote, claimItem, wants, dropItem, unequip, seesInDark, spawnInitialLoot, tickLoot, useItemInField, type Pile,
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
  /**
   * Out of combat, this hero's Speed timer runs all the time: it started at `turnStart` and runs out at `turnAt`.
   * A move picked during it lands when it runs out (walking a tunnel fills the timer); an event or a dig
   * starts then. Nothing picked means the turn is skipped. It's held while fighting, channelling or down.
   */
  turnStart: number;
  turnAt: number;
  /** An event choice to start when the timer runs out. */
  queuedEvent: string | null;
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
  /** Ability id → own turns until usable. Shared by fights and the field; outside a fight they tick each time the Speed timer runs out. */
  cooldowns: Record<string, number>;
  /** Seconds channelling since cooldowns last ticked. */
  cdClock: number;
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
  /** An out-of-combat skill, picked and waiting for the timer to run out (like an event choice). */
  queuedSkill: { skill: FieldSkill; target: string | null } | null;
  /** Undertaker: extra Spade damage, earned by Last Rites kills this run. */
  spadeBonus: number;
  /** Elixir: this hero's next item has double effect. */
  elixir: boolean;
  /** Alchemist: when the next brew is done. */
  brewAt: number;
  /** Undertaker: gold carried for fallen allies (hero id → gold). It reaches their stash if this hero escapes. */
  bodies: Record<string, number>;
  /** Dead heroes: gold an Undertaker carried out for them. */
  legacy: number;
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

export interface Toll {
  by: string;
  room: number;
  time: number;
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
  /** Bells tolled (newest last): everyone hears them. */
  tolls: Toll[];
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
  /** `step`: one tunnel straight to a neighbouring room (WASD), never a detour; ignored if there's no such tunnel. */
  | { type: 'goto'; room: number; step?: boolean }
  | { type: 'turnBack' }
  | { type: 'stop' }
  | { type: 'combat'; choice: Choice }
  /** Out of combat: spend a few seconds getting a downed ally in your room back up. */
  | { type: 'revive'; target: string }
  /** Loot vote on one floor item (by its id): a hero id, or 'leave'. */
  | { type: 'vote'; item: number; choice: string }
  /** Bring an ignored floor item back up for grabs (alone: just take it). */
  | { type: 'claim'; item: number }
  | { type: 'drop'; index: number }
  /** Take off a weapon or armor and put it on the floor. */
  | { type: 'unequip'; slot: GearSlot }
  | { type: 'useItem'; index: number; target?: string }
  /** Leave the dungeon through the open exit. */
  | { type: 'extract' }
  /** Pick an option of the event in your room. */
  | { type: 'event'; choice: string }
  /** A class skill out of a fight (Toll, or an ability that works in the field): happens when your timer runs out. Default: your first one. */
  | { type: 'skill'; skill?: FieldSkill; target?: string };

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
    events: {}, villagers: {}, objectives: { altars: 0, villagers: 0 }, tolls: [],
    nextRespawn: TIER_INTERVAL, nextWanderer: TIER_INTERVAL * 2, nextCollapse: TIER_INTERVAL * 3, nextWave: EXIT_OPENS_AT,
  };
  if (opts.monsters !== false) spawnInitialMonsters(world);
  // Events default to following `monsters` (captives come with guards).
  if (opts.events ?? opts.monsters !== false) spawnEvents(world);
  if (opts.loot !== false) spawnInitialLoot(world);
  return world;
}

/** The class colour, unless another hero already wears it (two of the same class): then a spare one. */
function freeColor(world: World, cls: ClassId): string {
  const used = new Set(Object.values(world.heroes).map((h) => h.color));
  if (!used.has(CLASSES[cls].color)) return CLASSES[cls].color;
  return SPARE_COLORS.find((c) => !used.has(c)) ?? CLASSES[cls].color;
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
    cdClock: 0,
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
    queuedSkill: null,
    spadeBonus: 0,
    elixir: false,
    brewAt: world.time + CLASS_RULES.brewEvery,
    bodies: {},
    legacy: 0,
    color: freeColor(world, opts.cls),
    pos: { kind: 'room', room: d.entrance },
    path: [],
    heading: null,
    turnStart: world.time,
    turnAt: world.time,
    queuedEvent: null,
    light: LIGHT_MAX,
    explored: [],
    seen: [d.exit],
  };
  world.heroes[hero.id] = hero;
  startTimer(world, hero);
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
    hero.light = Math.max(0, hero.light - drain * (hero.cls === 'lampbearer' ? CLASS_RULES.lampLightDrain : 1) * dt);
    // Cooldowns tick when the Speed timer runs out (see endIdleTurn and arrive); a channel holds the timer, so time it instead.
    if (isConscious(hero) && hero.encounter === null && hero.channel) tickFieldCooldowns(world, hero, dt);
    else hero.cdClock = 0;
    if (hero.channel) tickChannel(world, hero);
    else if (isConscious(hero) && hero.encounter === null) advance(world, hero, dt);
    // The next timer only starts once the hero is free again.
    if (hero.channel || !isConscious(hero) || hero.encounter !== null) {
      startTimer(world, hero);
      hero.queuedEvent = null;
      hero.queuedSkill = null;
    }
    if (hero.cls === 'alchemist') tickBrew(world, hero);
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
  } else {
    // Nobody left standing to get the downed back up: they bleed out now instead of after the wait.
    if (heroes.every((h) => !inDungeon(h) || h.downedAt !== null)) for (const h of heroes) if (inDungeon(h)) bleedOut(world, h);
    if (heroes.every((h) => h.dead)) world.phase = 'wiped';
    else if (heroes.every((h) => !inDungeon(h))) world.phase = 'ended';
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
  // Mortician: the fallen's gold goes home with the Undertaker, and counts for them.
  for (const [id, gold] of Object.entries(h.bodies)) {
    const dead = world.heroes[id];
    if (!dead) continue;
    dead.legacy += gold;
    chronicle(world, `${h.name} carried ${dead.name}'s ${gold} gold home for them.`);
  }
  h.bodies = {};
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
      castVote(world, hero, intent.item, intent.choice);
      return;
    case 'claim': {
      const err = claimItem(world, hero, intent.item);
      if (err) notify(world, hero, err);
      return;
    }
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
    case 'event': {
      // Checked now so a bad pick is refused at once; it starts when the timer runs out.
      const err = chooseEvent(world, hero, intent.choice, true);
      if (err) return notify(world, hero, err);
      if (hero.channel?.kind === 'event') return;
      hero.channel = null; // stop digging or reviving
      hero.queuedEvent = intent.choice;
      hero.path = [];
      hero.heading = null;
      return;
    }
    case 'skill': {
      const skill = intent.skill ?? fieldSkillsOf(hero)[0];
      const err = skill ? checkSkill(world, hero, skill, intent.target ?? null) : 'You have no such skill.';
      if (err) return notify(world, hero, err);
      hero.channel = null;
      hero.queuedEvent = null;
      hero.queuedSkill = { skill: skill!, target: intent.target ?? null };
      hero.path = [];
      hero.heading = null;
      return;
    }
    case 'extract':
      if (hero.pos.kind !== 'room' || hero.pos.room !== world.dungeon.exit) return notify(world, hero, 'You must be at the rendezvous.');
      if (world.time < EXIT_OPENS_AT) return notify(world, hero, 'The exit is not open yet.');
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
      hero.queuedEvent = null;
      hero.queuedSkill = null;
      return;
    case 'turnBack':
      hero.channel = null;
      if (hero.pos.kind === 'corridor') turnAround(world, hero);
      hero.path = [];
      hero.heading = null;
      return;
    case 'goto':
      // Only an actual move interrupts digging/reviving; an unreachable click shouldn't.
      if (intent.step ? stepTo(world, hero, intent.room) : goto(world, hero, intent.room)) {
        hero.channel = null;
        hero.queuedEvent = null;
        hero.queuedSkill = null;
        hero.heading = intent.room;
      }
      else if (!intent.step && hero.pos.kind === 'room' && intent.room !== hero.pos.room) notify(world, hero, "You don't know a way there.");
      return;
  }
}

/** Loot in a room worth this hero's notice: gold, and items they don't ignore. */
function lootCount(world: World, room: number, h: Hero): number {
  const p = world.piles[room];
  return p ? p.items.filter((f) => wants(h, f)).length + (p.gold > 0 ? 1 : 0) : 0;
}

function sameRoom(a: Hero, b: Hero) {
  return a.pos.kind === 'room' && b.pos.kind === 'room' && a.pos.room === b.pos.room;
}

function tickChannel(world: World, hero: Hero) {
  const ch = hero.channel!;
  if (ch.kind === 'event') return; // see events.ts
  if (world.time < ch.until) return;
  hero.channel = null;
  // Done: the next timer starts now.
  startTimer(world, hero, ch.until);
  if (ch.kind === 'dig') {
    if (world.collapsed.includes(ch.corridor)) clearRubble(world, ch.corridor, hero.name);
    return;
  }
  const t = world.heroes[ch.target];
  if (t && inDungeon(t) && t.downedAt !== null && sameRoom(hero, t)) reviveHero(t, undefined, world, hero);
}

// ---------------------------------------------------------------------------

/** Start a fresh Speed timer for a hero (from now, unless given). */
export function startTimer(world: World, hero: Hero, from = world.time) {
  hero.turnStart = from;
  hero.turnAt = from + speedOf(hero, from);
}

/** Has this hero's timer run out? (With a little slack for the float drift of 0.1s ticks.) */
function timerDone(world: World, hero: Hero): boolean {
  return world.time >= hero.turnAt - 1e-6;
}

/** Seconds of digging to clear rubble. The Undertaker needs only one turn of their own. */
export function digTime(hero: Hero, now: number): number {
  return hero.cls === 'undertaker' ? speedOf(hero, now) : ESCALATION.digTime;
}

/** The timer ran out with nowhere to walk: start the queued event, or skip the turn. */
function endIdleTurn(world: World, hero: Hero) {
  tickCooldowns(hero);
  const choice = hero.queuedEvent;
  hero.queuedEvent = null;
  if (choice !== null) {
    const err = chooseEvent(world, hero, choice);
    if (err) notify(world, hero, err);
  }
  const skill = hero.queuedSkill;
  hero.queuedSkill = null;
  if (skill) useSkill(world, hero, skill.skill, skill.target);
  if (!hero.channel) startTimer(world, hero, hero.turnAt);
}

function advance(world: World, hero: Hero, dt: number) {
  const d = world.dungeon;
  // Escorting a villager slows you down.
  const rate = hero.leading ? EVENT_SEEDING.villagerSpeed : 1;
  let remaining = dt * rate;
  // Bounded loop: each iteration either consumes time, enters a corridor or arrives.
  for (let guard = 0; guard < 16; guard++) {
    const pos = hero.pos;
    if (pos.kind === 'room') {
      const next = hero.path[0];
      if (next === undefined) {
        if (timerDone(world, hero)) endIdleTurn(world, hero);
        return;
      }
      const c = corridorBetween(d, pos.room, next);
      if (!c) {
        hero.path = [];
        return;
      }
      if (world.collapsed.includes(c.id)) {
        if (!hero.knownCollapsed.includes(c.id)) {
          hero.knownCollapsed.push(c.id);
          notify(world, hero, `Rubble blocks the way to ${theRoom(d.rooms[next].name)}. You'll dig through.`);
        }
        // Digging starts when the timer runs out; the walk carries on once the way is clear.
        if (!timerDone(world, hero)) return;
        const dig = digTime(hero, world.time);
        hero.channel = { kind: 'dig', corridor: c.id, until: world.time + dig };
        notify(world, hero, `You start digging… (${fmtSpeed(dig)}; walking elsewhere stops it)`);
        return;
      }
      hero.path.shift();
      // The walk fills this turn's timer: setting out late in it puts you part-way down the tunnel already.
      const dur = hero.turnAt - hero.turnStart;
      const t = Math.min(dur, Math.max(0, world.time - hero.turnStart) * rate);
      hero.pos = { kind: 'corridor', corridor: c.id, from: pos.room, to: next, t, dur };
      hero.prevRoom = pos.room;
      remaining = 0;
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
      // The moment of arrival (possibly part-way through this tick); the next timer starts then.
      const at = world.time - remaining / rate;
      for (const o of party) arrive(world, o, at);
      if (!arrive(world, hero, at)) return;
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
function arrive(world: World, hero: Hero, at = world.time): boolean {
  const pos = hero.pos;
  if (pos.kind !== 'corridor') return false;
  hero.pos = { kind: 'room', room: pos.to };
  tickCooldowns(hero); // the walk was this turn
  startTimer(world, hero, at);
  if (hero.path.length === 0) hero.heading = null;
  if (pos.to === world.dungeon.exit) hero.arrivedAt = world.time;
  explore(world, hero, pos.to);
  onHeroInRoom(world, hero, pos.to);
  if (hero.encounter !== null) return false;
  // Stop for loot worth a look (alone: to pick it up; with others: to divvy it up). Walking on leaves it.
  if (activeItems(world, pos.to).length > 0) {
    hero.path = [];
    return false;
  }
  return true;
}

/** Refresh every hero's sightings of others and the chalk marks they can read. */
function updateKnowledge(world: World) {
  const heroes = Object.values(world.heroes);
  for (const a of heroes) {
    for (const b of heroes) {
      if (a !== b && inDungeon(a) && (inDungeon(b) || b.dead) && (canSee(world, a, b) || hearsToll(world, b))) {
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
      a.knownLoot[room] = lootCount(world, room, a);
      const ev = world.events[room];
      if (villagerHere(world, room)) a.knownEvents[room] = 'villager';
      else if (ev && !ev.done) a.knownEvents[room] = ev.kind;
      else delete a.knownEvents[room];
      if (a.cls === 'cutthroat') for (const n of neighbours(world.dungeon, room)) a.knownLoot[n] = lootCount(world, n, a);
      if (a.light >= LIGHT_DIM || seesInDark(a)) for (const n of neighbours(world.dungeon, room)) a.knownThreat[n] = monstersIn(world, n).length;
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
    return (a.light >= LIGHT_DIM || seesInDark(a)) && corridorBetween(d, pa.room, pb.room) !== undefined;
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

/** Head straight down the known tunnel to a neighbouring room (from a tunnel: back, or on from where it leads). */
function stepTo(world: World, hero: Hero, target: number): boolean {
  const pos = hero.pos;
  if (pos.kind === 'corridor' && target === pos.from) {
    turnAround(world, hero);
    hero.path = [];
    return true;
  }
  const from = pos.kind === 'room' ? pos.room : pos.to;
  const c = corridorBetween(world.dungeon, from, target);
  if (!c || !knowsCorridor(hero, c)) return false;
  hero.path = [target];
  return true;
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
  const step = speedOf(hero, world.time);
  const fwdCost = fwd ? pos.dur - pos.t + step * fwd.length : Infinity;
  const backCost = back ? pos.t + step * back.length : Infinity;
  if (fwdCost === Infinity && backCost === Infinity) return false;
  if (backCost < fwdCost) {
    turnAround(world, hero);
    hero.path = back!;
  } else {
    hero.path = fwd!;
  }
  return true;
}

/**
 * Dijkstra over corridors the hero knows. Returns rooms to visit after `start`
 * (empty if start === target), or null if unreachable.
 */
export function shortestPath(world: World, hero: Hero, start: number, target: number): number[] | null {
  const d = world.dungeon;
  // Every tunnel takes this hero one turn of their own Speed.
  const walk = speedOf(hero, world.time);
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
      if (!knowsCorridor(hero, c)) continue;
      const n = otherEnd(c, cur);
      // Detour around rooms you know hold monsters (but never refuse to go where you clicked).
      const danger = n === target ? 0 : (hero.knownThreat[n] ?? 0) * THREAT_DETOUR;
      // Known rubble gets dug through on the way, which takes a while.
      const dig = hero.knownCollapsed.includes(c.id) ? digTime(hero, world.time) : 0;
      const nd = best + walk + danger + dig;
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
