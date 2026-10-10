import { emergencyProgress, type EmergencyProgress } from './emergency';
import { COLLAPSE_AT, EXIT_OPENS_AT, LIGHT_DIM, escalationAt } from '../content/constants';
import type { Corridor, RoomKind } from '../dungeon/gen';
import type { ClassId } from '../content/classes';
import { ENEMIES, type EnemyId, type Roster } from '../content/enemies';
import { CLASS_RULES } from '../content/abilities';
import type { TalentId } from '../content/talents';
import { ITEMS, packFree, slotOf, type ItemId } from '../content/items';
import { channelTime, EVENTS, type AfflictionId, type EventKind } from '../content/events';
import { choiceVerb, eventChoices, veiledText, type EventChoice } from './events';
import { activeItems, canTake, votersIn } from './loot';
import {
  abilitiesOf, abilityOf, BLEED_OUT, combatOrder, inDungeon, isConscious, risenOf, unusableReason, validTargets, type Choice, type CombatAction, type CombatEvent, type Statuses,
} from './combat';
import { CALL_RULES } from './call';
import { speedOf } from './speed';
import { knowsCorridor, type Hero, type RoomSighting, type HeroPos, type World, type WorldPhase } from './world';

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
  /** What you saw here last time you looked, and when (during the run). */
  memory?: RoomSighting;
  /** Only once the expedition is over: what was really here at the end. */
  reveal?: RoomReveal;
}

/** The truth about a room after the run: what was left in it. */
export interface RoomReveal {
  monsters: EnemyId[];
  items: ItemId[];
  gold: number;
  /** An event nobody finished. */
  event?: EventKind;
  /** A captive nobody freed. */
  captive?: boolean;
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
  worker: { id: string; name: string; you: boolean; doing: string; secondsLeft: number | null } | null;
  /** Monsters are here: deal with them first. */
  blocked: boolean;
}

export interface LootView {
  room: number;
  gold: number;
  /** Hero ids that must agree on who gets what. */
  voters: string[];
  /** Up for grabs, side by side, each with its own vote (at most LOOT.maxDrops of them, as a rule). */
  items: LootItemView[];
  /** Lying here, but nobody present wants it (walked past it, no better than theirs, no room): claim to bring it back. */
  ignored: { id: number; item: ItemId }[];
}

export interface LootItemView {
  /** Floor item id: what a vote names. */
  id: number;
  item: ItemId;
  votes: Record<string, string>;
  /** Hero ids who can receive it (present, have a free slot; anyone for gear, which swaps). */
  candidates: { id: string; name: string; free: number; isBot: boolean; /** Gear: what they wear in that slot now. */ wearing?: ItemId | null }[];
  startedAt: number;
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
  /** Only while you can see them. */
  stress?: number;
  /** Their Speed timer (start, end), while you can see them standing free in a room. */
  turn?: { start: number; at: number };
  /** Ready to leave (E), while you can see them. */
  ready?: boolean;
}

export interface ResultHero {
  id: string;
  name: string;
  cls: ClassId;
  color: string;
  isBot: boolean;
  talent: TalentId | null;
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
  /** risen: a slain monster the Undertaker raised, fighting on the heroes' side. */
  kind: 'hero' | 'monster' | 'risen';
  name: string;
  hp: number;
  maxHp: number;
  st: Statuses;
  /** Heroes only. */
  stress?: number;
  /** The risen: own turns left (none for the Uprising's dead, who never crumble). */
  turnsLeft?: number;
  cls?: ClassId;
  color?: string;
  enemy?: EnemyId;
  downed?: boolean;
  /** Seconds until a downed hero dies. */
  bleedOut?: number;
  /** Speed: seconds between this unit's turns. */
  speed: number;
  /** Seconds until this unit's next turn (null while down). */
  nextIn: number | null;
  /** Has picked what to do on their next turn (heroes only). */
  ready?: boolean;
  /** What they've picked for their next turn, visible to everyone in the fight: "Backstab", "Flee"… */
  choice?: string;
  /** Who that choice is aimed at (a unit id), if anyone. */
  choiceTarget?: string;
  affliction?: AfflictionId | null;
}

export interface EncounterView {
  room: number;
  /** Left to right as the fight screen shows them (also the order ties are broken in). */
  heroes: CombatUnitView[];
  /** The Undertaker's risen, shown right of the heroes (nearest the enemy). */
  risen: CombatUnitView | null;
  /** Unholy Uprising: the Undertaker's lasting dead, between the heroes and the risen. */
  legion: CombatUnitView[];
  monsters: CombatUnitView[];
  yourChoice: Choice | null;
  /** For each of your abilities ('a0'…): who it can be aimed at now ([] = no target needed), or why it can't be used. */
  yourOptions: Partial<Record<CombatAction, { targets: string[]; blocked: string | null }>>;
  /** Recent events, each with a `seq` that grows through the fight. */
  events: CombatEvent[];
  log: string[];
  /** Lich's Doom: you all take this much more from everything in this fight. */
  doom: number;
}

export interface ChalkView {
  room: number;
  marks: { heroId: string; corridor: number }[];
}

export interface PlayerView {
  time: number;
  escalation: number;
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
  /** Bells heard in the last few seconds: where, who, and how long ago. */
  tolls: { room: number; by: string; ago: number }[];
  /** Calls for help you made or heard in the last minute: where, who, and how long ago. */
  calls: { room: number; by: string; ago: number }[];
  /** Challenge Rating of this run (heroes with a Talent). */
  cr: number;
  /** The monsters this run uses. */
  roster: Roster;
  /** Your Village's Emergency and how far along it is (players only). */
  emergency: EmergencyProgress | null;
}

/**
 * Fog-filtered snapshot for one hero. Everything the client gets goes through here,
 * so hidden information never leaves the server.
 */
export function buildView(world: World, heroId: string): PlayerView {
  const d = world.dungeon;
  const you = world.heroes[heroId];
  // Once it's over the fog lifts: every room and tunnel, and what was left in them.
  const over = world.phase !== 'running';
  const corridors: CorridorView[] = d.corridors
    .filter((c) => over || knowsCorridor(you, c))
    .map((c) => ((over ? world.collapsed : you.knownCollapsed).includes(c.id) ? { ...c, collapsed: true } : c));
  // (Secret rooms that never opened stay out of the reveal: there was no way in.)
  const roomIds = new Set<number>(over ? d.rooms.filter((r) => r.corridors.length).map((r) => r.id) : you.seen);
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
      stress: live && inDungeon(h) ? Math.round(h.stress) : undefined,
      ready: live && inDungeon(h) ? h.ready : undefined,
      turn: live && inDungeon(h) && isConscious(h) && h.encounter === null && !h.channel && h.pos.kind === 'room'
        ? { start: h.turnStart, at: h.turnAt } : undefined,
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
    const knowledge: RoomKnowledge = over || you.explored.includes(id) ? 'explored' : you.seen.includes(id) ? 'seen' : 'unknown';
    const reveal = over ? revealRoom(world, id) : undefined;
    return {
      id,
      x: r.x,
      y: r.y,
      knowledge,
      name: knowledge === 'unknown' ? undefined : r.name,
      kind: knowledge === 'unknown' ? undefined : r.kind,
      corridors: r.corridors.filter((cid) => over || knowsCorridor(you, d.corridors[cid])),
      threat: reveal ? reveal.monsters.length || undefined : you.knownThreat[id],
      loot: reveal ? reveal.items.length + (reveal.gold > 0 ? 1 : 0) || undefined : you.knownLoot[id],
      event: reveal ? reveal.event ?? (reveal.captive ? 'villager' : undefined) : veil(you, you.knownEvents[id]),
      memory: reveal ? undefined : sighting(you, you.knownContents[id]),
      reveal,
    };
  });
  return {
    time: world.time,
    escalation: escalationAt(world.time),
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
    tolls: world.tolls
      .filter((t) => world.time - t.time <= CLASS_RULES.tollReveal)
      .map((t) => ({ room: t.room, by: t.by, ago: world.time - t.time })),
    calls: world.calls
      .filter((c) => world.time - c.time <= CALL_RULES.shown && (c.by === heroId || c.heard.includes(heroId)))
      .map((c) => ({ room: c.room, by: c.by, ago: world.time - c.time })),
    cr: world.cr,
    roster: world.roster,
    emergency: emergencyProgress(world, you),
  };
}

function eventView(world: World, you: Hero): EventView | null {
  if (you.encounter !== null || !inDungeon(you)) return null;
  const opts = eventChoices(world, you);
  if (!opts || you.pos.kind !== 'room') return null;
  const def = EVENTS[opts.kind];
  const ev = world.events[you.pos.room];
  // Another class's Elite Event: just a hint at whose it is.
  const text = opts.forCls ? veiledText(opts.forCls) : def.text;
  const h = ev?.by ? world.heroes[ev.by] : undefined;
  const ch = h?.channel;
  const worker = h && ch?.kind === 'event'
    ? {
        id: h.id, name: h.name, you: h === you, doing: choiceVerb(ev.kind, ch.choice),
        // Luminous Liturgy has no end: null.
        secondsLeft: finiteOrNull(channelTime(ev.kind, speedOf(h, world.time)) * (1 - ev.progress)),
      }
    : null;
  return {
    kind: opts.kind, name: def.name, glyph: def.glyph, text, choices: opts.choices,
    progress: ev?.kind === 'liturgy' ? undefined : opts.progress, worker, blocked: opts.choices.length === 0 && !opts.forCls,
  };
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Another class's Elite Event shows on your map as something strange, not as what it is. */
function veil(you: Hero, kind: EventKind | undefined): EventKind | undefined {
  const elite = kind && EVENTS[kind].elite;
  return elite && elite !== you.cls ? 'veiled' : kind;
}

function sighting(you: Hero, s: RoomSighting | undefined): RoomSighting | undefined {
  return s && { ...s, event: veil(you, s.event) };
}

function revealRoom(world: World, room: number): RoomReveal {
  const pile = world.piles[room];
  const ev = world.events[room];
  return {
    monsters: Object.values(world.monsters).filter((m) => m.room === room).map((m) => m.type),
    items: pile ? pile.items.map((f) => f.item) : [],
    gold: pile?.gold ?? 0,
    event: ev && !ev.done ? ev.kind : undefined,
    captive: Object.values(world.villagers).some((v) => v.room === room && (v.state === 'captive' || v.state === 'waiting')) || undefined,
  };
}

function resultsView(world: World): ResultsView {
  return {
    heroes: Object.values(world.heroes).map((h) => ({
      id: h.id, name: h.name, cls: h.cls, color: h.color, isBot: h.isBot, talent: h.talent,
      outcome: h.extracted ? 'escaped' : 'dead',
      fate: (h.fate ?? 'was lost') + (!h.extracted && h.legacy > 0 ? `; ${h.rites.includes('tome') ? 'the Tome Rite' : 'the Undertaker'} carried ${h.legacy} of their gold home` : ''),
      gold: h.extracted ? h.gold : h.legacy,
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
  const active = activeItems(world, room, voters);
  return {
    room,
    gold: pile.gold,
    voters: voters.map((v) => v.id),
    items: active.map((f) => {
      const slot = slotOf(f.item);
      return {
        id: f.id,
        item: f.item,
        votes: { ...f.votes },
        candidates: present.filter((h) => canTake(h, f.item)).map((h) => ({
          id: h.id, name: h.name, free: packFree(h.items), isBot: h.isBot,
          wearing: slot ? h[slot] : undefined,
        })),
        startedAt: f.startedAt,
      };
    }),
    ignored: pile.items.filter((f) => !active.includes(f)).map((f) => ({ id: f.id, item: f.item })),
  };
}


function encounterView(world: World, you: Hero): EncounterView | null {
  if (you.encounter === null) return null;
  const enc = world.encounters[you.encounter];
  if (!enc) return null;
  const nextIn = (id: string) => (enc.next[id] === undefined ? null : Math.max(0, enc.next[id] - world.time));
  const heroUnit = (h: Hero): CombatUnitView => {
    const id = h.id;
    return {
      id, kind: 'hero', name: h.name, hp: h.hp, maxHp: h.maxHp, st: { ...h.st }, stress: Math.round(h.stress), cls: h.cls, color: h.color,
      downed: h.downedAt !== null,
      bleedOut: h.downedAt !== null ? Math.max(0, BLEED_OUT - (world.time - h.downedAt)) : undefined,
      speed: speedOf(h, world.time), nextIn: isConscious(h) ? nextIn(id) : null,
      ready: !!enc.choices[id] || !isConscious(h),
      choice: enc.choices[id] ? choiceLabel(h, enc.choices[id]) : undefined,
      choiceTarget: enc.choices[id]?.target,
      affliction: h.affliction,
    };
  };
  const order = combatOrder(world, enc);
  const risen = risenOf(enc);
  const risenUnit: CombatUnitView | null = risen
    ? {
        id: risen.id, kind: 'risen', name: `Risen ${ENEMIES[risen.type].name}`, hp: risen.hp, maxHp: risen.maxHp, st: {}, enemy: risen.type,
        speed: ENEMIES[risen.type].speed, nextIn: nextIn(risen.id), turnsLeft: risen.turns,
      }
    : null;
  const legion: CombatUnitView[] = (enc.legion ?? []).filter((r) => r.hp > 0).map((r) => ({
    id: r.id, kind: 'risen', name: `Risen ${ENEMIES[r.type].name}`, hp: r.hp, maxHp: r.maxHp, st: {}, enemy: r.type,
    speed: ENEMIES[r.type].speed, nextIn: nextIn(r.id),
  }));
  const yourOptions: EncounterView['yourOptions'] = {};
  if (isConscious(you) && enc.heroes.includes(you.id)) {
    abilitiesOf(you).forEach((ab, i) => {
      const action = `a${i}` as CombatAction;
      yourOptions[action] = { targets: validTargets(world, enc, you, action), blocked: unusableReason(world, enc, you, ab) };
    });
  }
  return {
    room: enc.room,
    heroes: order.heroes.map(heroUnit),
    risen: risenUnit,
    legion,
    monsters: order.monsters.map((m) => ({
      id: m.id, kind: 'monster', name: ENEMIES[m.type].name, hp: m.hp, maxHp: m.maxHp, st: { ...m.st }, enemy: m.type,
      speed: ENEMIES[m.type].speed, nextIn: nextIn(m.id),
    })),
    yourChoice: enc.choices[you.id] ?? null,
    yourOptions,
    events: enc.events,
    log: enc.log.slice(-12),
    doom: enc.doom ?? 0,
  };
}

function choiceLabel(h: Hero, c: Choice): string {
  if (c.action === 'item') return ITEMS[h.items[c.item ?? -1]]?.name ?? 'Item';
  const ab = abilityOf(h, c.action);
  if (ab) return ab.name;
  return { revive: 'Revive', flee: 'Flee', brace: 'Brace' }[c.action as 'revive' | 'flee' | 'brace'];
}

function posRooms(pos: HeroPos): number[] {
  return pos.kind === 'room' ? [pos.room] : [pos.from, pos.to];
}
