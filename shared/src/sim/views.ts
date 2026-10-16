import { CARDS, type CardId } from '../content/cards';
import { cardTime, corpses, uselessReason } from './cards';
import { emergencyProgress, type EmergencyProgress } from './emergency';
import { COLLAPSE_AT, LIGHT_DIM, WAVES_AT, escalationAt } from '../content/constants';
import type { Corridor, RoomKind } from '../dungeon/gen';
import type { ClassId } from '../content/classes';
import { ENEMIES, type EnemyId, type Roster } from '../content/enemies';
import { CLASS_RULES } from '../content/innates';
import type { TalentId } from '../content/talents';
import type { ShardId } from '../content/regalia';
import { ITEMS, packFree, slotOf, type ItemId } from '../content/items';
import { EVENTS, type EventKind } from '../content/events';
import { choiceVerb, eventChoices, eventTime, veiledText, type EventChoice } from './events';
import type { ItemCharge } from './gear';
import { activeItems, canTake, decidersOf, goldFor, pileGold, votersIn } from './loot';
import {
  DEATH_TIMER, canSneakPast, combatOrder, doomOf, handOf, inDungeon, isConscious, monsterSpeed, risenName, risenOf, risenSpeed, validTargets, type ChronicleEntry, type Choice, type CombatEvent, type Encounter, type Statuses,
} from './combat';
import { CALL_RULES } from './call';
import { speedOf } from './speed';
import { fightTimeline, type TimelineUnit } from './timeline';
import { canPause, headingOf, knowsCorridor, soloOut, type Hero, type Sighting, type RoomSighting, type HeroPos, type World, type WorldPhase } from './world';

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
  /** Explored, but you've forgotten some of its paths (sim/mind.ts): going back brings them back. */
  hazy?: true;
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
  /** Loose gold lying here (it splits itself among whoever has room). */
  gold: number;
  /** Of that, what you could take a share of: 0 if your pack is full or you put it all down yourself. */
  yourGold: number;
  /** Hero ids that must agree on who gets what. */
  voters: string[];
  /** Up for grabs, side by side, each with its own vote (at most LOOT.maxDrops of them, as a rule). */
  items: LootItemView[];
  /** Lying here, but nobody present wants it (walked past it, no better than theirs, no room): claim to bring it back. */
  ignored: { id: number; item: ItemId }[];
  /** Shards of a Boss's regalia lying here: each goes by itself to a hero who may carry it. */
  shards: ShardId[];
}

export interface LootItemView {
  /** Floor item id: what a vote names. */
  id: number;
  item: ItemId;
  votes: Record<string, string>;
  /** Who has a say on it: the voters here who haven't left it. All of them must agree. */
  voters: string[];
  /** Hero ids who can receive it (present, still in on it, have a free slot; anyone for gear, which swaps). */
  candidates: { id: string; name: string; free: number; isBot: boolean; /** Gear: what they wear in that slot now. */ wearing?: ItemId | null }[];
  startedAt: number;
  /** Cloth that has been worn before: its charge (cooldown left, uses left). */
  charge?: ItemCharge;
}

/** A monster group walking a tunnel from one room to the next (only shown on a revealed map). */
export interface PackView {
  from: number;
  to: number;
  /** Seconds since it set off, of `dur`. */
  t: number;
  dur: number;
  monsters: EnemyId[];
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
  /** Only while you can see them. */
  light?: number;
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
  talents: TalentId[];
  outcome: 'escaped' | 'dead';
  fate: string;
  gold: number;
  time: number | null;
}

export interface ResultsView {
  heroes: ResultHero[];
  chronicle: ChronicleEntry[];
}

export type CorridorView = Corridor & { collapsed?: boolean };

export interface CombatUnitView {
  id: string;
  /** risen: a slain monster (or a fallen ally) the Undertaker raised, fighting on the heroes' side. */
  kind: 'hero' | 'monster' | 'risen';
  name: string;
  hp: number;
  maxHp: number;
  st: Statuses;
  /** Heroes only. */
  light?: number;
  /** A Sorceress's Anima (M16). */
  anima?: number;
  /** The risen: own turns left (none for the Uprising's dead, who never crumble). */
  turnsLeft?: number;
  /** The Undertaker's following (M16): how decayed it is (+2s Speed and −2 Block a stack). */
  decay?: number;
  cls?: ClassId;
  color?: string;
  enemy?: EnemyId;
  /** A straggler's pick-up: it drops when the straggler falls. */
  carry?: ItemId;
  downed?: boolean;
  /** Seconds until a downed hero dies. */
  dying?: number;
  /** The length of this unit's current wait (a monster's Speed; for a hero, what their last card or action took). */
  speed: number;
  /** Seconds until this unit's next turn (null while down). */
  nextIn: number | null;
  /** Has picked what to do on their next turn (heroes only). */
  ready?: boolean;
  /** What they've picked for their next turn, visible to everyone in the fight: "Backstab", "Flee"… */
  choice?: string;
  /** Who that choice is aimed at (a unit id), if anyone. */
  choiceTarget?: string;
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
  /** Your hand, left to right (the leftmost non-Burn card is what you play if your turn comes first). */
  yourHand: CardView[];
  /** How many cards are left to draw, and in the discard (they're shuffled back when the draw pile runs out). */
  deckCount: number;
  discardCount: number;
  /** Cards you've burned this run (gone until the run ends, or a Loom). */
  burned: CardId[];
  /** Downed allies here you could Revive. */
  reviveTargets: string[];
  /** Your Flee is a Sneak Past right now (Sneaking, alone, first turn or a Smoke Bomb's charge). */
  sneakPast: boolean;
  /** No monster acts until you do: an Ambush (you walked in Sneaking). */
  ambush: boolean;
  /** Corpses lying in this fight (the Undertaker's cards use them up). */
  corpses: number;
  /** Recent events, each with a `seq` that grows through the fight. */
  events: CombatEvent[];
  log: string[];
  /** Lich's Doom: you take this much more from everything (your stacks × CR_RULES.doom). */
  doom: number;
  /** The next turns in order, as they'll come if every hero does what they've picked (see `fightTimeline`). */
  timeline: TimelineTurnView[];
}

/** One upcoming turn on the fight's timeline. */
export interface TimelineTurnView {
  id: string;
  /** Which of that unit's turns in the fight: with `id`, names this turn as the strip shifts. */
  n: number;
  /** Seconds from now. */
  in: number;
  /** A hero's move, when it's theirs to show (see `timelineView`): what it is, its name, who it's aimed at. */
  choice?: Choice;
  label?: string;
  target?: string;
  /** The item, for a Use Item. */
  item?: ItemId;
  /** They haven't picked: it's their default (or, with no move shown, whatever they'll draw). */
  auto?: boolean;
  stunned?: boolean;
  /** Only with some of the dice. */
  maybe?: boolean;
  /** Someone not in the fight yet (summoned, raised): how to draw them. */
  unit?: TimelineUnit;
}

export interface ChalkView {
  room: number;
  marks: { heroId: string; corridor: number }[];
}

export interface PlayerView {
  time: number;
  escalation: number;
  /** When waves start coming for the exit. */
  wavesAt: number;
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
  /** The event in your room, if any. */
  event: EventView | null;
  /** The villagers you're escorting. */
  leading: { hp: number; maxHp: number }[];
  objectives: { altars: number; villagers: number };
  /** The fog has lifted for you: the run is over, or you're out of a bots-only run and asked to see it. */
  mapRevealed: boolean;
  /** Monster groups on the move between rooms, while you watch the revealed map. */
  packs: PackView[];
  /** You're out (escaped or dead) and only bots are left inside: Reveal map and Kill the bots are on offer. */
  soloOut: boolean;
  /** Time stands still (Space). */
  paused: boolean;
  /** You're the only player, with three bots: Space pauses. */
  canPause: boolean;
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
  // Once it's over the fog lifts: every room and tunnel, and what was left in them. A player out of a
  // bots-only run can lift it early (Reveal map).
  const over = world.phase !== 'running' || (you.mapRevealed && soloOut(world, you));
  const corridors: CorridorView[] = d.corridors
    .filter((c) => over || knowsCorridor(you, c))
    .map((c) => ((over ? world.collapsed : you.knownCollapsed).includes(c.id) ? { ...c, collapsed: true } : c));
  // (Secret rooms that never opened stay out of the reveal: there was no way in.)
  const roomIds = new Set<number>(over ? d.rooms.filter((r) => r.corridors.length).map((r) => r.id) : you.seen);
  for (const c of corridors) {
    roomIds.add(c.a);
    roomIds.add(c.b);
  }

  // Revealed mid-run, you watch everyone as they are now; otherwise only as you last saw them.
  const watching = over && world.phase === 'running';
  const sightings: Record<string, Sighting> = watching
    ? Object.fromEntries(Object.values(world.heroes).filter((h) => h !== you).map((h) => [h.id, {
        pos: { ...h.pos }, heading: headingOf(h), time: world.time, hp: h.hp, maxHp: h.maxHp,
        downed: h.downedAt !== null, dead: h.dead, extracted: h.extracted,
      }]))
    : you.lastKnown;
  const allies: AllyView[] = [];
  for (const [id, sighting] of Object.entries(sightings)) {
    const h = world.heroes[id];
    if (!h) continue;
    const live = sighting.time === world.time;
    allies.push({
      id, name: h.name, cls: h.cls, color: h.color, isBot: h.isBot, live, pos: { ...sighting.pos }, heading: null, seenAt: sighting.time,
      hp: sighting.hp, maxHp: sighting.maxHp, downed: sighting.downed, dead: sighting.dead, extracted: !!sighting.extracted,
      light: live && inDungeon(h) ? Math.round(h.light) : undefined,
      ready: live && inDungeon(h) ? h.ready : undefined,
      turn: live && inDungeon(h) && isConscious(h) && h.encounter === null && !h.channel && h.pos.kind === 'room'
        ? { start: h.turnStart, at: h.turnAt } : undefined,
    });
    // Make sure the client can place them, even in a room you only know the position of.
    for (const r of posRooms(sighting.pos)) roomIds.add(r);
  }
  // Where allies are going: their chosen room if you know where that is, otherwise at least their next step.
  for (const a of allies) {
    const s = sightings[a.id];
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
    marks: Object.entries(marks).flatMap(([heroId, cs]) => cs.map((corridor) => ({ heroId, corridor }))),
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
      hazy: !over && knowledge === 'explored' && r.corridors.some((cid) => you.forgotten.includes(cid)) || undefined,
      threat: reveal ? reveal.monsters.length || undefined : you.knownThreat[id],
      loot: reveal ? reveal.items.length + (reveal.gold > 0 ? 1 : 0) || undefined : you.knownLoot[id],
      event: reveal ? reveal.event ?? (reveal.captive ? 'villager' : undefined) : you.knownEvents[id],
      memory: reveal ? undefined : you.knownContents[id],
      reveal,
    };
  });
  return {
    time: world.time,
    escalation: escalationAt(world.time),
    wavesAt: WAVES_AT,
    collapseAt: COLLAPSE_AT,
    phase: world.phase,
    width: d.width,
    height: d.height,
    // Your own draw pile stays face down: the hand comes in the fight view instead.
    you: structuredClone({ ...you, deck: null }) as Hero,
    dim: you.light < LIGHT_DIM,
    rooms,
    corridors,
    allies,
    chalk,
    /** Corridors an ally was seen in that you don't otherwise know; position only. */
    ghostCorridors: extraCorridors,
    encounter: encounterView(world, you),
    loot: you.extracted ? null : lootView(world, you),
    mapRevealed: over,
    packs: watching ? movingPacks(world) : [],
    soloOut: world.phase === 'running' && soloOut(world, you),
    paused: world.paused,
    canPause: canPause(world, you),
    exitRoom: d.exit,
    event: eventView(world, you),
    leading: you.leading.map((id) => ({ hp: world.villagers[id].hp, maxHp: world.villagers[id].maxHp })),
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
  // Another class's Elite Event: its true name, but only a hint at whose it is.
  const name = opts.forCls && ev ? EVENTS[ev.kind].name : def.name;
  const text = opts.forCls ? veiledText(opts.forCls) : def.text;
  const h = ev?.by ? world.heroes[ev.by] : undefined;
  const ch = h?.channel;
  const worker = h && ch?.kind === 'event'
    ? {
        id: h.id, name: h.name, you: h === you, doing: choiceVerb(ev.kind, ch.choice),
        // Luminous Liturgy has no end: null.
        secondsLeft: finiteOrNull(eventTime(world, h, ev.kind) * (1 - ev.progress)),
      }
    : null;
  // Twin Locks: one hero waiting on a wheel is an open invitation; two are turning it together.
  if (worker && ev?.kind === 'locks' && ch?.kind === 'event' && ch.choice === 'wheel') {
    const other = ev.with ? world.heroes[ev.with] : undefined;
    worker.doing = other ? `turning the wheels with ${other === you ? 'you' : other.name}` : 'holding one wheel, waiting for a second pair of hands';
    if (!other) worker.secondsLeft = null;
  }
  return {
    kind: opts.kind, name, glyph: def.glyph, text, choices: opts.choices,
    progress: ev?.kind === 'liturgy' ? undefined : opts.progress, worker, blocked: opts.choices.length === 0 && !opts.forCls,
  };
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

function revealRoom(world: World, room: number): RoomReveal {
  const pile = world.piles[room];
  const ev = world.events[room];
  return {
    monsters: Object.values(world.monsters).filter((m) => m.room === room).map((m) => m.type),
    items: pile ? pile.items.map((f) => f.item) : [],
    gold: pileGold(pile),
    event: ev && !ev.done ? ev.kind : undefined,
    captive: Object.values(world.villagers).some((v) => v.room === room && (v.state === 'captive' || v.state === 'waiting')) || undefined,
  };
}

function resultsView(world: World): ResultsView {
  return {
    heroes: Object.values(world.heroes).map((h) => ({
      id: h.id, name: h.name, cls: h.cls, color: h.color, isBot: h.isBot, talents: h.talents,
      outcome: h.extracted ? 'escaped' : 'dead',
      fate: (h.fate ?? 'was lost') + (!h.extracted && h.legacy > 0 ? `; ${h.legacy} of their gold went home${h.rites.includes('tome') ? ' (the Tome Rite)' : ''}` : ''),
      gold: h.extracted ? h.gold : h.legacy,
      time: h.extracted ? h.extractedAt : h.diedAt,
    })),
    chronicle: world.chronicle,
  };
}

function movingPacks(world: World): PackView[] {
  return Object.values(world.packs)
    .filter((p) => p.to !== null)
    .map((p) => ({
      from: p.room, to: p.to!, t: world.time - p.departAt, dur: p.arriveAt - p.departAt,
      monsters: p.monsters.map((id) => world.monsters[id]?.type).filter((m): m is EnemyId => !!m),
    }))
    .filter((p) => p.monsters.length > 0);
}

function lootView(world: World, you: Hero): LootView | null {
  if (you.pos.kind !== 'room') return null;
  const room = you.pos.room;
  const pile = world.piles[room];
  if (!pile) return null;
  const voters = votersIn(world, room);
  const present = Object.values(world.heroes).filter((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room);
  // Items you left (or walked past) lie with the passed-over ones for you, even while the others settle them.
  const active = activeItems(world, room, voters).filter((f) => !voters.includes(you) || decidersOf(f, [you]).length);
  return {
    room,
    gold: pileGold(pile),
    yourGold: goldFor(you, pile),
    voters: voters.map((v) => v.id),
    items: active.map((f) => {
      const slot = slotOf(f.item);
      return {
        id: f.id,
        item: f.item,
        votes: { ...f.votes },
        voters: decidersOf(f, voters).map((v) => v.id),
        candidates: present.filter((h) => canTake(h, f.item) && (h.id === f.claimedBy || !f.passed.includes(h.id))).map((h) => ({
          id: h.id, name: h.name, free: packFree(h.items, h.gold), isBot: h.isBot,
          wearing: slot ? h[slot] : undefined,
        })),
        startedAt: f.startedAt,
        ...(f.charge ? { charge: { ...f.charge } } : {}),
      };
    }),
    ignored: pile.items.filter((f) => !active.includes(f)).map((f) => ({ id: f.id, item: f.item })),
    shards: [...(pile.shards ?? [])],
  };
}


/** A card in your hand, as you see it. */
export interface CardView {
  card: CardId;
  /** Seconds until your next action if you play it now (Tempo, Clang, Haste and the like counted). */
  time: number;
  /** Who it can be aimed at now ([] = nobody to pick; a room card is aimed on the map). */
  targets: string[];
  /** Why playing it now would do nothing useful (it still can be played). */
  weak?: string;
}

function encounterView(world: World, you: Hero): EncounterView | null {
  if (you.encounter === null) return null;
  const enc = world.encounters[you.encounter];
  if (!enc) return null;
  const nextIn = (id: string) => (enc.next[id] === undefined ? null : Math.max(0, enc.next[id] - world.time));
  const heroUnit = (h: Hero): CombatUnitView => {
    const id = h.id;
    return {
      id, kind: 'hero', name: h.name, hp: h.hp, maxHp: h.maxHp, st: { ...h.st }, light: Math.round(h.light), cls: h.cls, color: h.color,
      ...(h.anima > 0 ? { anima: h.anima } : {}),
      downed: h.downedAt !== null,
      dying: h.downedAt !== null ? Math.max(0, DEATH_TIMER - (world.time - h.downedAt)) : undefined,
      speed: enc.span?.[id] ?? speedOf(h, world.time), nextIn: isConscious(h) ? nextIn(id) : null,
      ready: !!enc.choices[id] || !isConscious(h),
      choice: enc.choices[id] ? choiceLabel(h, enc.choices[id]) : undefined,
      choiceTarget: enc.choices[id]?.target,
    };
  };
  const order = combatOrder(world, enc);
  const risen = risenOf(enc);
  const risenUnit: CombatUnitView | null = risen
    ? {
        id: risen.id, kind: 'risen', name: risenName(world, risen), hp: risen.hp, maxHp: risen.maxHp, st: { ...(risen.st ?? {}) }, enemy: risen.type,
        speed: risenSpeed(world, risen), nextIn: nextIn(risen.id), turnsLeft: risen.turns,
      }
    : null;
  const legion: CombatUnitView[] = (enc.legion ?? []).filter((r) => r.hp > 0).map((r) => {
    // A Risen ally shows as its hero (class sprite), with its own statuses (Clang, Vengeance…).
    const ally = r.hero ? world.heroes[r.hero] : undefined;
    return {
      id: r.id, kind: 'risen', name: risenName(world, r), hp: r.hp, maxHp: r.maxHp, st: ally ? { ...ally.st } : { ...(r.st ?? {}) }, enemy: r.type,
      cls: ally?.cls, color: ally?.color, speed: risenSpeed(world, r), nextIn: nextIn(r.id),
      ...(r.decay !== undefined ? { decay: r.decay } : {}),
    };
  });
  const here = isConscious(you) && enc.heroes.includes(you.id);
  const yourHand: CardView[] = here
    ? handOf(you).map((card) => {
        const weak = uselessReason(world, enc, you, card);
        return { card, time: cardTime(world, enc, you, card), targets: validTargets(world, enc, you, { action: 'card', card }), ...(weak ? { weak } : {}) };
      })
    : [];
  return {
    room: enc.room,
    heroes: order.heroes.map(heroUnit),
    risen: risenUnit,
    legion,
    monsters: order.monsters.map((m) => ({
      id: m.id, kind: 'monster', name: ENEMIES[m.type].name, hp: m.hp, maxHp: m.maxHp, st: { ...m.st }, enemy: m.type,
      speed: monsterSpeed(enc, m, world.time), nextIn: nextIn(m.id), ...(m.carry ? { carry: m.carry } : {}),
    })),
    yourChoice: enc.choices[you.id] ?? null,
    yourHand,
    deckCount: you.deck?.draw.length ?? 0,
    discardCount: you.deck?.discard.length ?? 0,
    burned: [...you.burned],
    reviveTargets: here ? validTargets(world, enc, you, { action: 'revive' }) : [],
    sneakPast: here && canSneakPast(world, enc, you),
    ambush: enc.ambush === you.id,
    corpses: corpses(enc),
    events: enc.events,
    log: enc.log.slice(-12),
    doom: doomOf(you),
    timeline: you.isBot ? [] : timelineView(world, enc, you),
  };
}

/**
 * The fight's timeline as you see it. A hero's move shows on their next turn only, and only if they've picked it or
 * it's you: further on it hangs on what they draw, and nobody sees another's hand.
 */
function timelineView(world: World, enc: Encounter, you: Hero): TimelineTurnView[] {
  const shown = new Set<string>();
  return fightTimeline(world, enc).map((t) => {
    const h = t.choice ? world.heroes[t.id] : undefined;
    const first = !!h && !shown.has(t.id);
    if (h) shown.add(t.id);
    const visible = first && t.choice && (!t.auto || t.id === you.id);
    return {
      id: t.id, n: t.n, in: Math.max(0, t.at - world.time),
      ...(h && visible && t.choice ? {
        choice: t.choice, label: choiceLabel(h, t.choice), ...(t.choice.target ? { target: t.choice.target } : {}),
        ...(t.choice.action === 'item' && h.items[t.choice.item ?? -1] ? { item: h.items[t.choice.item!] } : {}),
      } : {}),
      ...(t.auto ? { auto: true } : {}), ...(t.stunned ? { stunned: true } : {}), ...(t.maybe ? { maybe: true } : {}), ...(t.unit ? { unit: t.unit } : {}),
    };
  });
}

function choiceLabel(h: Hero, c: Choice): string {
  if (c.action === 'item') return ITEMS[h.items[c.item ?? -1]]?.name ?? 'Item';
  if (c.action === 'card') return c.card ? CARDS[c.card].name : 'Card';
  return { revive: 'Revive', flee: 'Flee', brace: 'Brace' }[c.action as 'revive' | 'flee' | 'brace'];
}

function posRooms(pos: HeroPos): number[] {
  return pos.kind === 'room' ? [pos.room] : [pos.from, pos.to];
}
