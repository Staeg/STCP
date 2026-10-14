import { CLASSES, SPARE_COLORS, type ClassId } from '../content/classes';
import { COLLAPSE_AT, LIGHT_DIM, LIGHT_DRAIN, LIGHT_MAX, ESCALATION_INTERVAL, MAX_ESCALATION, WAVES_AT, escalationAt } from '../content/constants';
import { CR_RULES, ESCALATION, rollRoster, type EnemyId, type Roster } from '../content/enemies';
import type { EmergencyId } from '../content/emergencies';
import { forceRoster, seedEmergencies } from './emergency';
import type { TalentId } from '../content/talents';
import type { ShardId } from '../content/regalia';
import { injuredMaxHp, KIT_RULES, RITES, sightMatches, VILLAGE_RULES, type Injury, type Loadout, type Sight } from '../village';
import { GEAR_KIND_PLURALS } from '../content/forge';
import { CLASS_RULES } from '../content/innates';
import { callForHelp, type Call } from './call';
import { clearRubble, stragglerEvery, tickEscalation, type Pack } from './escalation';
import { chooseEvent, leaveStranger, seedEliteEvent, spawnEvents, tickEvents, villagerHere, type RoomEvent, type Villager } from './events';
import { EVENT_SEEDING, type EliteEventKind, type EventKind } from '../content/events';
import { relearnPaths, tickForgetting } from './mind';
import { corridorBetween, generateDungeon, neighbours, otherEnd, theRoom, type Corridor, type Dungeon } from '../dungeon/gen';
import { Rng } from '../rng';
import {
  dieOut, closeFights, inDungeon, MAJOR_INJURY_LABEL, riteMult, syncInjuries, isConscious, monstersIn, onHeroInRoom, REVIVE_CHANNEL, reviveHero, spawnInitialMonsters, stepToEnd, submitChoice, tickCombat, tickRisings, fieldTurn, fieldTurnEnd, fieldTurnStart, tickDowned, tickFieldTurns, tickClocks,
  type Choice, type Encounter, type Monster, type Risen, type Rising, type Statuses,
} from './combat';
import type { GearSlot, ItemId, ResourceId } from '../content/items';
import type { CardId } from '../content/cards';
import type { Deck } from './deck';
import { CLOTH, GEAR_SLOTS, ISSUED_KIT, ITEMS, pluralName, slotOf } from '../content/items';
import { emptyCodex, TWIST_IDS, TWISTS, type Codex } from '../content/codex';
import { notify, type SoundCue } from './notify';
import { clothReady, leftRoom, spendCloth, tickCharges, toggleAuto, type ItemCharge } from './gear';
import { fmtSpeed, speedOf, type SpeedMod } from './speed';
import { checkSkill, fieldSkillsOf, hearsToll, tickBrew, useSkill, type FieldSkill } from './skills';
import {
  activeItems, castVote, claimItem, equipFromPack, giveItem, wants, dropGold, dropItem, goldFor, pileGold, risenAllyEscapes, fieldItemError, unequip, seesInDark, spawnInitialLoot, tickLoot, tomeLegacy, useItemInField, wornMult, wornStat, type Pile,
} from './loot';

export type HeroPos =
  | { kind: 'room'; room: number }
  /** `t` = seconds walked from `from` toward `to`; `dur` = seconds this crossing takes (the hero's Speed when they set out). */
  /** `chalked`: setting out left a fresh chalk mark, rubbed out again if the hero turns back. */
  | { kind: 'corridor'; corridor: number; from: number; to: number; t: number; dur: number; chalked?: boolean };

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
  /** Chalk marks this hero has read, per room: heroId → corridor ids they left by. */
  knownChalk: Record<number, Record<string, number[]>>;
  /** Monster count per room, as of when this hero last saw it. */
  knownThreat: Record<number, number>;
  /** What this hero last saw in each room (for the map's hover box). */
  knownContents: Record<number, RoomSighting>;

  hp: number;
  maxHp: number;
  st: Statuses;
  /** The cards in play while in a fight (M15): dealt when they join one, gathered up when they leave it. */
  deck: Deck | null;
  /** Cards burned this run: out of the deck until the run ends (or a Loom). One entry per copy. */
  burned: CardId[];
  /** Cards in the deck for this run only, on top of class and Gear cards (the Elder's Oil, from the Elder's Bless). */
  bonusCards: CardId[];
  /** The last card played (in any fight this run) that Echo can repeat. */
  lastCard: CardId | null;
  /** The free Issued Gear this hero started with, by slot (it never goes home). */
  issued: Partial<Record<GearSlot, ItemId>>;
  /** Seconds channelling since statuses last ticked as a field turn would. */
  statusClock: number;
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
    | { kind: 'event'; room: number; choice: string; until: number; /** Hastening Robe: done in CLOTH.hastenSecs. */ hasten?: boolean }
    | null;
  /** Paths (corridor ids) this hero has forgotten: unknown again until they stand at either end. */
  forgotten: number[];
  /** Paths in sight as of the last tick (the ones that drop out of it may be forgotten). */
  inSight: number[];

  /** Ids of the villagers following this hero. */
  leading: string[];
  /** Events this hero has seen, by room (for map icons). */
  knownEvents: Record<number, EventKind>;
  /** An out-of-combat skill, picked and waiting for the timer to run out (like an event choice). */
  queuedSkill: { skill: FieldSkill; target: string | null; room?: number } | null;
  /** A consumable used out of a fight: it takes effect when the timer runs out, and is that turn's action. */
  queuedItem: { item: ItemId; index: number; target: string | null } | null;
  /** Undertaker: extra Spade damage, earned by Last Rites kills this run. */
  spadeBonus: number;
  /** Elixir: this hero's next item has double effect. */
  elixir: boolean;
  /** Alchemist: when the next brew is done. */
  brewAt: number;
  /** Dead heroes: gold that went home anyway (an Undertaker walked them out Risen, or the Tome Rite). */
  legacy: number;
  /** Dead heroes: an Undertaker has Raised them (only ever once; after that their things are anyone's). */
  raised: boolean;
  /** Things that go home whatever happens to this hero: they were walked out Risen, or the Tome Rite kept them (consumables). */
  legacyItems: ItemId[];
  /** A player's hero (not a bot when the run began): Exodus needs every one of them out. */
  player: boolean;
  /** The Emergency this hero's player has (players only). */
  emergency: EmergencyId | null;
  items: ItemId[];
  /** Temporary or run-long changes to Speed from events (see speed.ts). */
  speedMods: SpeedMod[];
  /** Equipped gear (separate from the pack). */
  weapon: ItemId | null;
  armor: ItemId | null;
  amulet: ItemId | null;
  ring: ItemId | null;
  /** Worn pieces that go off by themselves (Cloth): each one's own charge, by slot. */
  charges: Partial<Record<GearSlot, ItemCharge>>;
  /** The same for such pieces in the pack (oldest first per kind). */
  packCharges: { item: ItemId; charge: ItemCharge }[];
  /** Softstep Cloak: the room this hero walked into unnoticed (no fight for them there until an ally starts one). */
  unnoticedIn: number | null;
  /** Gravecloth: a downed hero gets back up by themself at this game time. */
  riseAt: number | null;
  /** Carried gold. Only extracted gold counts. */
  gold: number;
  /** Short notices for this player ("+12 gold"), newest last. */
  messages: { time: number; text: string; sound?: SoundCue }[];
  /** Loot count per room as of when this hero last saw it. */
  knownLoot: Record<number, number>;
  /** Collapsed corridors this hero has found out about. */
  knownCollapsed: number[];
  /** Secret passages (corridor ids) this hero has found: by standing at either end after it opened (user, 2026-10-11). */
  knownPassages: number[];
  /** Ready to leave (E): everyone conscious at the open exit ready, and nobody fighting or down there → out together. */
  ready: boolean;
  /** A bot has the wheel for this player (O); unlike `isBot`, nobody else can tell. */
  autopilot: boolean;
  /** Escaped through the exit. */
  extracted: boolean;
  extractedAt: number | null;
  /** How their run ended, for the results screen ("escaped with 84 gold", "died in the Crypt"). */
  fate: string | null;
  /** Most recent time this hero walked into the rendezvous (everyone starts there, so only returns count). */
  arrivedAt: number | null;

  // ---- The Village (M12) ----
  /** The Village Character this hero is (null in the sim and tests). */
  charId: string | null;
  /** The player whose Village it came from. */
  owner: string | null;
  /** Every Talent the Character has (two if Seasoned). */
  talents: TalentId[];
  /** The Shards the player's Village already has; null for bots, who have no Village and can't carry one. */
  villageShards: ShardId[] | null;
  /** The Shard this hero carries (one at most): carried out, it's their Village's. */
  shard: ShardId | null;
  /** A Risen ally walked its Shard out with its Undertaker: it reaches the Village all the same. */
  shardSaved: boolean;
  /** Injuries brought in from the Village (already applied to max HP and Speed). */
  injuries: Injury[];
  /** Village Rites active for this run (Effigy, Tome, Gem, Relic). */
  rites: ResourceId[];
  /** Injuries taken in this run so far (they take effect at once; see syncInjuries). */
  runInjuries: Injury[];
  /** Lowest HP this run, as a fraction of max: what decides injuries. */
  lowestHp: number;
  /** Went down this run: a Major Injury if they escape. */
  downedMajor: boolean;
  /** When this hero last called for help (C), for its cooldown; null if never. */
  calledAt: number | null;
  /** Out of a bots-only run, they asked to see the whole map (see `soloOut`). */
  mapRevealed: boolean;
  /** Bellwright: rang the Toll this run (once a run, until a Loom weaves it back; user, 2026-10-12). */
  tolled: boolean;
  /** Scrying Pool: sees every ally, and the room they're in, until this game time. */
  scryUntil: number;
  /** What this hero has come across this run (items, monsters, events), for their player's Codex in the Village. */
  codex: Codex;
  /** Open Coffin: lay down at this HP, and gets up with at least as much when revived (null: not resting). */
  restHp: number | null;

  // ---- Elite Events (content/events.ts) ----
  /** Lasting effects of the Elite Events this hero carried out (cant: map known · sacrament: Speed 2s · zenith: Fervour doubled · alacrity: consumables quicken). */
  elite: Partial<Record<EliteEventKind, true>>;
  /** Wayward Wanderers: villagers walking with this Warden; saved if they escape. */
  wanderers: number;
  /** Risen that follow this Undertaker into every fight until they fall (HP carries over): the Unholy Uprising's, and fallen allies they Raised. */
  legion: Omit<Risen, 'id' | 'by'>[];
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
}

/** collapsed: the 13:00 deadline hit · wiped: everyone died · ended: everyone left (or died) early */
export type WorldPhase = 'running' | 'collapsed' | 'wiped' | 'ended';

export interface World {
  seed: number;
  time: number;
  dungeon: Dungeon;
  heroes: Record<string, Hero>;
  phase: WorldPhase;
  /** Space, with nobody but bots for company (`canPause`): time stands still and only looking around works. */
  paused: boolean;
  /** Physical chalk marks: room → heroId → every corridor they've left it by. */
  chalk: Record<number, Record<string, number[]>>;
  monsters: Record<string, Monster>;
  /** Active fights, keyed by room. */
  encounters: Record<number, Encounter>;
  rng: Rng;
  /** Forgetting rolls on its own RNG (sim/mind.ts). */
  mindRng: Rng;
  nextId: number;
  /** Loot lying in rooms. */
  piles: Record<number, Pile>;
  /** Points of monster slain per room since it was last cleared; paid out as items when the room is clear. */
  bounty: Record<number, number>;
  /** Current Escalation, 0–6 (see escalation.ts). */
  escalation: number;
  packs: Record<string, Pack>;
  /** Collapsed corridor ids. */
  collapsed: number[];
  /** When each corridor was last dug out (it won't re-collapse for a while). */
  clearedAt: Record<number, number>;
  nextRespawn: number;
  nextWanderer: number;
  nextStraggler: number;
  nextCollapse: number;
  nextWave: number;
  /** The full story of the run, revealed on the results screen. */
  chronicle: import('./combat').ChronicleEntry[];
  escalates: boolean;
  events: Record<number, RoomEvent>;
  villagers: Record<string, Villager>;
  /** Bells tolled (newest last): everyone hears them. */
  tolls: Toll[];
  /** Calls for help (C), oldest first. */
  calls: Call[];
  /** Shared objectives: every hero who escapes gets a bonus per altar/villager. */
  objectives: { altars: number; villagers: number };
  /** Whether heroes joining bring their class's Elite Event with them (off when events are). */
  eliteEvents: boolean;
  /**
   * Challenge Rating, rolled at the start from the heroes' combined CR (Talents, Gear brought in, Rites). More gold,
   * monsters that only come at higher CR, and above CR 4 tougher monsters all round. No cap.
   */
  cr: number;
  /** Which monsters this run uses: each tier's default units and its CR unit (rolled at the start). */
  roster: Roster;
  /** Zombies due to get back up. */
  risings: Rising[];
  /** Monsters slain this run, by kind (a Zombie or a raised monster put down again doesn't count twice). */
  kills: Partial<Record<EnemyId, number>>;
  /** The clock when the run began: 0, or later for a run that starts at a higher Escalation (Relic Rite). */
  startTime: number;
  /** Counters for the results screen and the balance simulator. */
  stats: {
    /** turns: hero turns taken in fights · fightTime: total seconds spent fighting. */
    fights: number; turns: number; fightTime: number; slain: number; downs: number; revives: number; collapses: number; waves: number;
    forgotten: number; eventsUsed: number;
  };
}

export type Intent =
  /** `step`: one tunnel straight to a neighbouring room (WASD), never a detour; ignored if there's no such tunnel. */
  | { type: 'goto'; room: number; step?: boolean }
  | { type: 'turnBack' }
  | { type: 'stop' }
  | { type: 'combat'; choice: Choice }
  /** In a fight: step to the very front (D) or the very back (A) of the heroes' side. Free, any time. */
  | { type: 'stepTo'; to: 'front' | 'back' }
  /** Out of combat: spend a few seconds getting a downed ally in your room back up. */
  | { type: 'revive'; target: string }
  /** Loot vote on one floor item (by its id): a hero id, or 'leave'. */
  | { type: 'vote'; item: number; choice: string }
  /** Bring an ignored floor item back up for grabs (alone: just take it). */
  | { type: 'claim'; item: number }
  | { type: 'drop'; index: number }
  /** Put down one slot of gold (this much, at most GOLD_PER_SLOT): the others here split it. */
  | { type: 'dropGold'; amount: number }
  /** Take off a weapon, armor, amulet or ring and put it on the floor. */
  | { type: 'unequip'; slot: GearSlot }
  /** Turn a worn piece that goes off by itself (Cloth) off or on. */
  | { type: 'toggleAuto'; slot: GearSlot }
  | { type: 'useItem'; index: number; target?: string }
  /** Leave the dungeon through the open exit, on your own, now. */
  | { type: 'extract' }
  /** Ready to leave together (E): toggles, or sets `on`. Works anywhere; it only matters at the open exit. */
  | { type: 'ready'; on?: boolean }
  /** Call for help (C): even while Downed or fighting, with a cooldown. See call.ts. */
  | { type: 'call' }
  /** Hand your hero to a bot, or take them back (O). Handled by Game; the world ignores it. */
  | { type: 'autopilot' }
  /** Stop time, or start it again (Space), in a run with three bots (`canPause`). Handled by Game; the world ignores it. */
  | { type: 'pause' }
  /** Pick an option of the event in your room. */
  | { type: 'event'; choice: string }
  /** Out of a bots-only run (escaped or dead): lift the fog. */
  | { type: 'revealMap' }
  /** Out of a bots-only run (escaped or dead): the bots die where they stand and the run ends. */
  | { type: 'killBots' }
  /** A class skill out of a fight (Toll, or an ability that works in the field): happens when your timer runs out. Default: your first one. */
  | { type: 'skill'; skill?: FieldSkill; target?: string; room?: number };

export interface WorldOptions {
  /** Default true. Tests of pure movement turn monsters off. */
  monsters?: boolean;
  /** Default true. */
  loot?: boolean;
  /** Default true. Turn off for tests that need a static dungeon. */
  escalates?: boolean;
  /** Default: same as `monsters`. */
  events?: boolean;
  /** Challenge Rating (default 0). */
  cr?: number;
  /** Start the run at this Escalation, with the clock already that far along (Relic Rite). Default 0. */
  startEscalation?: number;
  /** The run's monsters (default: rolled from the seed). */
  roster?: Roster;
  /** A Relic Rite is performed: it wakes the Dead King as the run begins, so his event is never in the dungeon. */
  relicRite?: boolean;
  /** The players' Emergencies: the dungeon is seeded so each can be done (M13). */
  emergencies?: EmergencyId[];
}

/** Auto-paths treat each known monster in a room as this many seconds of extra walking. */
export const THREAT_DETOUR = 15;

export function createWorld(seed: number, opts: WorldOptions = {}): World {
  // A run that starts at a higher Escalation starts with the clock that far along: the exit and collapse come as usual.
  const start = Math.max(0, Math.min(MAX_ESCALATION, opts.startEscalation ?? 0)) * ESCALATION_INTERVAL;
  const world: World = {
    seed, time: start, startTime: start, dungeon: generateDungeon(seed), heroes: {}, phase: 'running', paused: false, chalk: {},
    monsters: {}, encounters: {}, rng: new Rng(seed ^ 0x5bd1e995), mindRng: new Rng(seed ^ 0x1b873593), nextId: 1, piles: {}, bounty: {},
    escalation: 0, packs: {}, collapsed: [], clearedAt: {}, chronicle: [], escalates: opts.escalates !== false,
    stats: { fights: 0, turns: 0, fightTime: 0, slain: 0, downs: 0, revives: 0, collapses: 0, waves: 0, forgotten: 0, eventsUsed: 0 },
    events: {}, villagers: {}, objectives: { altars: 0, villagers: 0 }, eliteEvents: false, tolls: [], calls: [], cr: Math.max(0, opts.cr ?? 0),
    roster: opts.roster ?? rollRoster(new Rng(seed ^ 0x3c6ef372)), risings: [], kills: {},
    // Nothing is due the moment a late-starting run begins (the first tick still announces its Escalation).
    nextRespawn: Math.max(ESCALATION_INTERVAL, start + 30), nextWanderer: Math.max(ESCALATION_INTERVAL * 2, start + 30),
    nextStraggler: start + stragglerEvery(escalationAt(start)),
    nextCollapse: Math.max(ESCALATION_INTERVAL * 3, start + 60), nextWave: Math.max(WAVES_AT, start + 45),
  };
  // Quarry: Emergencies' kill targets are default units this run.
  forceRoster(world.roster, opts.emergencies ?? []);
  if (opts.monsters !== false) spawnInitialMonsters(world);
  // Events default to following `monsters` (captives come with guards).
  if (opts.events ?? opts.monsters !== false) {
    spawnEvents(world, !!opts.relicRite);
    world.eliteEvents = true;
  }
  if (opts.loot !== false) spawnInitialLoot(world);
  if (opts.monsters !== false) seedEmergencies(world, opts.emergencies ?? [], !!opts.relicRite);
  return world;
}

/** The class colour, unless another hero already wears it (two of the same class): then a spare one. */
function freeColor(world: World, cls: ClassId): string {
  const used = new Set(Object.values(world.heroes).map((h) => h.color));
  if (!used.has(CLASSES[cls].color)) return CLASSES[cls].color;
  return SPARE_COLORS.find((c) => !used.has(c)) ?? CLASSES[cls].color;
}

/** Gold found is worth more at higher CR. */
export function crGold(world: World, gold: number): number {
  return Math.round(gold * (1 + CR_RULES.goldPerCr * world.cr));
}

/**
 * `issue`: fill every Gear slot the kit leaves empty with the class's free Issued Gear (M15; real runs do, tests
 * choose), except slots the player chose to go without (`Kit.bare`).
 */
export function addHero(world: World, opts: { id: string; name: string; cls: ClassId; isBot?: boolean; loadout?: Loadout; issue?: boolean }): Hero {
  const d = world.dungeon;
  const { loadout, issue, ...rest } = opts;
  const rites = [...(loadout?.kit?.rites ?? [])];
  const maxHp = Math.round(injuredMaxHp(opts.cls, loadout?.injuries ?? []) * riteMult({ rites }));
  const hero: Hero = {
    ...rest,
    isBot: opts.isBot ?? false,
    lastKnown: {},
    knownChalk: {},
    knownThreat: {},
    knownContents: {},
    hp: maxHp,
    maxHp,
    st: {},
    deck: null,
    burned: [],
    bonusCards: loadout?.blessed ? ['oil'] : [],
    lastCard: null,
    issued: {},
    statusClock: 0,
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
    amulet: null,
    ring: null,
    charges: {},
    packCharges: [],
    unnoticedIn: null,
    riseAt: null,
    gold: 0,
    messages: [],
    knownLoot: {},
    knownCollapsed: [],
    knownPassages: [],
    ready: false,
    autopilot: false,
    extracted: false,
    extractedAt: null,
    fate: null,
    arrivedAt: null,
    forgotten: [],
    inSight: [],
    leading: [],
    knownEvents: {},
    queuedSkill: null,
    queuedItem: null,
    spadeBonus: 0,
    elixir: false,
    brewAt: world.time + CLASS_RULES.brewEvery,
    legacy: 0,
    raised: false,
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
    charId: loadout?.charId ?? null,
    owner: loadout?.owner ?? null,
    talents: [...(loadout?.talents ?? [])],
    villageShards: opts.isBot ? null : [...(loadout?.shards ?? [])],
    shard: null,
    shardSaved: false,
    injuries: [...(loadout?.injuries ?? [])],
    rites,
    runInjuries: [],
    lowestHp: 1,
    downedMajor: false,
    calledAt: null,
    mapRevealed: false,
    tolled: false,
    scryUntil: 0,
    codex: emptyCodex(),
    restHp: null,
    elite: {},
    wanderers: 0,
    legion: [],
    legacyItems: [],
    player: !(opts.isBot ?? false),
    emergency: opts.isBot ? null : (loadout?.emergency ?? null),
  };
  for (const i of hero.injuries) if (i === 'major') hero.speedMods.push({ amount: VILLAGE_RULES.majorSpeed, until: null, label: MAJOR_INJURY_LABEL });
  if (rites.includes('effigy')) hero.speedMods.push({ amount: KIT_RULES.effigySpeed, until: null, label: RITES.effigy.name });
  // What the player brought from the Village Stash: Gear on, consumables in the pack.
  const kit = loadout?.kit;
  if (kit) {
    for (const item of Object.values(kit.gear)) if (item) giveItem(hero, item);
    if (!rites.includes('gem')) for (const item of kit.consumables) giveItem(hero, item);
    hero.hp = hero.maxHp;
  }
  // Issued Gear (M15): whatever the kit leaves empty, the quartermaster fills with something plain.
  if (issue) {
    for (const slot of GEAR_SLOTS) {
      if (hero[slot] || kit?.bare?.includes(slot)) continue;
      const item = ISSUED_KIT[opts.cls][slot];
      giveItem(hero, item);
      hero.issued[slot] = item;
    }
    hero.hp = hero.maxHp;
  }
  world.heroes[hero.id] = hero;
  if (world.eliteEvents) seedEliteEvent(world, hero);
  for (const r of rites) notify(world, hero, `${RITES[r].name}: ${RITES[r].desc}`);
  startTimer(world, hero);
  explore(world, hero, d.entrance);
  if (loadout?.sight) seerReveal(world, hero, loadout.sight);
  updateKnowledge(world);
  return hero;
}

/**
 * The Village Seer (user, 2026-10-11): every room where what they foresaw lies at the start goes on the hero's map,
 * its loot showing (as glimpsed from next door: no events, no paths).
 */
function seerReveal(world: World, h: Hero, sight: Sight) {
  let rooms = 0;
  for (const [key, pile] of Object.entries(world.piles)) {
    const room = Number(key);
    if (!pile.items.some((f) => sightMatches(sight, f.item))) continue;
    rooms++;
    if (!h.seen.includes(room)) h.seen.push(room);
    h.knownLoot[room] = lootCount(world, room, h);
    h.knownContents[room] = { at: world.time, monsters: monsterTypes(world, room), ...pileSeen(world, room), glimpsed: true };
  }
  const what = [sight.consumable && pluralName(sight.consumable), sight.resource && pluralName(sight.resource), sight.gear && GEAR_KIND_PLURALS[sight.gear]]
    .filter(Boolean).join(', ');
  notify(world, h, rooms ? `The Seer's vision: ${what} in ${rooms} room${rooms === 1 ? '' : 's'}, marked on your map.` : `The Seer looked for ${what}, and saw none.`);
}

export function step(world: World, dt: number): void {
  if (world.phase !== 'running' || world.paused) return;
  world.time += dt;
  const drain = LIGHT_DRAIN * (world.escalation >= 4 ? ESCALATION.lateLightDrain : 1);
  for (const hero of Object.values(world.heroes)) {
    if (!inDungeon(hero)) continue;
    // Lying in the Open Coffin is no wound: it counts the HP they lay down with.
    hero.lowestHp = Math.min(hero.lowestHp, (hero.restHp ?? hero.hp) / hero.maxHp);
    syncInjuries(hero);
    hero.light = Math.max(0, hero.light - drain * (hero.cls === 'lampbearer' ? CLASS_RULES.lampLightDrain : 1) * wornMult(hero, 'lightDrainMult') * dt);
    // Bloodstone Ring: slowly mends while exploring.
    const regen = wornStat(hero, 'regen');
    if (regen > 0 && isConscious(hero) && hero.encounter === null) hero.hp = Math.min(hero.maxHp, hero.hp + dt / regen);
    // Turn statuses tick when the Speed timer runs out (see endIdleTurn and arrive); a channel holds the timer, so time it instead.
    if (isConscious(hero) && hero.encounter === null && hero.channel) tickFieldTurns(world, hero, dt);
    else hero.statusClock = 0;
    if (hero.channel) tickChannel(world, hero);
    else if (isConscious(hero) && hero.encounter === null) advance(world, hero, dt);
    // The next timer only starts once the hero is free again.
    if (hero.channel || !isConscious(hero) || hero.encounter !== null) {
      startTimer(world, hero);
      hero.queuedEvent = null;
      hero.queuedSkill = null;
      hero.queuedItem = null;
    }
    if (hero.cls === 'alchemist') tickBrew(world, hero);
    tickCharges(hero, dt);
  }
  tickDowned(world);
  tickRisings(world);
  tickClocks(world);
  tickCombat(world);
  tickLoot(world);
  tickEvents(world, dt);
  leaveTogether(world);
  if (world.escalates) tickEscalation(world);
  tickForgetting(world);
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
      // Tome Rite: their gold and consumables go home anyway.
      if (h.rites.includes('tome')) tomeLegacy(h);
      chronicle(world, `The dungeon collapsed on ${h.name}.`);
    }
    world.phase = 'collapsed';
  } else {
    // Nobody left standing to get the downed back up: they die now instead of after the wait (a Gravecloth about
    // to get its wearer up counts as someone).
    if (heroes.every((h) => !inDungeon(h) || (h.downedAt !== null && h.riseAt === null))) for (const h of heroes) if (inDungeon(h)) dieOut(world, h);
    if (heroes.every((h) => h.dead)) world.phase = 'wiped';
    else if (heroes.every((h) => !inDungeon(h))) world.phase = 'ended';
  }
  if (world.phase !== 'running') {
    closeFights(world);
    const { altars, villagers } = world.objectives;
    const bonus = crGold(world, altars * EVENT_SEEDING.altarBonus + villagers * EVENT_SEEDING.villagerBonus);
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

/**
 * Ready heroes leave together (user, 2026-10-10): with no fight or monsters at the exit and
 * nobody lying downed there, if every conscious hero in the exit room is ready, they all escape at once. Alone and
 * ready, you're out the moment you arrive. Someone who fled out through the exit has simply left the room.
 */
function leaveTogether(world: World) {
  const exit = world.dungeon.exit;
  if (world.encounters[exit] || monstersIn(world, exit).length) return;
  const here = Object.values(world.heroes).filter((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === exit);
  if (!here.length || here.some((h) => h.downedAt !== null || !h.ready)) return;
  if (here.length > 1) chronicle(world, `${here.map((h) => h.name).join(', ').replace(/, ([^,]*)$/, ' and $1')} left together.`);
  for (const h of here) extractHero(world, h);
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
  // Valuables carried out turn into gold (found gold: worth more at higher CR).
  for (const it of h.items.filter((x) => ITEMS[x].kind === 'valuable')) h.gold += crGold(world, ITEMS[it].value ?? 0);
  h.items = h.items.filter((x) => ITEMS[x].kind !== 'valuable');
  h.fate = `escaped with ${h.gold} gold`;
  chronicle(world, `${h.name} escaped with ${h.gold} gold.`);
  // Mortician: the allies this Undertaker Raised walk out with them, and what they carry goes to their Villages.
  for (const r of h.legion) if (r.hero && world.heroes[r.hero]) risenAllyEscapes(world, h, world.heroes[r.hero]);
  h.legion = h.legion.filter((r) => !r.hero);
  // Wayward Wanderers: the villagers who walked out with the Warden are saved.
  if (h.wanderers > 0) {
    world.objectives.villagers += h.wanderers;
    chronicle(world, `${h.name} led ${h.wanderers} wayward villagers out of the dark.`);
    h.wanderers = 0;
  }
  // Only those who saw it happen know they left.
  for (const o of Object.values(world.heroes)) {
    if (o !== h && inDungeon(o) && sameRoom(o, h)) {
      o.lastKnown[h.id] = {
        pos: { ...h.pos }, heading: null, time: world.time, hp: h.hp, maxHp: h.maxHp, downed: false, dead: false, extracted: true,
      };
      notify(world, o, `${h.name} escapes through the exit.`);
    }
  }
}

/** You're out (escaped or dead) and the other three heroes are all bots: nobody's run to spoil. */
export function soloOut(world: World, h: Hero): boolean {
  const others = Object.values(world.heroes).filter((o) => o !== h);
  return !inDungeon(h) && others.length === 3 && others.every((o) => o.isBot);
}

/** Only a lone player with three bots may stop time: nobody else is kept waiting. */
export function canPause(world: World, h: Hero): boolean {
  const others = Object.values(world.heroes).filter((o) => o !== h);
  return world.phase === 'running' && !h.isBot && others.length === 3 && others.every((o) => o.isBot);
}

export function applyIntent(world: World, heroId: string, intent: Intent): void {
  const hero = world.heroes[heroId];
  if (!hero || world.phase !== 'running') return;
  if (intent.type === 'revealMap' || intent.type === 'killBots') {
    if (!soloOut(world, hero)) return;
    if (intent.type === 'revealMap') hero.mapRevealed = true;
    else {
      for (const b of Object.values(world.heroes)) {
        if (b === hero || !inDungeon(b)) continue;
        b.dead = true;
        b.diedAt = world.time;
        b.fate = `was abandoned in ${roomName(world, b)}`;
        chronicle(world, `${b.name} was abandoned in ${roomName(world, b)}.`);
      }
      notify(world, hero, 'You leave the bots to the dark.', 'abandon');
      checkEnd(world);
    }
    return;
  }
  if (intent.type === 'call') {
    // A cry needs no turn, nor even standing up.
    const err = callForHelp(world, hero);
    if (err && inDungeon(hero)) notify(world, hero, err);
    return;
  }
  if (!isConscious(hero)) return;
  if (intent.type === 'ready') {
    // Allowed mid-fight and away from the exit: it's a standing intention.
    hero.ready = intent.on ?? !hero.ready;
    return;
  }
  if (intent.type === 'combat') {
    submitChoice(world, hero, intent.choice);
    return;
  }
  if (intent.type === 'stepTo') {
    stepToEnd(world, hero, intent.to);
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
    case 'dropGold': {
      const err = dropGold(world, hero, intent.amount);
      if (err) notify(world, hero, err);
      return;
    }
    case 'unequip':
      unequip(world, hero, intent.slot);
      return;
    case 'toggleAuto': {
      const err = toggleAuto(hero, intent.slot);
      if (err) notify(world, hero, err);
      return;
    }
    case 'useItem': {
      // Gear from the pack goes on at once, like taking it off.
      if (hero.items[intent.index] && slotOf(hero.items[intent.index])) {
        const err = equipFromPack(world, hero, intent.index);
        if (err) notify(world, hero, err);
        return;
      }
      // Checked now so a bad pick is refused at once. It's this turn's action: any walk is called off (back to
      // the room you left), and the item takes effect when the timer runs out.
      // From a tunnel, judged from the room you'd be back in.
      const pos = hero.pos;
      if (pos.kind === 'corridor') hero.pos = { kind: 'room', room: pos.from };
      const err = fieldItemError(world, hero, intent.index, intent.target);
      hero.pos = pos;
      if (err) return notify(world, hero, err);
      cancelTravel(world, hero);
      hero.channel = null;
      hero.queuedEvent = null;
      hero.queuedSkill = null;
      hero.queuedItem = { item: hero.items[intent.index], index: intent.index, target: intent.target ?? null };
      return;
    }
    case 'event': {
      // Checked now so a bad pick is refused at once; it starts when the timer runs out.
      const err = chooseEvent(world, hero, intent.choice, true);
      if (err) return notify(world, hero, err);
      if (hero.channel?.kind === 'event') return;
      hero.channel = null; // stop digging or reviving
      hero.queuedSkill = null;
      hero.queuedItem = null;
      hero.queuedEvent = intent.choice;
      hero.path = [];
      hero.heading = null;
      return;
    }
    case 'skill': {
      const skill = intent.skill ?? fieldSkillsOf(hero)[0];
      const err = skill ? checkSkill(world, hero, skill) : 'You have no such skill.';
      if (err) return notify(world, hero, err);
      hero.channel = null;
      hero.queuedEvent = null;
      hero.queuedItem = null;
      hero.queuedSkill = { skill: skill!, target: intent.target ?? null, room: intent.room };
      hero.path = [];
      hero.heading = null;
      return;
    }
    case 'autopilot':
      return;
    case 'extract':
      if (hero.pos.kind !== 'room' || hero.pos.room !== world.dungeon.exit) return notify(world, hero, 'You must be at the rendezvous.');
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
      hero.queuedItem = null;
      return;
    case 'turnBack':
      hero.channel = null;
      cancelTravel(world, hero);
      return;
    case 'goto':
      // Only an actual move interrupts digging/reviving; an unreachable click shouldn't.
      if (intent.step ? stepTo(world, hero, intent.room) : goto(world, hero, intent.room)) {
        hero.channel = null;
        hero.queuedEvent = null;
        hero.queuedSkill = null;
        hero.queuedItem = null;
        hero.heading = intent.room;
      }
      else if (!intent.step && hero.pos.kind === 'room' && intent.room !== hero.pos.room) notify(world, hero, "You don't know a way there.");
      return;
  }
}

/** Loot in a room worth this hero's notice: gold, and items they don't ignore. */
/** The Codex: what's truly in the room this hero stands in (monsters, loot, the event) and what they carry. */
function noteCodex(world: World, a: Hero, room: number) {
  const c = a.codex;
  const add = <T>(list: T[], x: T | null | undefined) => {
    if (x != null && !list.includes(x)) list.push(x);
  };
  for (const m of monstersIn(world, room)) add(c.enemies, m.type);
  for (const f of world.piles[room]?.items ?? []) add(c.items, f.item);
  for (const it of a.items) add(c.items, it);
  for (const s of GEAR_SLOTS) add(c.items, a[s]);
  const ev = world.events[room];
  add(c.events, ev?.kind);
  if (villagerHere(world, room)) add(c.events, 'villager');
  // A class twist is found by meeting its event while playing that class.
  for (const id of TWIST_IDS) {
    const t = TWISTS[id];
    if (t.cls === a.cls && c.events.includes(t.event) && (ev?.kind === t.event || (t.event === 'villager' && villagerHere(world, room)))) add(c.twists, id);
  }
}

/** A hero's memory of a room: what was in it when they last looked. A room seen only from next door holds just what showed from there. */
export interface RoomSighting {
  at: number;
  monsters: EnemyId[];
  items: ItemId[];
  gold: number;
  /** An unfinished event, or 'villager' for a captive. */
  event?: EventKind;
  /** Only ever seen from next door, so events (and, without Cutthroat eyes, loot) are unknown. */
  glimpsed?: boolean;
}

function monsterTypes(world: World, room: number): EnemyId[] {
  return monstersIn(world, room).map((m) => m.type);
}

function pileSeen(world: World, room: number): { items: ItemId[]; gold: number } {
  const p = world.piles[room];
  return { items: p ? p.items.map((f) => f.item) : [], gold: pileGold(p) };
}

function lootCount(world: World, room: number, h: Hero): number {
  const p = world.piles[room];
  return p ? p.items.filter((f) => wants(h, f)).length + (goldFor(h, p) > 0 ? 1 : 0) : 0;
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
  // As in a fight: cooldowns and start-of-turn statuses first, Poison and the rest after what the turn was spent on.
  fieldTurnStart(hero);
  const choice = hero.queuedEvent;
  hero.queuedEvent = null;
  if (choice !== null) {
    const err = chooseEvent(world, hero, choice);
    if (err) notify(world, hero, err);
  }
  const skill = hero.queuedSkill;
  hero.queuedSkill = null;
  if (skill) useSkill(world, hero, skill.skill);
  const used = hero.queuedItem;
  hero.queuedItem = null;
  if (used) {
    // The pack may have shifted since it was picked.
    const index = hero.items[used.index] === used.item ? used.index : hero.items.indexOf(used.item);
    const err = index < 0 ? 'You no longer have it.' : useItemInField(world, hero, index, used.target ?? undefined);
    if (err) notify(world, hero, err);
  }
  fieldTurnEnd(world, hero);
  if (!hero.channel) startTimer(world, hero, hero.turnAt);
}

function advance(world: World, hero: Hero, dt: number) {
  const d = world.dungeon;
  let remaining = dt;
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
      // Turning your back on a Wounded Stranger may spring its trap.
      if (leaveStranger(world, hero, pos.room)) {
        hero.path = [];
        return;
      }
      hero.path.shift();
      // The walk fills this turn's timer: setting out late in it puts you part-way down the tunnel already.
      const dur = hero.turnAt - hero.turnStart;
      const t = Math.min(dur, Math.max(0, world.time - hero.turnStart));
      hero.pos = { kind: 'corridor', corridor: c.id, from: pos.room, to: next, t, dur };
      hero.prevRoom = pos.room;
      leftRoom(hero);
      // Wayfarer's Cloak: this tunnel goes by in a moment.
      const quick = clothReady(hero, 'wayfarer');
      if (quick) {
        spendCloth(hero, quick);
        hero.pos.t = 0;
        hero.pos.dur = CLOTH.wayfarerSecs;
        notify(world, hero, `Your wayfarer's cloak hurries you through the tunnel. (${CLOTH.wayfarerSecs}s)`);
      }
      remaining = 0;
      // Chalk wherever there's a choice of way on: crossroads and two-exit rooms, not dead ends.
      // Marks pile up: a new way out adds one, it never rubs out the old ones.
      if (d.rooms[pos.room].corridors.length >= 2) {
        const marks = ((world.chalk[pos.room] ??= {})[hero.id] ??= []);
        if (!marks.includes(c.id)) {
          marks.push(c.id);
          hero.pos.chalked = true;
        }
      }
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
      const at = world.time - remaining;
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
  fieldTurn(world, hero); // the walk was this turn
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
      const scrying = world.time < a.scryUntil;
      if (a !== b && inDungeon(a) && (inDungeon(b) || b.dead) && (canSee(world, a, b) || hearsToll(world, b) || scrying)) {
        a.lastKnown[b.id] = {
          pos: { ...b.pos }, heading: headingOf(b), time: world.time, hp: b.hp, maxHp: b.maxHp, downed: b.downedAt !== null, dead: b.dead,
        };
        // Scrying Pool: the room they're in shows too (both ends of a tunnel they're walking).
        if (scrying) for (const r of b.pos.kind === 'room' ? [b.pos.room] : [b.pos.from, b.pos.to]) scryRoom(world, a, r);
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
      if (world.chalk[room]) a.knownChalk[room] = Object.fromEntries(Object.entries(world.chalk[room]).map(([id, cs]) => [id, [...cs]]));
      a.knownThreat[room] = monstersIn(world, room).length;
      a.knownLoot[room] = lootCount(world, room, a);
      const ev = world.events[room];
      if (villagerHere(world, room)) a.knownEvents[room] = 'villager';
      else if (ev && !ev.done) a.knownEvents[room] = ev.kind;
      else delete a.knownEvents[room];
      a.knownContents[room] = { at: world.time, monsters: monsterTypes(world, room), ...pileSeen(world, room), event: a.knownEvents[room] };
      noteCodex(world, a, room);
      if (a.cls === 'cutthroat') {
        for (const n of neighbours(world.dungeon, room)) {
          a.knownLoot[n] = lootCount(world, n, a);
          a.knownContents[n] = { ...(a.knownContents[n] ?? { monsters: [], glimpsed: true }), ...pileSeen(world, n), at: world.time };
        }
      }
      if (a.light >= LIGHT_DIM || seesInDark(a)) {
        for (const n of neighbours(world.dungeon, room)) {
          const monsters = monsterTypes(world, n);
          a.knownThreat[n] = monsters.length;
          a.knownContents[n] = { ...(a.knownContents[n] ?? { items: [], gold: 0, glimpsed: true }), monsters, at: world.time };
        }
      }
    }
  }
}

/**
 * Scrying Pool: a room an ally is in, seen from afar: what's in it (as the scryer's eyes see it), its event and its
 * chalk, as if standing in it (but not explored: its paths stay unknown).
 */
function scryRoom(world: World, a: Hero, room: number) {
  if (!a.seen.includes(room)) a.seen.push(room);
  const monsters = monsterTypes(world, room);
  a.knownThreat[room] = monsters.length;
  a.knownLoot[room] = lootCount(world, room, a);
  if (world.chalk[room]) a.knownChalk[room] = Object.fromEntries(Object.entries(world.chalk[room]).map(([id, cs]) => [id, [...cs]]));
  const ev = world.events[room];
  if (villagerHere(world, room)) a.knownEvents[room] = 'villager';
  else if (ev && !ev.done) a.knownEvents[room] = ev.kind;
  else delete a.knownEvents[room];
  a.knownContents[room] = { at: world.time, monsters, ...pileSeen(world, room), event: a.knownEvents[room] };
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

/**
 * Call off the walk: you're back in the room you set out from at once, and your Speed timer keeps running, so
 * there may be time left to do something else this turn (another tunnel set out on now still lands when it ends).
 */
export function cancelTravel(world: World, hero: Hero) {
  hero.path = [];
  hero.heading = null;
  const pos = hero.pos;
  if (pos.kind !== 'corridor') return;
  hero.pos = { kind: 'room', room: pos.from };
  // Turning back rubs out the mark this walk just left (an older one for the same tunnel stays).
  const marks = world.chalk[pos.from]?.[hero.id];
  if (pos.chalked && marks) marks.splice(marks.indexOf(pos.corridor), 1);
  // Waiting at the far end for slower companions: that turn is already over.
  if (timerDone(world, hero)) startTimer(world, hero);
  onHeroInRoom(world, hero, pos.from);
}

export function explore(world: World, hero: Hero, room: number) {
  addUnique(hero.explored, room);
  addUnique(hero.seen, room);
  relearnPaths(world, hero, room);
  // A secret passage that opened since you were last here only shows up once you're back (or there when it opens).
  for (const cid of world.dungeon.rooms[room].corridors) {
    const c = world.dungeon.corridors[cid];
    if (c.secret && (!c.privy || c.privy.includes(hero.id))) addUnique(hero.knownPassages, c.id);
  }
  if (hero.light >= LIGHT_DIM || seesInDark(hero)) {
    for (const n of neighbours(world.dungeon, room)) {
      // A secret room opened only to a Cutthroat (Cunning Cant) stays hidden from everyone else.
      const privy = corridorBetween(world.dungeon, room, n)?.privy;
      if (!privy || privy.includes(hero.id)) addUnique(hero.seen, n);
    }
  }
}

/** Adds `v` if it's missing; true if it was. */
function addUnique(arr: number[], v: number): boolean {
  if (arr.includes(v)) return false;
  arr.push(v);
  return true;
}

/**
 * A corridor is known to a hero once they have explored either end, or read the whole map (Cunning Cant). A secret
 * passage needs exploring an end after it opened (`knownPassages`). A passage opened only to some heroes (`privy`)
 * doesn't exist for anyone else. A forgotten one (`forgotten`) is unknown again.
 */
export function knowsCorridor(hero: Hero, c: Corridor): boolean {
  if (c.privy && !c.privy.includes(hero.id)) return false;
  if (hero.elite.cant) return true;
  // Forgotten (sim/mind.ts) until you stand at either end again.
  if (hero.forgotten.includes(c.id)) return false;
  if (c.secret) return hero.knownPassages.includes(c.id);
  return hero.explored.includes(c.a) || hero.explored.includes(c.b);
}

/** Head straight down the known tunnel to a neighbouring room (from a tunnel: back, or on from where it leads). */
function stepTo(world: World, hero: Hero, target: number): boolean {
  const pos = hero.pos;
  if (pos.kind === 'corridor' && target === pos.from) {
    cancelTravel(world, hero);
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
  // In a corridor: carry on, or call the walk off (back where you started at once, with this turn still running).
  // Either way the next room is reached when the timer runs out, so it's hops after that which count.
  const fwd = shortestPath(world, hero, pos.to, target);
  const back = shortestPath(world, hero, pos.from, target);
  const fwdHops = fwd ? fwd.length : Infinity;
  const backHops = back ? Math.max(0, back.length - 1) : Infinity;
  if (fwdHops === Infinity && backHops === Infinity) return false;
  if (back && (back.length === 0 || backHops < fwdHops)) {
    cancelTravel(world, hero);
    hero.path = back;
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
