import { COLLAPSE_AT, EXIT_OPENS_AT, LIGHT_DIM, tierAt } from '../content/constants';
import type { Corridor, RoomKind } from '../dungeon/gen';
import type { ClassId } from '../content/classes';
import { ENEMIES, type EnemyId, type Rank } from '../content/enemies';
import { INVENTORY_SLOTS, type ItemId } from '../content/items';
import { channelTime, EVENTS, type AfflictionId, type EventKind } from '../content/events';
import { choiceVerb, eventChoices, type EventChoice } from './events';
import { hasSpace, votersIn } from './loot';
import { BLEED_OUT, heroRank, inDungeon, isConscious, monstersIn, type Choice, type CombatEvent, type Statuses } from './combat';
import { knowsCorridor, type Hero, type HeroPos, type World, type WorldPhase } from './world';

/** What a hero knows about a room. 'unknown' = a corridor leads there but they haven't glimpsed it. */
export type RoomKnowledge = 'explored' | 'seen' | 'unknown';

export interface RoomView {
  id: number;
  x: number;
  y: number;
  knowledge: RoomKnowledge;
  name?: string;
  kind?: RoomKind;
  /** Known corridor ids only. */
  corridors: number[];
  /** Monsters you last saw here (undefined = never looked). */
  threat?: number;
  /** Loot you last saw here. */
  loot?: number;
  /** An event you saw here and haven't seen resolved. */
  event?: EventKind;
}

export interface EventView {
  kind: EventKind;
  name: string;
  glyph: string;
  text: string;
  choices: EventChoice[];
  /** Channelled events: 0..1. */
  progress?: number;
  /** Whoever chose it first and is carrying it out (only they can, while they're at it). */
  worker: { id: string; name: string; you: boolean; doing: string; secondsLeft: number } | null;
  /** Monsters are here: deal with them first. */
  blocked: boolean;
}

export interface LootView {
  room: number;
  gold: number;
  /** Items still queued for a vote (the current one is in `vote`). */
  queued: ItemId[];
  abandoned: ItemId[];
  vote: {
    item: ItemId;
    votes: Record<string, string>;
    /** Hero ids that must agree. */
    voters: string[];
    /** Hero ids who can receive it (present, have a free slot). */
    candidates: { id: string; name: string; free: number; isBot: boolean }[];
    startedAt: number;
  } | null;
}

export interface AllyView {
  id: string;
  name: string;
  cls: ClassId;
  color: string;
  isBot: boolean;
  /** True if you can see them right now; otherwise `pos` is where you last saw them. */
  live: boolean;
  pos: HeroPos;
  /** The room they chose to walk to, as of when you saw them (null if standing still). */
  heading: number | null;
  seenAt: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  dead: boolean;
  /** You saw them escape. */
  extracted: boolean;
  affliction: AfflictionId | null;
}

export interface ResultHero {
  id: string;
  name: string;
  cls: ClassId;
  color: string;
  isBot: boolean;
  outcome: 'escaped' | 'dead';
  fate: string;
  gold: number;
  time: number | null;
}

export interface ResultsView {
  heroes: ResultHero[];
  chronicle: { time: number; text: string }[];
}

export type CorridorView = Corridor & { collapsed?: boolean };

export interface CombatUnitView {
  id: string;
  kind: 'hero' | 'monster';
  name: string;
  hp: number;
  maxHp: number;
  rank: Rank;
  st: Statuses;
  cls?: ClassId;
  color?: string;
  enemy?: EnemyId;
  downed?: boolean;
  /** Seconds until a downed hero dies. */
  bleedOut?: number;
  joining?: boolean;
  /** Has locked in a choice this round (heroes only). */
  ready?: boolean;
}

export interface EncounterView {
  room: number;
  round: number;
  phase: 'choosing' | 'resolving';
  /** Seconds left to choose (choosing) or until the next round (resolving). */
  timeLeft: number;
  heroes: CombatUnitView[];
  monsters: CombatUnitView[];
  yourChoice: Choice | null;
  /** True if you arrived mid-round and act from the next one. */
  youJoining: boolean;
  events: CombatEvent[];
  log: string[];
}

export interface ChalkView {
  room: number;
  marks: { heroId: string; corridor: number }[];
}

export interface PlayerView {
  time: number;
  tier: number;
  exitOpensAt: number;
  collapseAt: number;
  phase: WorldPhase;
  width: number;
  height: number;
  you: Hero;
  dim: boolean;
  rooms: RoomView[];
  corridors: CorridorView[];
  allies: AllyView[];
  chalk: ChalkView[];
  ghostCorridors: Corridor[];
  encounter: EncounterView | null;
  /** Loot in your current room, if any. */
  loot: LootView | null;
  exitRoom: number;
  exitOpen: boolean;
  /** The event in your room, if any. */
  event: EventView | null;
  /** The villager you're escorting. */
  leading: { hp: number; maxHp: number } | null;
  objectives: { altars: number; villagers: number };
  /** Only once the expedition is over: the whole truth. */
  results: ResultsView | null;
}

/**
 * Fog-filtered snapshot for one hero. Everything the client gets goes through here,
 * so hidden information never leaves the server.
 */
export function buildView(world: World, heroId: string): PlayerView {
  const d = world.dungeon;
  const you = world.heroes[heroId];
  const corridors: CorridorView[] = d.corridors
    .filter((c) => knowsCorridor(you, c))
    .map((c) => (you.knownCollapsed.includes(c.id) ? { ...c, collapsed: true } : c));
  const roomIds = new Set<number>(you.seen);
  for (const c of corridors) {
    roomIds.add(c.a);
    roomIds.add(c.b);
  }

  const allies: AllyView[] = [];
  for (const [id, sighting] of Object.entries(you.lastKnown)) {
    const h = world.heroes[id];
    if (!h) continue;
    const live = sighting.time === world.time;
    allies.push({
      id, name: h.name, cls: h.cls, color: h.color, isBot: h.isBot, live, pos: { ...sighting.pos }, heading: null, seenAt: sighting.time,
      hp: sighting.hp, maxHp: sighting.maxHp, downed: sighting.downed, dead: sighting.dead, extracted: !!sighting.extracted,
      affliction: sighting.affliction ?? null,
    });
    // Make sure the client can place them, even in a room you only know the position of.
    for (const r of posRooms(sighting.pos)) roomIds.add(r);
  }
  // Where allies are going: their chosen room if you know where that is, otherwise at least their next step.
  for (const a of allies) {
    const s = you.lastKnown[a.id];
    if (s.heading === null) continue;
    const h = world.heroes[a.id];
    const next = s.pos.kind === 'corridor' ? s.pos.to : a.live ? h.path[0] : undefined;
    a.heading = roomIds.has(s.heading) ? s.heading : next ?? null;
    if (a.heading !== null) roomIds.add(a.heading);
  }
  const extraCorridors = allies
    .map((a) => (a.pos.kind === 'corridor' ? d.corridors[a.pos.corridor] : null))
    .filter((c): c is Corridor => !!c && !corridors.includes(c));

  const chalk: ChalkView[] = Object.entries(you.knownChalk).map(([room, marks]) => ({
    room: Number(room),
    marks: Object.entries(marks).map(([heroId, corridor]) => ({ heroId, corridor })),
  }));
  const rooms: RoomView[] = [...roomIds].map((id) => {
    const r = d.rooms[id];
    const knowledge: RoomKnowledge = you.explored.includes(id) ? 'explored' : you.seen.includes(id) ? 'seen' : 'unknown';
    return {
      id,
      x: r.x,
      y: r.y,
      knowledge,
      name: knowledge === 'unknown' ? undefined : r.name,
      kind: knowledge === 'unknown' ? undefined : r.kind,
      corridors: r.corridors.filter((cid) => knowsCorridor(you, d.corridors[cid])),
      threat: you.knownThreat[id],
      loot: you.knownLoot[id],
      event: you.knownEvents[id],
    };
  });
  return {
    time: world.time,
    tier: tierAt(world.time),
    exitOpensAt: EXIT_OPENS_AT,
    collapseAt: COLLAPSE_AT,
    phase: world.phase,
    width: d.width,
    height: d.height,
    you: structuredClone(you) as Hero,
    dim: you.light < LIGHT_DIM,
    rooms,
    corridors,
    allies,
    chalk,
    /** Corridors an ally was seen in that you don't otherwise know; position only. */
    ghostCorridors: extraCorridors,
    encounter: encounterView(world, you),
    loot: lootView(world, you),
    exitRoom: d.exit,
    exitOpen: world.time >= EXIT_OPENS_AT,
    event: eventView(world, you),
    leading: you.leading ? { hp: world.villagers[you.leading].hp, maxHp: world.villagers[you.leading].maxHp } : null,
    objectives: { ...world.objectives },
    results: world.phase === 'running' ? null : resultsView(world),
  };
}

function eventView(world: World, you: Hero): EventView | null {
  if (you.encounter !== null || !inDungeon(you)) return null;
  const opts = eventChoices(world, you);
  if (!opts || you.pos.kind !== 'room') return null;
  const def = EVENTS[opts.kind];
  const ev = world.events[you.pos.room];
  const h = ev?.by ? world.heroes[ev.by] : undefined;
  const ch = h?.channel;
  const worker = h && ch?.kind === 'event'
    ? {
        id: h.id, name: h.name, you: h === you, doing: choiceVerb(ev.kind, ch.choice),
        secondsLeft: channelTime(ev.kind, h.cls) * (1 - ev.progress),
      }
    : null;
  return {
    kind: opts.kind, name: def.name, glyph: def.glyph, text: def.text, choices: opts.choices,
    progress: opts.progress, worker, blocked: opts.choices.length === 0,
  };
}

function resultsView(world: World): ResultsView {
  return {
    heroes: Object.values(world.heroes).map((h) => ({
      id: h.id, name: h.name, cls: h.cls, color: h.color, isBot: h.isBot,
      outcome: h.extracted ? 'escaped' : 'dead',
      fate: h.fate ?? 'was lost',
      gold: h.extracted ? h.gold : 0,
      time: h.extracted ? h.extractedAt : h.diedAt,
    })),
    chronicle: world.chronicle,
  };
}

function lootView(world: World, you: Hero): LootView | null {
  if (you.pos.kind !== 'room') return null;
  const room = you.pos.room;
  const pile = world.piles[room];
  if (!pile) return null;
  const voters = votersIn(world, room);
  const present = Object.values(world.heroes).filter((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room);
  return {
    room,
    gold: pile.gold,
    queued: [...pile.items],
    abandoned: [...pile.abandoned],
    vote: pile.vote && {
      item: pile.vote.item,
      votes: { ...pile.vote.votes },
      voters: voters.map((v) => v.id),
      candidates: present.filter(hasSpace).map((h) => ({ id: h.id, name: h.name, free: INVENTORY_SLOTS - h.items.length, isBot: h.isBot })),
      startedAt: pile.vote.startedAt,
    },
  };
}


function encounterView(world: World, you: Hero): EncounterView | null {
  if (you.encounter === null) return null;
  const enc = world.encounters[you.encounter];
  if (!enc) return null;
  const heroUnit = (id: string, joining: boolean): CombatUnitView => {
    const h = world.heroes[id];
    return {
      id, kind: 'hero', name: h.name, hp: h.hp, maxHp: h.maxHp, rank: heroRank(h), st: { ...h.st }, cls: h.cls, color: h.color,
      downed: h.downedAt !== null,
      bleedOut: h.downedAt !== null ? Math.max(0, BLEED_OUT - (world.time - h.downedAt)) : undefined,
      joining, ready: !!enc.choices[id] || !isConscious(h),
    };
  };
  return {
    room: enc.room,
    round: enc.round,
    phase: enc.phase,
    timeLeft: Math.max(0, (enc.phase === 'choosing' ? enc.deadline : enc.resolveUntil) - world.time),
    heroes: [...enc.heroes.map((id) => heroUnit(id, false)), ...enc.joining.map((id) => heroUnit(id, true))],
    monsters: monstersIn(world, enc.room).map((m) => ({
      id: m.id, kind: 'monster', name: ENEMIES[m.type].name, hp: m.hp, maxHp: m.maxHp, rank: m.rank, st: { ...m.st }, enemy: m.type,
    })),
    yourChoice: enc.choices[you.id] ?? null,
    youJoining: enc.joining.includes(you.id),
    events: enc.events,
    log: enc.log.slice(-12),
  };
}

function posRooms(pos: HeroPos): number[] {
  return pos.kind === 'room' ? [pos.room] : [pos.from, pos.to];
}
