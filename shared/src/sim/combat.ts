import { CLASS_RULES } from '../content/innates';
import { CARD_RULES, CARDS, isCardId, type CardId } from '../content/cards';
import { escalationAt, LIGHT_MAX, MIN_SPEED } from '../content/constants';
import {
  crBonus, crUnitChance, CR_RULES, ENCOUNTER_GROUPS, ENEMIES, ESCALATION, KING_RULES, LAIR_GROUPS, ROSTER_RULES, TIERS, type EnemyId, type GroupTemplate,
} from '../content/enemies';
import { hasTalent, TALENT_RULES } from '../content/talents';
import { corridorBetween, neighbours, theRoom } from '../dungeon/gen';
import { CLOTH, ITEMS, LOOT, isGear, type ItemId } from '../content/items';
import { buffLength, chargesForFight, clothReady, leftRoom, spendCloth, witchwoodMult } from './gear';
import { addToPile, applyItem, bodyRoom, dropBounty, dropEverything, dropKingsTreasure, dropRegalia, itemTargets, monsterPoints, risenAllyFalls, wornMult, wornStat } from './loot';
import { ELITE_EVENTS, LIGHT_LOSS } from '../content/events';
import { maybeHitVillager } from './events';
import { chronicle, extractHero, roomName, type Hero, type World } from './world';
import { notify } from './notify';
import { speedOf } from './speed';
import { injuredMaxHp, KIT_RULES, VILLAGE_RULES, type Injury } from '../village';
import { actionTime, cardTime, playCard, tickOn, uselessReason, type DebuffKind } from './cards';
import { dealDeck, gatherDeck, settleCard, takeFromHand } from './deck';

export const DEATH_TIMER = 36;
export const REVIVE_CHANNEL = 6;
export const REVIVE_HP_FRACTION = 0.3;
export const FLEE_CHANCE = 0.5;

/** Turn counts are the affected unit's own turns: they tick down at the end of each of its turns. */
export interface Statuses {
  /** Skips its next turn. */
  stun?: boolean;
  /** Each Poison runs on its own: `rounds` = turns of poison left for that one. */
  poison?: Poison[];
  /** Acid: −CLASS_RULES.acidBonus Block per stack. `turns` = own turns until one stack fades. */
  acid?: { stacks: number; turns: number };
  /** Monster: wolf bites this fight, each −1 Block (gone when the fight ends, like every monster status). */
  sunder?: number;
  /** Hexed: one entry per stack, each the turns it has left. Every stack adds CLASS_RULES.hexedBonus to Hex's damage. */
  hexed?: number[];
  /** Shield (was Block): soaks up this much damage from blows. Can be gained out of combat; gone when a fight you are in ends. */
  shield?: number;
  /** Wither: each stack halves the damage it deals (two: −75%). `turns` = own turns until one stack fades (like Acid). */
  weak?: { stacks: number; turns: number };
  /** Witchwood Staff: takes STAFF.witchMult more from everyone while it carries any debuff. */
  witchwood?: boolean;
  /** Warden's Thornwall: until their next turn, what their Shield stops is dealt back to the attacker. */
  thornwall?: boolean;
  /** Lich's Doom (heroes): stacks, each CR_RULES.doom more from every blow, aura and poison tick. Holds while a Lich
   * stands in their fight; otherwise one stack fades at the end of each of their turns, in a fight or out. */
  doom?: number;
  /** Bellwright's Clang: −CARD_RULES.clangHaste on every card per stack. `turns` = own turns until one stack fades (ticks at the start of each). */
  clang?: { stacks: number; turns: number };
  /** Monster: has taken a turn in this fight (Backstab crits those that haven't). */
  acted?: boolean;
  /** 50% dodge until this game time (Smoke Bomb, Sidestep). */
  dodge?: number;
  /** Fleeing always works until this game time (Smoke Bomb). */
  fleeSure?: number;
  // ---- Card statuses (M15). Clock statuses run on game time; Bleed and Regen tick every CARD_RULES.pulse seconds. ----
  /** Bleed: each one ticks every pulse until its time is up (the slow suffer it longest). */
  bleed?: { dmg: number; until: number; next: number }[];
  /** Regen: heals `amount` every pulse until `until`. */
  regen?: { amount: number; until: number; next: number };
  /** Slowed: every action takes this much longer until `until`. */
  slow?: { amount: number; until: number };
  /** Haste: every card takes this much less until `until`. */
  haste?: { amount: number; until: number };
  /** Blinded (a charge): its next attack misses. */
  blind?: boolean;
  /** Exposed (a charge): the next hit it takes does this much more (0.5 = +50%). */
  exposed?: number;
  /** A hero's next hit Exposes what it lands on (Hand Signal). */
  expose?: boolean;
  /** Attacks aimed at this hero that miss outright (Fade, Blink, Veil), one charge each. */
  evade?: number;
  /** Hold the Gate: until this game time, every enemy whose blow lands on this hero's Shield is Delayed. */
  gate?: number;
  /** Blade Dance: every card takes 1s and Backstab always crits, until this game time. */
  dance?: number;
  /** The next card played: takes at most `set` seconds, then `cut` less (Mad Bargain, Fade, Whisper Cut…). */
  quick?: { set?: number; cut: number };
  /** For the rest of this fight: Conjure cards take half the time (Fever Dream). */
  conjureHalf?: boolean;
  /** For the rest of this fight: items take the quick time (Opus Magnum). */
  quickItems?: boolean;
  /** Smoke Bomb while Sneaking: the Cutthroat's next Flee is a Sneak Past (a charge). */
  sneakPast?: boolean;
  // ---- Until someone's next turn ----
  /** Lampbearer's lone Vigil: every enemy action sets off a Flare, until this hero's next turn. */
  vigil?: string;
  /** Evergreen Staff: the lone Vigil holds through this many more of the Lampbearer's turns. */
  vigilMore?: number;
  /** Bracing until their own next turn. */
  brace?: boolean;
  /** Sidestep: this chance to dodge until their own next turn. */
  sidestep?: number;
  /** Scale Ward: whatever hits this hero takes this much, until their own next turn. */
  spikes?: number;
}

export interface Poison {
  dmg: number;
  rounds: number;
}

export interface Monster {
  id: string;
  type: EnemyId;
  room: number;
  hp: number;
  maxHp: number;
  dmgMult: number;
  st: Statuses;
  /** The Toll: stopped in its tracks until this game time; a fight it starts before then, it starts Stunned. */
  dazedUntil?: number;
  /** A Zombie back on its feet: killing it again adds nothing to the room's bounty. */
  again?: boolean;
  /** Lich: its raising is used up. */
  spent?: boolean;
  /** Dead King: the move he makes next (he takes turns between them, starting with either). */
  cycle?: 'kneel' | 'charge';
  /** Marches in the Dead King's procession (Crowned in Dread): the last of them to fall drops his treasure. */
  procession?: true;
  /** A straggler heading for the exit: no loot of its own, though it may pick something up (`carry`). */
  straggler?: true;
  /** What a straggler picked up (one thing at most): Gear helps it (`carried`); it drops where it falls. */
  carry?: ItemId;
}

/** A slain monster as a fight remembers it (what Raise and the Lich bring back). */
export interface Slain {
  /** The id it had: a Zombie's pending rise is keyed by it. */
  id?: string;
  type: EnemyId;
  maxHp: number;
  dmgMult: number;
  again?: boolean;
  straggler?: true;
}

/** A Zombie that will get back up in `room` at `at`. */
export interface Rising extends Slain {
  id: string;
  room: number;
  at: number;
}

/** A slain monster the Undertaker raised: it fights on the heroes' side, nearest the enemy, for a few turns. */
export interface Risen {
  id: string;
  /** The slain monster it was (none for a Risen ally). */
  type?: EnemyId;
  /** A Risen ally: the fallen hero an Undertaker raised (it fights as their class would, and carries their things). */
  hero?: string;
  hp: number;
  maxHp: number;
  dmgMult: number;
  /** Own turns left before it crumbles. */
  turns: number;
  by: string;
  /** Unholy Uprising: never crumbles; only falls when its HP runs out. */
  permanent?: boolean;
  /** Raised by the Unholy Uprising (allies fighting beside it lose light when the fight ends). */
  uprising?: true;
  /**
   * The Undertaker's following (M16, user): what he raises or summons stays with him for good, and decays. Each
   * stack: +2s Speed, −2 Block. Set (0 or more) only on his following; their number is capped.
   */
  decay?: number;
  /** Fights it has come through (Restless Dead decays it every other one). */
  age?: number;
  /** Called up by a card for this fight only: gone when it ends (M15). */
  summon?: boolean;
  /** What "every ally" cards left on it this fight (Shield, Dodge, Regen…). A Risen ally uses its hero's instead. */
  st?: Statuses;
}

/** A hero's move: a card from their hand, or one of the basic actions beside it. */
export type CombatAction = 'card' | 'flee' | 'revive' | 'brace' | 'item';

export interface Choice {
  action: CombatAction;
  /** Which card in hand, for action 'card'. */
  card?: CardId;
  target?: string;
  /** Inventory slot, for action 'item'. */
  item?: number;
  /** A room on the hero's map, for a card aimed at one (Waystep). */
  room?: number;
}

export type CombatEventKind = 'damage' | 'heal' | 'miss' | 'status' | 'flee' | 'down' | 'death' | 'info' | 'light';

export interface CombatEvent {
  /** Increases through the fight, so clients can replay only what's new. */
  seq?: number;
  actor: string;
  kind: CombatEventKind;
  text: string;
  target?: string;
  /** How much: damage, healing, or light (negative when light is lost). */
  amount?: number;
  crit?: boolean;
}

/**
 * A fight. There are no rounds: every unit (hero or monster) has its own timer of `Speed` seconds.
 * When it runs out the unit acts (a hero does what they picked, or their default) and it starts again.
 */
export interface Encounter {
  room: number;
  startedAt: number;
  /** Heroes taking part, in join order (downed ones included, they just can't act). */
  heroes: string[];
  /** Unit id → game time of its next turn. Units get one when they're first seen standing in the fight. */
  next: Record<string, number>;
  /** Each hero's pick for their next turn. They can change it until the turn comes. */
  choices: Record<string, Choice>;
  /** Recent events (newest last), for animation. */
  events: CombatEvent[];
  seq: number;
  log: string[];
  /** The last monster slain here (what Raise brings back), and the risen one, if any. */
  lastSlain?: Slain | null;
  /** Every monster slain in this fight, oldest first (the Lich raises the newest). */
  slain?: Slain[];
  risen?: Risen | null;
  /** Unholy Uprising: the Risen that follow an Undertaker everywhere, fighting here (fallen ones stay until it ends). */
  legion?: Risen[];
  /**
   * Heroes standing at the back, whatever their Speed: those who walked in after it began (user, 2026-10-12) and those
   * who stepped back (A). Oldest first; each newcomer stands behind the last.
   */
  back?: string[];
  /** Heroes who stepped to the front (D), whatever their Speed. Oldest first; each newcomer stands ahead of the last. */
  front?: string[];
  /** Turns each unit has taken in this fight (the timeline keys each upcoming turn by it). */
  turns?: Record<string, number>;
  /** Heroes who have had their first timer in this fight (Opening Act only speeds up the first). */
  opened?: string[];
  /** Dead King's Charges so far: every monster in the fight is this many × KING_RULES.chargeHaste faster until it ends. */
  charge?: number;
  /** The whole play-by-play, for the results screen (shared with this fight's chronicle entry). */
  history?: FightLine[];
  /** Everyone who fought here at any point, in join order, and what they faced. */
  fought?: string[];
  foes?: string[];
  /** This fight's entry in `world.chronicle`. */
  chron?: number;
  /** Cards each hero has played in this fight (first-card effects). */
  played?: Record<string, number>;
  /** The last debuff each hero placed in this fight (Double Hex copies it). */
  lastDebuff?: Record<string, DebuffKind>;
  /** Each unit's current wait, in seconds (for the timer rings): a hero's last card, a monster's Speed. */
  span?: Record<string, number>;
  /**
   * An Ambush (the Cutthroat's Sneak, M16): this hero walked in Sneaking, alone, unseen. No monster acts until their
   * first action; then every monster's timer starts fresh.
   */
  ambush?: string;
}

/** One line of a fight's play-by-play: seconds since the fight began, and what happened. */
export interface FightLine {
  t: number;
  text: string;
}

/** A chronicle entry; fights carry their full play-by-play, opened by clicking them on the results screen. */
export interface ChronicleEntry {
  time: number;
  text: string;
  fight?: { room: number; lines: FightLine[] };
}

/** A fight's play-by-play stops growing here (a stalemate shouldn't bloat the results). */
const HISTORY_CAP = 200;

// ---------------------------------------------------------------------------
// Spawning

export function spawnInitialMonsters(world: World) {
  const d = world.dungeon;
  const safe = new Set([d.entrance, d.exit, ...neighbours(d, d.entrance)]);
  for (const room of d.rooms) {
    if (room.kind === 'secret' || safe.has(room.id) || !world.rng.chance(ESCALATION.roomMonsterChance)) continue;
    if (world.rng.chance(ESCALATION.lairChance)) {
      spawnGroup(world, room.id, crUnits(world, fillGroup(world, pickTemplate(world, LAIR_GROUPS).tiers), 'lair', room.id), escalationAt(world.time));
      // Pre-seeded bounty marks the lair (spawnInitialLoot) and sweetens its drop.
      world.bounty[room.id] = LOOT.lairBounty;
    } else spawnGroup(world, room.id, crUnits(world, pickGroup(world, escalationAt(world.time)), 'room', room.id), escalationAt(world.time));
  }
}

/**
 * Challenge Rating additions to a group about to spawn in `room`: each tier's CR unit, once the CR has unlocked it,
 * comes along on its own roll (lairs: always). Units that are one to a room skip a room that has one.
 */
export function crUnits(world: World, units: EnemyId[], kind: 'room' | 'lair', room: number): EnemyId[] {
  const out = [...units];
  for (const t of TIERS) {
    const unit = world.roster.cr[t];
    const p = crUnitChance(t, world.cr);
    if (!unit || p <= 0) continue;
    if (ENEMIES[unit].onePerRoom && (out.includes(unit) || monstersIn(world, room).some((m) => m.type === unit))) continue;
    if (kind === 'lair' || world.rng.chance(p)) out.push(unit);
  }
  return out;
}

export function pickTemplate(world: World, groups: GroupTemplate[]): GroupTemplate {
  const total = groups.reduce((s, g) => s + g.weight, 0);
  let roll = world.rng.float(0, total);
  for (const g of groups) {
    roll -= g.weight;
    if (roll <= 0) return g;
  }
  return groups[0];
}

/** One of the run's default units for each tier in the template (a tier it has none of is skipped). */
export function fillGroup(world: World, tiers: readonly GroupTemplate['tiers'][number][]): EnemyId[] {
  const out: EnemyId[] = [];
  for (const t of tiers) {
    const options = world.roster.main[t].filter((u) => !ENEMIES[u].onePerRoom || !out.includes(u));
    if (options.length) out.push(world.rng.pick(options));
  }
  // The Queen never walks alone.
  if (out.length && out.every((u) => ENEMIES[u].needsCompany) && world.roster.main[0].length) out.push(world.rng.pick(world.roster.main[0]));
  return out;
}

/** An ordinary group of the run's default units, from the rows this Escalation allows. */
export function pickGroup(world: World, esc = 0): EnemyId[] {
  const groups = ENCOUNTER_GROUPS.filter((g) => (g.minEscalation ?? 0) <= esc && g.tiers.every((t) => ROSTER_RULES.escalation[t] <= esc));
  return fillGroup(world, pickTemplate(world, groups).tiers);
}

export function spawnGroup(world: World, room: number, units: EnemyId[], esc: number): Monster[] {
  return units.map((type) => {
    const scale = monsterScale(world, type, esc);
    const m: Monster = {
      id: `m${world.nextId++}`,
      type,
      room,
      hp: Math.round(ENEMIES[type].maxHp * scale),
      maxHp: Math.round(ENEMIES[type].maxHp * scale),
      dmgMult: scale,
      st: {},
    };
    world.monsters[m.id] = m;
    return m;
  });
}

/** HP and damage multiplier for a monster spawned now: Escalation's bonus plus CR's for its tier, added together. */
export function monsterScale(world: World, type: EnemyId, esc: number): number {
  return 1 + ESCALATION.escalationScaling * esc + crBonus(ENEMIES[type].tier, world.cr);
}

export function monstersIn(world: World, room: number): Monster[] {
  return Object.values(world.monsters).filter((m) => m.room === room);
}

// ---------------------------------------------------------------------------
// Hero helpers

/** Still in the dungeon: not dead and not escaped. */
export function inDungeon(h: Hero): boolean {
  return !h.dead && !h.extracted;
}

export function isConscious(h: Hero): boolean {
  return inDungeon(h) && h.downedAt === null;
}

/**
 * The dungeon takes light from a hero (what used to add stress: an ally falling, a Whisper, the Cursed Chest…; user,
 * 2026-10-14). A Ward Charm, Fever Charm or Penitent's Sackcloth scales it. Returns how much they lost.
 */
export function loseLight(h: Hero, amount: number): number {
  if (amount <= 0) return 0;
  const before = h.light;
  h.light = Math.max(0, h.light - amount * wornMult(h, 'lightLossMult'));
  return before - h.light;
}

/** A hero gains light (never past full). Returns how much they gained. */
export function gainLight(h: Hero, amount: number): number {
  const before = h.light;
  h.light = Math.max(0, Math.min(LIGHT_MAX, h.light + amount));
  return h.light - before;
}

/** A hero spends their own light (Kindle, Siphon, the Zealot's cards): no charm softens it. Returns how much went. */
export function spendLight(h: Hero, amount: number): number {
  const spent = Math.max(0, Math.min(h.light, amount));
  h.light -= spent;
  return spent;
}

/** Zealot's Fervour: +1% damage per point of light below full (twice that after the Zen Zenith). */
export function fervourOf(h: Hero): number {
  if (h.cls !== 'zealot') return 0;
  return (LIGHT_MAX - h.light) * CLASS_RULES.zealotDmgPerDark * (h.elite.zenith ? ELITE_EVENTS.zenithFervour : 1);
}

/** Weapon bonus (and the Zealot's Fervour, and the Effigy or Tome Rite): multiplies every bit of damage this hero deals. */
export function damageMult(h: Hero, _world?: World): number {
  const weapon = 1 + (h.weapon ? ITEMS[h.weapon].dmgPct ?? 0 : 0);
  return weapon * (1 + fervourOf(h)) * riteMult(h);
}

/** Effigy Rite: +20% damage and max HP; Tome Rite: −20%. */
export function riteMult(h: { rites: readonly string[] }): number {
  return (h.rites.includes('effigy') ? KIT_RULES.effigyMult : 1) * (h.rites.includes('tome') ? KIT_RULES.tomeMult : 1);
}


/** A hero's Block: what everything they wear adds up to (armour, a Quickblood Ring's −2…). Can be negative. */
export function heroBlock(h: Hero): number {
  return wornStat(h, 'block');
}

/** Thorn Ring: what a monster that lands a blow on this hero takes back (0 without one). */
export function thornsOf(h: Hero): number {
  const bonus = wornStat(h, 'thorns');
  return bonus > 0 ? bonus + Math.max(0, heroBlock(h)) : 0;
}

/**
 * Block: a flat reduction on any damage this hero takes, from any source. A hit always does at least 1; negative
 * Block (a Quickblood Ring) adds to every hit.
 */
export function afterBlock(h: Hero, dmg: number): number {
  if (dmg <= 0) return dmg;
  return Math.max(1, dmg - heroBlock(h));
}

export function reviveHero(h: Hero, fraction = REVIVE_HP_FRACTION, world?: World, by?: Hero) {
  h.downedAt = null;
  h.riseAt = null;
  if (world) world.stats.revives++;
  if (world) chronicle(world, by ? `${by.name} got ${h.name} back on their feet.` : `${h.name} got back up.`);
  h.hp = Math.max(1, Math.ceil(h.maxHp * fraction));
  // Open Coffin: they only lay down, so they get up no worse off than they were.
  if (h.restHp !== null) h.hp = Math.min(h.maxHp, Math.max(h.hp, h.restHp));
  h.restHp = null;
}

// ---------------------------------------------------------------------------
// Encounter lifecycle

/** A hero has arrived in a room (or is in one). Starts or joins a fight if monsters are present. */
export function onHeroInRoom(world: World, hero: Hero, room: number) {
  if (!inDungeon(hero) || hero.encounter !== null) return;
  if (monstersIn(world, room).length === 0) return;
  let enc = world.encounters[room];
  if (!enc) {
    if (unnoticed(world, room)) return;
    enc = { room, startedAt: world.time, heroes: [], next: {}, choices: {}, events: [], seq: 0, log: [], history: [], fought: [] };
    world.encounters[room] = enc;
    world.stats.fights++;
    // Everyone already standing here is pulled in, including the downed.
    for (const h of Object.values(world.heroes)) {
      if (inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room) enlist(world, enc, h);
    }
    enc.foes = monstersIn(world, room).map((m) => ENEMIES[m.type].name);
    enc.chron = world.chronicle.length;
    world.chronicle.push({ time: world.time, text: fightSummary(world, enc), fight: { room, lines: enc.history! } });
    say(world, enc, `Ambush! ${enc.foes.join(', ')}.`);
    for (const id of enc.heroes) onEnlist(world, enc, world.heroes[id]);
    const sneak = ambusher(world, enc);
    if (sneak) {
      enc.ambush = sneak.id;
      say(world, enc, `${sneak.name} is among them before they know it. Nothing moves until ${sneak.name} does.`);
    }
  } else {
    // Arriving in the same moment it began isn't late.
    if (!enc.heroes.includes(hero.id) && world.time > enc.startedAt) (enc.back ??= []).push(hero.id);
    // Someone else walked in: the Cutthroat's cover is blown.
    if (enc.ambush && enc.ambush !== hero.id) endAmbush(world, enc);
    enlist(world, enc, hero);
    say(world, enc, `${hero.name} joins the fight.`);
    if (enc.chron !== undefined) world.chronicle[enc.chron].text = fightSummary(world, enc);
    onEnlist(world, enc, hero);
  }
  startTimers(world, enc);
}

/**
 * Softstep Cloak: if everyone standing in this room is (or can now go) unnoticed, no fight starts. Cloaks only go
 * off when that spares the whole room; with anyone else noticed, the fight starts and the cloaked are drawn in.
 */
function unnoticed(world: World, room: number): boolean {
  const here = Object.values(world.heroes).filter((h) => isConscious(h) && h.pos.kind === 'room' && h.pos.room === room);
  if (!here.length || !here.every((h) => h.unnoticedIn === room || clothReady(h, 'softstep'))) return false;
  for (const h of here) {
    if (h.unnoticedIn === room) continue;
    spendCloth(h, clothReady(h, 'softstep')!);
    h.unnoticedIn = room;
    notify(world, h, 'Your softstep cloak hushes you: the monsters here have not noticed you.');
  }
  return true;
}

/** The Cutthroat's Stealth (M16, user): their light ÷ 15. Sneaking past needs it below every enemy's Speed. */
export function stealthOf(h: Pick<Hero, 'light'>): number {
  return h.light / CLASS_RULES.stealthPerLight;
}

/** A Sneaking hero alone in a fight that just started, whose Stealth is below every enemy's Speed: an Ambush. */
function ambusher(world: World, enc: Encounter): Hero | null {
  const standing = enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  if (standing.length !== 1 || !standing[0].sneaking) return null;
  const h = standing[0];
  return monstersIn(world, enc.room).every((m) => stealthOf(h) < monsterSpeed(enc, m)) ? h : null;
}

/** The Ambush is over (the Cutthroat acted, or someone else came in): every monster's timer starts now. */
function endAmbush(world: World, enc: Encounter) {
  if (!enc.ambush) return;
  delete enc.ambush;
  for (const m of monstersIn(world, enc.room)) {
    if (enc.next[m.id] === undefined) continue;
    enc.next[m.id] = at(world.time + monsterSpeed(enc, m, world.time));
    (enc.span ??= {})[m.id] = monsterSpeed(enc, m, world.time);
  }
}

/**
 * Sneak Past (M16, user): a Sneaking Cutthroat alone in a fight, on their first turn (or with a Smoke Bomb's charge),
 * flees by simply not being there: the fight ends and they stay in the room, unnoticed. `acting`: asked during that
 * turn (the turn already counts as taken).
 */
export function canSneakPast(world: World, enc: Encounter, h: Hero, acting = false): boolean {
  if (!h.sneaking || !isConscious(h)) return false;
  if (enc.heroes.some((id) => id !== h.id && isConscious(world.heroes[id]))) return false;
  return (enc.turns?.[h.id] ?? 0) <= (acting ? 1 : 0) || !!h.st.sneakPast;
}

/** The Bellwright gains Clang stacks (every card quicker); the timer starts over for all of them. */
export function addClang(h: Hero, stacks: number) {
  h.st.clang = { stacks: (h.st.clang?.stacks ?? 0) + stacks, turns: buffLength(h, CARD_RULES.clangTurns) };
}

/** What happens as a hero walks into a fight: Talents, Gear and the dead who follow them. */
function onEnlist(world: World, enc: Encounter, h: Hero) {
  if (!isConscious(h)) return;
  // Brigandine: into every fight behind a ready Shield.
  const start = wornStat(h, 'startShield');
  if (start > 0) h.st.shield = (h.st.shield ?? 0) + start;
  // Gravedigger: a Corpse lies ready for the Undertaker.
  if (hasTalent(h, 'gravedigger')) {
    for (let i = 0; i < TALENT_RULES.gravediggerCorpses; i++) (enc.slain ??= []).push({ type: 'ghoul', maxHp: ENEMIES.ghoul.maxHp, dmgMult: 1 });
    say(world, enc, `${h.name} has a grave ready. (+${TALENT_RULES.gravediggerCorpses} Corpse)`);
  }
  // Unholy Uprising: the Undertaker's dead come too (and Howl's wolves).
  if (h.legion.length) {
    // A Risen ally keeps its hero's id, so the fight screen can show what it does.
    for (const r of h.legion) (enc.legion ??= []).push({ ...r, id: r.hero ?? `r${world.nextId++}`, by: h.id });
    const dead = h.legion.filter((r) => r.type !== 'wolf');
    const wolves = h.legion.length - dead.length;
    if (dead.length) say(world, enc, `${h.name}'s dead shamble in behind them: ${dead.map((r) => risenName(world, r)).join(', ')}.`);
    if (wolves) say(world, enc, `${wolves > 1 ? `${wolves} wolves pad` : 'A wolf pads'} in at ${h.name}'s side.`);
    h.legion = [];
  }
}

/**
 * When a hero leaves a fight (or it ends), what fights for them goes with them: the Uprising's dead, Howl's wolves,
 * and (Restless Dead) what they Raised. What a card summoned for this fight only stays behind and is gone.
 */
function keepRisen(enc: Encounter, h: Hero) {
  if (enc.legion && inDungeon(h)) {
    const mine = enc.legion.filter((r) => r.by === h.id);
    // Like a monster's, its statuses end with the fight.
    for (const { id: _id, by: _by, st: _st, ...r } of mine) {
      if (r.hp <= 0 || r.summon) continue;
      // The Undertaker's following decays a little after every fight (every other one with Restless Dead).
      if (r.decay !== undefined) {
        r.age = (r.age ?? 0) + 1;
        if (!hasTalent(h, 'restlessDead') || r.age % 2 === 0) r.decay++;
      }
      h.legion.push(r);
    }
    enc.legion = enc.legion.filter((r) => r.by !== h.id);
  }
}

/** The Undertaker's following, wherever it is now: with him (between fights) or in his fight. */
export function followingOf(world: World, h: Hero): Risen[] {
  const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
  const here = (enc?.legion ?? []).filter((r) => r.by === h.id && r.hp > 0 && r.decay !== undefined);
  return [...(h.legion.filter((r) => r.decay !== undefined) as Risen[]), ...here];
}

/**
 * One more joins the Undertaker's following: past the cap, the most decayed (the oldest, if alike) crumbles away.
 * Returns the name of what crumbled, if anything did.
 */
export function makeRoom(world: World, h: Hero): string | null {
  const all = followingOf(world, h);
  if (all.length < CLASS_RULES.followingMax) return null;
  const worst = all.reduce((a, b) => ((b.decay ?? 0) > (a.decay ?? 0) ? b : a));
  const name = risenName(world, worst);
  const i = h.legion.indexOf(worst);
  if (i >= 0) h.legion.splice(i, 1);
  else {
    worst.hp = 0;
    for (const enc of Object.values(world.encounters)) delete enc.next[worst.id];
  }
  return name;
}

/** Decay's toll on one of the Undertaker's following: Speed added, Block lost. */
export function decayOf(r: Pick<Risen, 'decay'>): number {
  return r.decay ?? 0;
}

function enlist(world: World, enc: Encounter, h: Hero) {
  if (enc.heroes.includes(h.id)) return;
  // A new fight: once-a-fight pieces are ready again (not on leaving one, or Blinkcloth's slip would rearm it).
  chargesForFight(h);
  // A fresh shuffle of whatever isn't burned.
  dealDeck(h, world.rng);
  h.unnoticedIn = null;
  enc.heroes.push(h.id);
  if (enc.fought && !enc.fought.includes(h.id)) enc.fought.push(h.id);
  h.encounter = enc.room;
  h.path = [];
  h.heading = null;
  h.channel = null;
}

export function leaveEncounter(world: World, enc: Encounter, h: Hero) {
  keepRisen(enc, h);
  enc.heroes = enc.heroes.filter((id) => id !== h.id);
  unplace(enc, h.id);
  delete enc.choices[h.id];
  delete enc.next[h.id];
  resetAfterFight(h);
}

/**
 * Timed statuses carry on outside the fight (turn ones tick per field turn, clock ones on game time); what only means
 * something in a fight (Stun, Shield, Brace, Vigil, the next-card effects) ends with it. The cards are gathered up.
 * The Warden's Stalwart (M16): he keeps half his Shield.
 */
function resetAfterFight(h: Hero) {
  h.encounter = null;
  h.statusClock = 0;
  gatherDeck(h);
  const kept = h.cls === 'warden' && isConscious(h) ? Math.floor((h.st.shield ?? 0) * CLASS_RULES.stalwartKeep) : 0;
  const { poison, acid, hexed, weak, dodge, clang, doom, bleed, regen, slow, haste, gate, dance } = h.st;
  h.st = Object.fromEntries(Object.entries({ poison, acid, hexed, weak, dodge, clang, doom, bleed, regen, slow, haste, gate, dance }).filter(([, v]) => v !== undefined));
  if (kept > 0) h.st.shield = kept;
}

function endEncounter(world: World, enc: Encounter) {
  // Undying Flame: a fight that ends with every ally standing gives the Lampbearer their Dawn back.
  const standing = enc.heroes.every((id) => isConscious(world.heroes[id]));
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (standing && hasTalent(h, 'undyingFlame') && h.burned.includes('dawn')) {
      h.burned.splice(h.burned.indexOf('dawn'), 1);
      notify(world, h, 'The dawn kindles again in you. (Dawn is back in your deck)');
    }
  }
  // Unholy Uprising: fighting beside the restless dead wears on the living.
  const raisers = new Set((enc.legion ?? []).filter((r) => r.type !== 'wolf' && r.uprising).map((r) => r.by));
  for (const by of raisers) {
    for (const id of enc.heroes) {
      const o = world.heroes[id];
      if (!o || id === by || !inDungeon(o)) continue;
      const lost = Math.round(loseLight(o, ELITE_EVENTS.uprisingLight));
      if (lost > 0) notify(world, o, `The dead that fought beside you turn their empty eyes on you, and your lamp gutters. (−${lost} light)`);
    }
  }
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (h) keepRisen(enc, h);
    if (h) resetAfterFight(h);
  }
  closeFight(world, enc);
  for (const m of monstersIn(world, enc.room)) m.st = {};
  world.stats.fightTime += world.time - enc.startedAt;
  delete world.encounters[enc.room];
}

const OUTCOMES = {
  won: ['and won', 'The fight is won.'],
  fell: ['and fell', 'Nobody is left standing.'],
  fled: ['and got away', 'Everyone got away.'],
  some: ['and not everyone got away', 'The rest got away.'],
  collapsed: ['until the dungeon collapsed', 'The dungeon collapses.'],
} as const;

/** Write how a fight ended into its chronicle entry and play-by-play. */
function closeFight(world: World, enc: Encounter, collapsed = false) {
  const entry = enc.chron !== undefined ? world.chronicle[enc.chron] : undefined;
  if (!entry) return;
  const fought = (enc.fought ?? enc.heroes).map((id) => world.heroes[id]).filter(Boolean);
  // Got away: left the fight alive (the dead are dropped from it too).
  const away = fought.filter((h) => !enc.heroes.includes(h.id) && !h.dead).length;
  const outcome =
    collapsed ? 'collapsed'
    : monstersIn(world, enc.room).length === 0 ? 'won'
    : away === 0 ? 'fell'
    : away === fought.length ? 'fled' : 'some';
  say(world, enc, OUTCOMES[outcome][1]);
  entry.text = fightSummary(world, enc, `${OUTCOMES[outcome][0]} (${Math.round(world.time - enc.startedAt)}s)`);
  enc.chron = undefined;
}

/** The run is over: fights still going get their endings written too. */
export function closeFights(world: World) {
  for (const enc of Object.values(world.encounters)) closeFight(world, enc, world.phase === 'collapsed');
}

/** "Ann and Bob fought Ghoul ×2, Crawler in the Crypt", plus how it ended once it has. */
function fightSummary(world: World, enc: Encounter, end?: string): string {
  const names = (enc.fought ?? enc.heroes).map((id) => world.heroes[id]?.name ?? '?');
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'Nobody';
  const counts = new Map<string, number>();
  for (const f of enc.foes ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  const foes = [...counts].map(([f, n]) => (n > 1 ? `${f} ×${n}` : f)).join(', ');
  return `${who} fought ${foes} in ${theRoom(world.dungeon.rooms[enc.room].name)}${end ? `, ${end}` : ''}.`;
}

/** A line for the fight's live log and its full play-by-play. */
export function say(world: World, enc: Encounter, text: string) {
  enc.log.push(text);
  if (enc.log.length > 40) enc.log.splice(0, enc.log.length - 40);
  const h = enc.history;
  if (!h || h.length > HISTORY_CAP) return;
  h.push(h.length === HISTORY_CAP ? { t: h[h.length - 1].t, text: '…' } : { t: Math.round((world.time - enc.startedAt) * 10) / 10, text });
}

/** Turn times are kept to the millisecond, so units that should tie do tie. */
export const at = (t: number) => Math.round(t * 1000) / 1000;

/**
 * Give every standing unit without a timer a fresh one (a full Speed's wait), and drop the timers of
 * the downed (they get a fresh one when they're back up).
 */
export function startTimers(world: World, enc: Encounter) {
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (!isConscious(h)) delete enc.next[id];
    else if (enc.next[id] === undefined) {
      // Opening Act: the Cutthroat's first turn of the fight comes at half their Speed.
      const first = !(enc.opened ??= []).includes(id);
      if (first) enc.opened.push(id);
      const wait = speedOf(h, world.time) * (first && hasTalent(h, 'openingAct') ? TALENT_RULES.openingFraction : 1);
      enc.next[id] = at(world.time + wait);
      (enc.span ??= {})[id] = wait;
    }
  }
  for (const m of monstersIn(world, enc.room)) {
    if (enc.next[m.id] !== undefined) continue;
    enc.next[m.id] = at(world.time + monsterSpeed(enc, m));
    // Still reeling from the Toll.
    if ((m.dazedUntil ?? 0) > world.time) m.st.stun = true;
  }
  if (enc.risen) enc.next[enc.risen.id] ??= at(world.time + risenSpeed(world, enc.risen));
  for (const r of risenAll(enc)) enc.next[r.id] ??= at(world.time + risenSpeed(world, r));
}

/**
 * Heroes and monsters in the order the fight screen shows them, left to right, with the two sides
 * facing each other in the middle: the slowest of each side stands nearest the enemy.
 * Heroes go fastest → slowest, monsters slowest → fastest (ties: join order). The risen stand
 * nearest of all on the heroes' side (see `risenOf`). This is also who goes first when turns tie.
 * Heroes who joined after it began, or stepped back (A), stand at the back (leftmost), whatever their Speed: each
 * newcomer behind the last. Those who stepped to the front (D) stand nearest the enemy: each newcomer ahead of the last.
 */
export function combatOrder(world: World, enc: Encounter): { heroes: Hero[]; monsters: Monster[] } {
  const back = enc.back ?? [];
  const front = enc.front ?? [];
  const heroes = enc.heroes.filter((id) => !back.includes(id) && !front.includes(id)).map((id, i) => ({ h: world.heroes[id], s: speedOf(world.heroes[id], world.time), i }));
  const monsters = monstersIn(world, enc.room).map((m, i) => ({ m, s: monsterSpeed(enc, m), i }));
  return {
    heroes: [
      ...[...back].reverse().map((id) => world.heroes[id]),
      ...heroes.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.h),
      ...front.map((id) => world.heroes[id]),
    ],
    monsters: monsters.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.m),
  };
}

function unplace(enc: Encounter, id: string) {
  if (enc.back) enc.back = enc.back.filter((x) => x !== id);
  if (enc.front) enc.front = enc.front.filter((x) => x !== id);
}

/**
 * Step to the very front of the heroes' side (D: nearest the enemy) or the very back (A), there and then, without
 * spending your turn. Nothing happens if you're already there or the only hero in the fight.
 */
export function stepToEnd(world: World, h: Hero, to: 'front' | 'back') {
  const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
  if (!enc || !enc.heroes.includes(h.id) || !isConscious(h)) return;
  const order = combatOrder(world, enc).heroes;
  if (order.length < 2 || (to === 'front' ? order.at(-1) : order[0]) === h) return;
  unplace(enc, h.id);
  (to === 'front' ? (enc.front ??= []) : (enc.back ??= [])).push(h.id);
  record(world, enc, [{ actor: h.id, kind: 'status', text: `${h.name} steps to the ${to}.` }]);
}

/** The risen ally in this fight, if it's still standing. */
export function risenOf(enc: Encounter): Risen | null {
  return enc.risen && enc.risen.hp > 0 && enc.risen.turns > 0 ? enc.risen : null;
}

/** "Risen Ghoul", or a Risen ally's own name ("Risen Mara"). Howl's wolves are just "Wolf". */
export function risenName(world: World, r: Pick<Risen, 'type' | 'hero'>): string {
  // Howl's wolves and what cards summon (Rats, Shades, Imps) are just themselves.
  if (r.type && ENEMIES[r.type].ally) return ENEMIES[r.type].name;
  return `Risen ${r.hero ? world.heroes[r.hero]?.name ?? 'ally' : ENEMIES[r.type!].name}`;
}

/** A risen monster keeps its old Speed (slower as it decays); a Risen ally has its hero's (gear included). */
export function risenSpeed(world: World, r: Pick<Risen, 'type' | 'hero' | 'decay'>): number {
  const h = r.hero ? world.heroes[r.hero] : undefined;
  return h ? speedOf(h, world.time) : ENEMIES[r.type!].speed + decayOf(r) * CLASS_RULES.decaySpeed;
}

/** Every risen ally still standing here: the Uprising's dead, then the one Raised (nearest the enemy). */
/** Where a risen keeps its statuses: a Risen ally on its hero, the rest on themselves. */
export function risenSt(world: World, r: Risen): Statuses {
  const ally = r.hero ? world.heroes[r.hero] : undefined;
  return ally ? ally.st : (r.st ??= {});
}

export function risenAll(enc: Encounter): Risen[] {
  const r = risenOf(enc);
  return [...(enc.legion ?? []).filter((x) => x.hp > 0), ...(r ? [r] : [])];
}

export function tickCombat(world: World) {
  for (const enc of Object.values(world.encounters)) {
    // Bounded: each pass either takes a turn (pushing that unit's timer a full Speed later) or stops.
    for (let guard = 0; guard < 64; guard++) {
      if (monstersIn(world, enc.room).length === 0 || !enc.heroes.some((id) => isConscious(world.heroes[id]))) {
        endEncounter(world, enc);
        break;
      }
      startTimers(world, enc);
      const unit = nextUp(world, enc);
      if (!unit) break;
      takeTurn(world, enc, unit);
    }
  }
}

export type Unit = { kind: 'hero'; h: Hero } | { kind: 'monster'; m: Monster } | { kind: 'risen'; r: Risen };

export function unitId(u: Unit): string {
  return u.kind === 'hero' ? u.h.id : u.kind === 'monster' ? u.m.id : u.r.id;
}

/**
 * The unit whose turn is due soonest (and is due now, unless `anyTime`: the timeline looks ahead).
 * Ties go to heroes before monsters, left to right.
 */
export function nextUp(world: World, enc: Encounter, anyTime = false): Unit | null {
  const { heroes, monsters } = combatOrder(world, enc);
  const units: (Unit & { t: number | undefined })[] = [
    ...heroes.filter(isConscious).map((h) => ({ kind: 'hero' as const, h, t: enc.next[h.id] })),
    ...risenAll(enc).map((r) => ({ kind: 'risen' as const, r, t: enc.next[r.id] })),
    ...monsters.map((m) => ({ kind: 'monster' as const, m, t: enc.next[m.id] })),
  ];
  let best: (typeof units)[number] | null = null;
  for (const u of units) {
    if (u.t === undefined || (!anyTime && u.t > world.time + 1e-9)) continue;
    // An Ambush: the monsters haven't noticed yet.
    if (enc.ambush && u.kind === 'monster') continue;
    if (!best || u.t < best.t!) best = u; // strict, so the earlier unit in the order wins a tie
  }
  return best;
}

// ---------------------------------------------------------------------------
// Choices

/** Ids of units this hero could aim `choice` at (a card's or a revive's), or [] if it needs no target. */
export function validTargets(world: World, enc: Encounter, h: Hero, choice: Pick<Choice, 'action' | 'card'>): string[] {
  if (choice.action === 'revive') return enc.heroes.map((id) => world.heroes[id]).filter((x) => !x.dead && x.downedAt !== null).map((x) => x.id);
  if (choice.action !== 'card' || !choice.card) return [];
  switch (CARDS[choice.card].target) {
    case 'enemy':
      return monstersIn(world, enc.room).map((m) => m.id);
    case 'ally':
      return enc.heroes.map((id) => world.heroes[id]).filter(isConscious).map((x) => x.id);
    default:
      return [];
  }
}

/** Does this move need a unit picked (a room for Waystep is picked on the map instead)? */
export function needsTarget(choice: Pick<Choice, 'action' | 'card'>): boolean {
  if (choice.action === 'revive') return true;
  if (choice.action !== 'card' || !choice.card) return false;
  const t = CARDS[choice.card].target;
  return t === 'enemy' || t === 'ally';
}

/** The cards in this hero's hand (empty outside a fight). */
export function handOf(h: Hero): CardId[] {
  return h.deck?.hand ?? [];
}

/**
 * What a hero does if their turn comes before they've picked: the leftmost card in hand that isn't a Burn (nor
 * Waystep, which needs a room) and would do something useful, aimed sensibly: the frontmost enemy for attacks, the
 * most hurt ally for help. Failing that, the leftmost that isn't a Burn; only a hand of nothing else plays one.
 * Null only with an empty hand (then they brace).
 */
export function defaultChoice(world: World, enc: Encounter, h: Hero): Choice | null {
  const hand = handOf(h);
  const plain = (c: CardId) => !CARDS[c].burn && CARDS[c].target !== 'room';
  const card = hand.find((c) => plain(c) && !uselessReason(world, enc, h, c)) ?? hand.find(plain) ?? hand.find((c) => CARDS[c].target !== 'room') ?? hand[0];
  if (!card) return null;
  const choice: Choice = { action: 'card', card };
  const target = CARDS[card].target;
  if (target === 'room') return { ...choice, room: world.dungeon.exit };
  if (!needsTarget(choice)) return choice;
  const targets = validTargets(world, enc, h, choice);
  if (targets.length === 0) return choice;
  if (target === 'ally') {
    const hurt = targets.map((id) => world.heroes[id]).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    return { ...choice, target: hurt.id };
  }
  // A single foe: the frontmost one, nearest the heroes (user, 2026-10-12; was a random one).
  const front = combatOrder(world, enc).monsters.find((m) => targets.includes(m.id));
  return { ...choice, target: front?.id ?? targets[0] };
}

/** Returns an error string, or null if the choice was accepted. */
export function submitChoice(world: World, h: Hero, choice: Choice): string | null {
  const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
  if (!enc) return 'Not in a fight.';
  if (!enc.heroes.includes(h.id) || !isConscious(h)) return 'You cannot act.';
  if (choice.action === 'item') {
    const idx = choice.item ?? -1;
    const def = ITEMS[h.items[idx]];
    if (!def) return 'No such item.';
    if (h.rites.includes('gem') && def.kind === 'consumable') return 'The Gem Rite forbids it.';
    if (!def.combat) return `${def.name} can't be used in a fight.`;
    if (def.target === 'ally' || def.target === 'downed') {
      const targets = itemTargets(world, h, idx);
      if (targets.length === 0) return 'No valid target.';
      // No target yet is fine: if the turn comes first, it goes to the leftmost one.
      if (choice.target !== undefined && !targets.includes(choice.target)) return 'Pick a valid target.';
    }
    enc.choices[h.id] = { action: 'item', item: idx, target: def.target === 'ally' || def.target === 'downed' ? choice.target : undefined };
    return null;
  }
  if (choice.action === 'card') {
    if (!isCardId(choice.card) || !handOf(h).includes(choice.card)) return "That card isn't in your hand.";
    const def = CARDS[choice.card];
    if (def.target === 'room') {
      if (choice.room === undefined) return 'Pick a room on your map.';
      if (!world.dungeon.rooms[choice.room] || !h.seen.includes(choice.room)) return "You don't know that room.";
      if (choice.room === enc.room) return 'You are already there.';
      enc.choices[h.id] = { action: 'card', card: choice.card, room: choice.room };
      return null;
    }
    if (needsTarget(choice)) {
      const targets = validTargets(world, enc, h, choice);
      if (choice.target !== undefined && !targets.includes(choice.target)) return 'Pick a valid target.';
    }
    enc.choices[h.id] = { action: 'card', card: choice.card, target: needsTarget(choice) ? choice.target : undefined };
    return null;
  }
  if (choice.action === 'revive') {
    const targets = validTargets(world, enc, h, choice);
    if (targets.length === 0) return 'Nobody here is down.';
    if (choice.target !== undefined && !targets.includes(choice.target)) return 'Pick a valid target.';
  }
  enc.choices[h.id] = { action: choice.action, target: choice.action === 'revive' ? choice.target : undefined };
  return null;
}

// ---------------------------------------------------------------------------
// Resolution

export function takeTurn(world: World, enc: Encounter, unit: Unit) {
  const events: CombatEvent[] = [];
  const id = unitId(unit);
  (enc.turns ??= {})[id] = (enc.turns[id] ?? 0) + 1;
  if (unit.kind === 'hero') {
    // A hero's next action comes when the card (or action) they play says: heroTurn sets it.
    heroTurn(world, enc, unit.h, events);
  } else if (unit.kind === 'monster') {
    enc.next[unit.m.id] = at(enc.next[unit.m.id] + monsterSpeed(enc, unit.m, world.time));
    monsterTurn(world, enc, unit.m, events);
  } else {
    enc.next[unit.r.id] = at(enc.next[unit.r.id] + risenSpeed(world, unit.r));
    risenTurn(world, enc, unit.r, events);
  }
  record(world, enc, events);
}

/** Add what just happened to the fight's event list and log. */
export function record(world: World, enc: Encounter, events: CombatEvent[]) {
  for (const e of events) e.seq = ++enc.seq;
  enc.events.push(...events);
  if (enc.events.length > 30) enc.events.splice(0, enc.events.length - 30);
  for (const e of events) say(world, enc, e.text);
}

/** Effects that last "until X's next turn" end as X's turn begins. */
function endLingering(world: World, enc: Encounter, id: string) {
  for (const hid of enc.heroes) {
    const st = world.heroes[hid].st;
    if (st.vigil !== id) continue;
    if (st.vigilMore) st.vigilMore--;
    else delete st.vigil;
  }
}

/**
 * Poison and status timers, at the end of a unit's own turn. Every Poison ticks on its own (its own damage,
 * its own countdown); `adjust` turns each tick into the damage actually taken (Block, Acid). Stops if the unit dies.
 */
function endOfTurn(st: Statuses, name: string, id: string, adjust: (n: number) => number, hurt: (n: number) => boolean, events: CombatEvent[]) {
  for (const b of [...(st.poison ?? [])]) {
    const dmg = adjust(b.dmg);
    events.push({ actor: id, kind: 'damage', target: id, amount: dmg, text: `${name} takes ${dmg} poison damage.` });
    b.rounds--;
    if (st.poison) st.poison = st.poison.filter((x) => x.rounds > 0);
    if (st.poison?.length === 0) delete st.poison;
    if (!hurt(dmg)) return;
  }
  if (st.weak && --st.weak.turns <= 0) {
    if (--st.weak.stacks <= 0) delete st.weak;
    else st.weak.turns = CARD_RULES.witherTurns;
  }
  if (st.acid && --st.acid.turns <= 0) {
    if (--st.acid.stacks <= 0) delete st.acid;
    else st.acid.turns = CARD_RULES.acidTurns;
  }
  if (st.hexed) {
    st.hexed = st.hexed.map((n) => n - 1).filter((n) => n > 0);
    if (st.hexed.length === 0) delete st.hexed;
  }
}

/** Wither: each stack halves the damage a unit deals. */
export function weakMult(st: Statuses): number {
  return 0.5 ** (st.weak?.stacks ?? 0);
}

/** Is this unit in smoke (or otherwise dodging half of what comes at it) right now? */
export function inSmoke(world: World, st: Statuses): boolean {
  return st.dodge !== undefined && st.dodge > world.time;
}

/** Does fleeing always work for this unit right now (Smoke Bomb)? */
export function sureFlee(world: World, st: Statuses): boolean {
  return st.fleeSure !== undefined && st.fleeSure > world.time;
}

/** A turn passing outside a fight: statuses tick as they would in one, Poison included. */
export function fieldTurn(world: World, h: Hero) {
  fieldTurnStart(h);
  fieldTurnEnd(world, h);
}

/** Before a field turn's action, as in a fight: Vengeance and Clang tick. */
export function fieldTurnStart(h: Hero) {
  startOfTurn(h.st);
}

/** After a field turn's action, as in a fight: Poison bites and Weak/Acid/Hexed count down (so a Bandage cures first). */
export function fieldTurnEnd(world: World, h: Hero) {
  if (!isConscious(h)) return;
  const events: CombatEvent[] = [];
  endOfTurn(h.st, h.name, h.id, (n) => heroDot(h, n), (n) => {
    if (hurtHero(world, h, n, null)) notify(world, h, `You take ${n} poison damage.`);
    return isConscious(h);
  }, events);
  fadeDoom(h.st);
}

/** A Poison or Bleed tick on a hero: Drakehide halves it, then Block and Doom as any blow. */
function heroDot(h: Hero, n: number): number {
  return afterBlock(h, Math.max(1, Math.round(n * (wornStat(h, 'dotMult') || 1)))) + doomOf(h);
}

/** Statuses of a hero's own that tick at the start of their turn. */
function startOfTurn(st: Statuses) {
  if (st.clang && --st.clang.turns <= 0) {
    if (--st.clang.stacks <= 0) delete st.clang;
    else st.clang.turns = CARD_RULES.clangTurns;
  }
}

/** The extra damage Doom adds to each hit on this hero. */
export function doomOf(h: Hero): number {
  return (h.st.doom ?? 0) * CR_RULES.doom;
}

/** One Doom stack fades (the end of a turn with no Lich standing in their fight). */
function fadeDoom(st: Statuses) {
  if (st.doom !== undefined && --st.doom <= 0) delete st.doom;
}

/** Anything that ticks per turn outside a fight. */
function hasFieldTimers(h: Hero): boolean {
  const st = h.st;
  return !!(st.poison || st.acid || st.hexed || st.weak || st.clang || st.doom);
}

/** While channelling (digging, reviving) outside a fight, each Speed's worth of time ticks statuses as a turn would. */
export function tickFieldTurns(world: World, h: Hero, dt: number) {
  if (!hasFieldTimers(h)) {
    h.statusClock = 0;
    return;
  }
  h.statusClock += dt;
  const speed = speedOf(h, world.time);
  while (h.statusClock >= speed - 1e-6 && isConscious(h)) {
    h.statusClock -= speed;
    fieldTurn(world, h);
  }
}

/**
 * Clock statuses (M15), every tick, for every hero in the dungeon and every monster in a fight: Bleed and Regen tick
 * each CARD_RULES.pulse seconds, and anything whose time is up ends.
 */
export function tickClocks(world: World) {
  const now = world.time;
  for (const h of Object.values(world.heroes)) {
    if (!isConscious(h)) continue;
    const st = h.st;
    const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
    const events: CombatEvent[] = [];
    for (const b of [...(st.bleed ?? [])]) {
      while (b.next <= now && b.next <= b.until + 1e-6 && isConscious(h)) {
        b.next += CARD_RULES.pulse;
        const dmg = heroDot(h, b.dmg);
        if (hurtHero(world, h, dmg, events, enc) && !enc) notify(world, h, `You bleed for ${dmg}.`);
        events.push({ actor: h.id, kind: 'damage', target: h.id, amount: dmg, text: `${h.name} bleeds for ${dmg}.` });
      }
    }
    if (st.bleed) {
      st.bleed = st.bleed.filter((b) => b.until > now);
      if (!st.bleed.length) delete st.bleed;
    }
    const r = st.regen;
    if (r) {
      while (r.next <= now && r.next <= r.until + 1e-6) {
        r.next += CARD_RULES.pulse;
        const healed = heal(h, r.amount);
        if (healed && enc) events.push({ actor: h.id, kind: 'heal', target: h.id, amount: healed, text: `${h.name} regenerates ${healed}.` });
      }
      if (r.until <= now) delete st.regen;
    }
    if (st.haste && st.haste.until <= now) delete st.haste;
    if (st.slow && st.slow.until <= now) delete st.slow;
    if (st.gate !== undefined && st.gate <= now) delete st.gate;
    if (st.dance !== undefined && st.dance <= now) delete st.dance;
    if (enc && events.length) record(world, enc, events);
  }
  for (const enc of Object.values(world.encounters)) {
    const events: CombatEvent[] = [];
    for (const m of monstersIn(world, enc.room)) {
      for (const b of [...(m.st.bleed ?? [])]) {
        while (b.next <= now && b.next <= b.until + 1e-6 && world.monsters[m.id]) {
          b.next += CARD_RULES.pulse;
          tickOn(world, m, b.dmg, events, 'bleeding');
        }
      }
      if (m.st.bleed) {
        m.st.bleed = m.st.bleed.filter((b) => b.until > now);
        if (!m.st.bleed.length) delete m.st.bleed;
      }
      if (m.st.slow && m.st.slow.until <= now) delete m.st.slow;
    }
    // Regen an "every ally" card left on the risen (a Risen ally's is on its hero, who isn't conscious to tick it).
    for (const r of risenAll(enc)) {
      const st = risenSt(world, r);
      const g = st.regen;
      if (!g) continue;
      while (g.next <= now && g.next <= g.until + 1e-6) {
        g.next += CARD_RULES.pulse;
        const healed = heal(r, g.amount);
        if (healed) events.push({ actor: r.id, kind: 'heal', target: r.id, amount: healed, text: `${risenName(world, r)} regenerates ${healed}.` });
      }
      if (g.until <= now) delete st.regen;
    }
    if (events.length) record(world, enc, events);
  }
}

/** Add a Poison alongside any already running. */
export function addPoison(st: Statuses, dmg: number, rounds: number) {
  (st.poison ??= []).push({ dmg, rounds });
}

/** A monster's Speed in this fight: the Dead King's Charges quicken every monster in it; Slow drags it out. */
export function monsterSpeed(enc: Encounter | undefined, m: Monster, now?: number): number {
  const base = Math.max(MIN_SPEED, ENEMIES[m.type].speed + carried(m, 'speed'));
  const haste = (enc?.charge ?? 0) * KING_RULES.chargeHaste;
  const speed = haste ? Math.max(Math.min(base, KING_RULES.speedFloor), base - haste) : base;
  const slow = now !== undefined && m.st.slow && m.st.slow.until > now ? m.st.slow.amount : 0;
  return speed + slow;
}

/**
 * A monster's Block right now: its kind's, plus the Dead King's 3 for every other monster still standing beside
 * him, minus 2 per stack of Acid and 1 per wolf bite (or Shatter) this fight (`sunder`). Can go below 0.
 */
export function monsterBlock(world: World, m: Monster): number {
  let block = ENEMIES[m.type].block + carried(m, 'block') - (m.st.acid?.stacks ?? 0) * CARD_RULES.acidBonus - (m.st.sunder ?? 0);
  if (m.type === 'king' && m.room >= 0) block += KING_RULES.blockPerCourtier * monstersIn(world, m.room).filter((o) => o !== m).length;
  return block;
}

/** A number from the Gear a straggler carries (0 for anything else). Staves, Cloth and Legendaries do nothing for it. */
export function carried(m: Monster, key: 'speed' | 'block' | 'maxHp' | 'thorns' | 'dmgPct' | 'flatDmg'): number {
  return m.carry && isGear(m.carry) ? ITEMS[m.carry][key] ?? 0 : 0;
}

/** A straggler picks something up: Gear with max HP adds it at once. */
export function carryItem(m: Monster, item: ItemId) {
  m.carry = item;
  const hp = carried(m, 'maxHp');
  m.maxHp = Math.max(1, m.maxHp + hp);
  m.hp = Math.max(1, Math.min(m.maxHp, m.hp + hp));
}

/** A monster's blow of `base` before the hero's defences: its scaling, then a carried weapon's (hammer first). */
function monsterBlow(m: Monster, base: number): number {
  return (base + carried(m, 'flatDmg')) * m.dmgMult * (1 + carried(m, 'dmgPct'));
}

/** What a monster actually takes from a hit of `dmg`: its Block takes some off (at least 1 gets through) or, below 0, adds to it. */
export function monsterTakes(world: World, m: Monster, dmg: number): number {
  const taken = dmg > 0 ? Math.max(1, dmg - monsterBlock(world, m)) : dmg;
  return Math.round(taken * witchwoodMult(m.st));
}

/** What a risen takes from a blow: a Risen ally's own Block counts, a risen monster's its kind's. */
export function risenTakes(world: World, r: Risen, dmg: number): number {
  const ally = r.hero ? world.heroes[r.hero] : undefined;
  if (ally) return afterBlock(ally, dmg);
  // Decay eats its Block, past nothing: then every blow lands harder.
  return Math.max(1, dmg - (ENEMIES[r.type!].block - decayOf(r) * CLASS_RULES.decayBlock));
}

function heroTurn(world: World, enc: Encounter, h: Hero, events: CombatEvent[]) {
  world.stats.turns++;
  endLingering(world, enc, h.id);
  delete h.st.brace;
  delete h.st.sidestep;
  delete h.st.spikes;
  delete h.st.thornwall;
  const { choice, auto } = resolveChoice(world, enc, h);
  delete enc.choices[h.id];
  if (auto) events.push({ actor: h.id, kind: 'info', text: choice.card ? `${h.name} hesitates, then plays ${CARDS[choice.card].name}.` : `${h.name} hesitates and braces.` });
  startOfTurn(h.st);
  if (!lichAura(world, enc, h, events)) return;
  let wait: number;
  if (h.st.stun) {
    h.st.stun = false;
    wait = CARD_RULES.stunnedTime;
    events.push({ actor: h.id, kind: 'status', text: `${h.name} is stunned!` });
  } else {
    wait = heroAct(world, enc, h, choice, events);
  }
  // The Ambush ends with the Cutthroat's first action: now the monsters notice.
  if (enc.ambush === h.id) endAmbush(world, enc);
  if (isConscious(h) && h.encounter === enc.room) {
    enc.next[h.id] = at(world.time + wait);
    (enc.span ??= {})[h.id] = Math.max(wait, 0.1);
    endOfTurn(h.st, h.name, h.id, (n) => heroDot(h, n), (n) => {
      applyHeroDamage(world, enc, h, n, events);
      return isConscious(h);
    }, events);
    // Doom holds while a Lich still stands here.
    if (!monstersIn(world, enc.room).some((m) => m.type === 'lich')) fadeDoom(h.st);
  }
}

/**
 * What a hero will do when their turn comes: their pick (aimed at the leftmost target if they picked none), or, if they
 * haven't picked or the card has left their hand, their default (`auto`), Brace with an empty hand.
 */
export function resolveChoice(world: World, enc: Encounter, h: Hero): { choice: Choice; auto: boolean } {
  let choice: Choice | undefined = enc.choices[h.id];
  // The card left the hand since it was picked (Lucky Break, a Loom…): fall back like an undecided hero.
  if (choice?.action === 'card' && (!choice.card || !handOf(h).includes(choice.card))) choice = undefined;
  if (!choice) return { choice: defaultChoice(world, enc, h) ?? { action: 'brace' }, auto: true };
  if (choice.target === undefined && choice.room === undefined) {
    // Picked a move but not who to aim it at: it goes to the leftmost target on the fight screen.
    const target = leftmostTarget(world, enc, h, choice);
    if (target) choice = { ...choice, target };
  }
  return { choice, auto: false };
}

/**
 * The Lich's aura: before a hero acts, every Lich in the fight hurts them. It can't be dodged or braced; Block
 * takes from it as usual, and darkness, Weak and Doom change it like any blow. Returns false if it took them down.
 */
function lichAura(world: World, enc: Encounter, h: Hero, events: CombatEvent[]): boolean {
  for (const m of monstersIn(world, enc.room)) {
    if (m.type !== 'lich' || !isConscious(h)) continue;
    let dmg = ENEMIES.lich.dmg * m.dmgMult;
    dmg *= weakMult(m.st);
    if (h.light <= 0) dmg *= 1.25;
    dmg = afterBlock(h, Math.max(1, Math.round(dmg))) + doomOf(h);
    if (h.st.shield) {
      const absorbed = Math.min(h.st.shield, dmg);
      h.st.shield -= absorbed;
      dmg -= absorbed;
      if (h.st.shield <= 0) delete h.st.shield;
    }
    events.push({
      actor: m.id, kind: 'damage', target: h.id, amount: dmg,
      text: dmg > 0 ? `The Lich's cold presence sears ${h.name} for ${dmg}.` : `The Lich's cold presence washes over ${h.name}, but their Shield soaks it up.`,
    });
    applyHeroDamage(world, enc, h, dmg, events);
  }
  return isConscious(h) && h.encounter === enc.room;
}

/** The first unit, left to right as the fight screen shows them, that `choice` could be aimed at. */
function leftmostTarget(world: World, enc: Encounter, h: Hero, choice: Choice): string | undefined {
  let targets: string[];
  if (choice.action === 'item') {
    const def = ITEMS[h.items[choice.item ?? -1]];
    targets = def && (def.target === 'ally' || def.target === 'downed') ? itemTargets(world, h, choice.item!) : [];
  } else {
    targets = needsTarget(choice) ? validTargets(world, enc, h, choice) : [];
  }
  if (targets.length === 0) return undefined;
  const order = combatOrder(world, enc);
  const left = [...order.heroes.map((x) => x.id), ...order.monsters.map((m) => m.id)];
  const rank = (id: string) => (left.includes(id) ? left.indexOf(id) : Infinity);
  return [...targets].sort((a, b) => rank(a) - rank(b))[0];
}

function monsterTurn(world: World, enc: Encounter, m: Monster, events: CombatEvent[]) {
  endLingering(world, enc, m.id);
  if (m.st.stun) {
    m.st.stun = false;
    events.push({ actor: m.id, kind: 'status', text: `${ENEMIES[m.type].name} is stunned!` });
  } else {
    monsterAct(world, enc, m, events);
    if (world.monsters[m.id]) m.st.acted = true;
    vigilFlares(world, enc, events);
  }
  if (world.monsters[m.id]) {
    endOfTurn(m.st, ENEMIES[m.type].name, m.id, (n) => monsterTakes(world, m, n), (n) => {
      applyMonsterDamage(world, m, n, events);
      return !!world.monsters[m.id];
    }, events);
  }
}

/** The risen fight the monsters with their old attacks, then crumble when their turns run out. */
function risenTurn(world: World, enc: Encounter, r: Risen, events: CombatEvent[]) {
  const ally = r.hero ? world.heroes[r.hero] : undefined;
  if (ally) return risenAllyTurn(world, enc, ally, events);
  const name = risenName(world, r);
  const foes = combatOrder(world, enc).monsters;
  if (foes.length) {
    const dmg = Math.max(1, Math.round(ENEMIES[r.type!].dmg * r.dmgMult));
    const hit = (m: Monster, verb: string) => {
      const taken = monsterTakes(world, m, dmg);
      events.push({ actor: r.id, kind: 'damage', target: m.id, amount: taken, text: `${name} ${verb} ${ENEMIES[m.type].name} for ${taken}.` });
      applyMonsterDamage(world, m, taken, events);
    };
    switch (r.type) {
      case 'crawler': {
        const m = world.rng.pick(foes);
        hit(m, 'bites');
        if (world.monsters[m.id]) addPoison(m.st, 1, 3);
        break;
      }
      case 'giant':
        for (const m of foes.slice(0, 2)) hit(m, 'slams');
        break;
      case 'acolyte':
        hit(foes[foes.length - 1], 'curses');
        break;
      case 'wolf': {
        // Howl's wolves: each bite costs its target 1 Block until the fight ends.
        const m = foes[0];
        hit(m, 'bites');
        if (world.monsters[m.id]) m.st.sunder = (m.st.sunder ?? 0) + 1;
        break;
      }
      case 'imp': {
        // Bound Familiar: the imp's bite curses.
        const m = foes[0];
        hit(m, 'bites');
        if (world.monsters[m.id]) (m.st.hexed ??= []).push(CARD_RULES.hexedTurns);
        break;
      }
      case 'rat':
        hit(foes[0], 'bites');
        break;
      default:
        hit(foes[0], 'claws');
    }
  }
  if (!r.permanent && --r.turns <= 0 && r.hp > 0) {
    events.push({ actor: r.id, kind: 'death', target: r.id, text: `${name} crumbles back into dust.` });
    r.hp = 0;
    delete enc.next[r.id];
  }
}

/**
 * A Risen ally plays its hero's deck as an undecided hero would (the leftmost card that isn't a Burn, aimed as the
 * default would), with their gear and Speed. Nobody steers it, and it never uses items or flees.
 */
function risenAllyTurn(world: World, enc: Encounter, dead: Hero, events: CombatEvent[]) {
  startOfTurn(dead.st);
  if (!dead.deck) dealDeck(dead, world.rng);
  const choice = defaultChoice(world, enc, dead);
  if (choice?.card) playHand(world, enc, dead, choice, events);
  else events.push({ actor: dead.id, kind: 'info', text: `Risen ${dead.name} stands, waiting.` });
}

/** Play a card from the hand: it leaves the hand, does what it does, then goes to the discard (or burns). Returns its time. */
function playHand(world: World, enc: Encounter, h: Hero, c: Choice, events: CombatEvent[]): number {
  const card = c.card!;
  const wait = cardTime(world, enc, h, card, true);
  const prev = h.deck?.last ?? null;
  takeFromHand(h, card);
  const ctx = playCard(world, enc, h, card, c.target, c.room, events, 1, prev);
  settleCard(h, card, world.rng);
  (enc.played ??= {})[h.id] = (enc.played[h.id] ?? 0) + 1;
  // Echo repeats the last card that can be repeated.
  if (!CARDS[card].burn && card !== 'echo' && card !== 'fumble' && CARDS[card].target !== 'room') h.lastCard = card;
  const schools = CARDS[card].schools;
  // Shieldwall: every Guard card the Warden plays makes the nearest enemy reel.
  if (schools.includes('guard') && hasTalent(h, 'shieldwall') && h.encounter === enc.room) {
    const m = combatOrder(world, enc).monsters[0];
    if (m && enc.next[m.id] !== undefined) {
      enc.next[m.id] = at(enc.next[m.id] + TALENT_RULES.shieldwallDelay + wornStat(h, 'delayBonus'));
      events.push({ actor: h.id, kind: 'status', target: m.id, text: `${ENEMIES[m.type].name} staggers back from the shieldwall.` });
    }
  }
  // Carillon: a Hinder card rings on into the Bellwright's next one.
  if (schools.includes('hinder') && hasTalent(h, 'carillon')) h.st.quick = { ...(h.st.quick ?? { cut: 0 }), cut: (h.st.quick?.cut ?? 0) + TALENT_RULES.carillonCut };
  return Math.max(0, wait - ctx.selfHurry);
}

/** Do what the hero picked. Returns the seconds until their next action. */
function heroAct(world: World, enc: Encounter, h: Hero, c: Choice, events: CombatEvent[]): number {
  const rng = world.rng;
  const enemies = () => monstersIn(world, enc.room);

  if (c.action === 'brace') {
    h.st.brace = true;
    events.push({ actor: h.id, kind: 'info', text: `${h.name} braces.` });
    return actionTime(h, 'brace');
  }
  if (c.action === 'flee') {
    // Sneak Past: the fight simply never happens for them, and they stay where they are, unnoticed.
    if (canSneakPast(world, enc, h, true)) {
      delete enc.ambush;
      leaveEncounter(world, enc, h);
      h.unnoticedIn = enc.room;
      events.push({ actor: h.id, kind: 'flee', text: `${h.name} slips past unseen.` });
      notify(world, h, 'You slip past them, unseen. They don’t know you’re here: turn Sneak off (or let someone walk in) and the fight is on.');
      return actionTime(h, 'flee');
    }
    if (sureFlee(world, h.st) || rng.chance(FLEE_CHANCE)) {
      if (enc.room === world.dungeon.exit) {
        leaveEncounter(world, enc, h);
        extractHero(world, h);
        events.push({ actor: h.id, kind: 'flee', text: `${h.name} escapes through the exit!` });
        return actionTime(h, 'flee');
      }
      flee(world, enc, h);
      loseLight(h, LIGHT_LOSS.flee);
      events.push({ actor: h.id, kind: 'flee', text: `${h.name} flees!` });
    } else {
      events.push({ actor: h.id, kind: 'info', text: `${h.name} tries to flee, but is cut off!` });
    }
    return actionTime(h, 'flee');
  }
  if (c.action === 'item') {
    const idx = c.item ?? -1;
    const item = h.items[idx];
    const doubled = h.elixir; // applyItem uses it up
    const result = applyItem(world, h, idx, c.target);
    if (result.startsWith('!')) {
      events.push({ actor: h.id, kind: 'info', text: `${h.name} fumbles in their pack.` });
      return actionTime(h, 'item');
    }
    if (item === 'firebomb') {
      events.push({ actor: h.id, kind: 'status', text: result });
      for (const m of enemies()) heroHits(world, enc, h, m, doubled ? 16 : 8, events, 'Firebomb');
    } else {
      const t = c.target ?? h.id;
      events.push({ actor: h.id, kind: item === 'bandage' || item === 'salts' ? 'heal' : 'status', target: t, text: result });
    }
    // Volatile: every flask the Alchemist opens in a fight sets off a Catalyst.
    if (hasTalent(h, 'volatile') && enemies().length) playCard(world, enc, h, 'catalyst', undefined, undefined, events);
    return actionTime(h, 'item');
  }
  if (c.action === 'revive') {
    const t = c.target ? world.heroes[c.target] : undefined;
    if (t && !t.dead && t.downedAt !== null) {
      reviveHero(t, undefined, world, h);
      events.push({ actor: h.id, kind: 'heal', target: t.id, amount: t.hp, text: `${h.name} drags ${t.name} back to their feet.` });
    }
    return actionTime(h, 'revive');
  }
  if (c.action === 'card' && c.card) return playHand(world, enc, h, c, events);
  h.st.brace = true;
  return actionTime(h, 'brace');
}

/** Fumes: Poison on every enemy, laid by `apply` (the card's own debuff, so Staves and passives count). */
export function fumes(world: World, enc: Encounter, h: Hero, events: CombatEvent[], free: boolean, apply: (m: Monster) => void) {
  const foes = monstersIn(world, enc.room);
  if (!foes.length) return;
  events.push({ actor: h.id, kind: 'status', text: free ? `Fumes spill from ${h.name}'s satchel!` : `${h.name} smashes a flask of fumes!` });
  for (const m of foes) apply(m);
}

/** Light for everyone in the room (Flare). */
export function flareLight(world: World, room: number) {
  for (const x of Object.values(world.heroes)) {
    if (inDungeon(x) && x.pos.kind === 'room' && x.pos.room === room) x.light = Math.min(LIGHT_MAX, x.light + CARD_RULES.flareLight);
  }
}

/** The Lampbearer's Flare: damage to every enemy and light for the room. */
export function flare(world: World, enc: Encounter, h: Hero, events: CombatEvent[], free = false, dmg: number = CARD_RULES.flare) {
  flareLight(world, enc.room);
  events.push({ actor: h.id, kind: 'status', text: `${h.name} ${free ? 'answers with a flare' : 'ignites a flare'}! (+${CARD_RULES.flareLight} light)` });
  for (const m of monstersIn(world, enc.room)) heroHits(world, enc, h, m, dmg, events, 'Flare');
}

/** A lone Lampbearer keeping Vigil answers every enemy action with a free Flare. */
function vigilFlares(world: World, enc: Encounter, events: CombatEvent[]) {
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (h.st.vigil === h.id && isConscious(h) && h.encounter === enc.room && monstersIn(world, enc.room).length) flare(world, enc, h, events, true);
  }
}

export function heal(h: { hp: number; maxHp: number }, n: number): number {
  const before = h.hp;
  h.hp = Math.min(h.maxHp, h.hp + n);
  return h.hp - before;
}

/** A direct hit's damage before the target's defences. Hammers add a flat bonus first, then the percentages apply. */
export function hitDamage(h: Hero, base: number, world?: World): number {
  let dmg = (base + (h.weapon ? ITEMS[h.weapon].flatDmg ?? 0 : 0)) * damageMult(h, world);
  dmg *= weakMult(h.st);
  return Math.max(1, Math.round(dmg));
}

/** Hero damages a monster. Returns true if it connected. */
export function heroHits(world: World, enc: Encounter, h: Hero, m: Monster, base: number, events: CombatEvent[], what: string, crit = false): boolean {
  let raw = hitDamage(h, base, world);
  // Misericorde: the nearly dead are struck true.
  const low = wornStat(h, 'lowCrit');
  if (!crit && low > 0 && m.hp < m.maxHp * low) {
    raw *= 2;
    crit = true;
  }
  // Giant's Maul: what's Stunned can't brace for it.
  if (m.st.stun) raw *= 1 + wornStat(h, 'stunnedMult');
  // Exposed: this hit is the one it couldn't guard against.
  if (m.st.exposed) {
    raw *= 1 + m.st.exposed;
    delete m.st.exposed;
  }
  let dmg = monsterTakes(world, m, Math.round(raw));
  // Hand Signal: this hit opens it up for the next.
  if (h.st.expose) {
    delete h.st.expose;
    m.st.exposed = Math.max(m.st.exposed ?? 0, CARD_RULES.exposed);
  }
  if (m.st.shield) {
    const absorbed = Math.min(m.st.shield, dmg);
    m.st.shield -= absorbed;
    dmg -= absorbed;
  }
  events.push({
    actor: h.id, kind: 'damage', target: m.id, amount: dmg, crit,
    text: `${h.name}'s ${what} ${crit ? 'CRITS' : 'hits'} ${ENEMIES[m.type].name} for ${dmg}.`,
  });
  // A Thorn Ring a straggler picked up: whoever lands a blow takes its bonus plus the straggler's Block back.
  const thorns = carried(m, 'thorns');
  if (thorns > 0 && dmg > 0 && isConscious(h)) {
    const back = afterBlock(h, thorns + Math.max(0, monsterBlock(world, m)));
    events.push({ actor: m.id, kind: 'damage', target: h.id, amount: back, text: `Thorns! ${h.name} takes ${back}.` });
    hurtHero(world, h, back, events, enc);
  }
  applyMonsterDamage(world, m, dmg, events);
  return true;
}

export function applyMonsterDamage(world: World, m: Monster, dmg: number, events: CombatEvent[]) {
  m.hp -= dmg;
  if (m.hp <= 0) {
    delete world.monsters[m.id];
    world.stats.slain++;
    events.push({ actor: m.id, kind: 'death', target: m.id, text: `${ENEMIES[m.type].name} is slain.` });
    const enc = world.encounters[m.room];
    const slain: Slain = { id: m.id, type: m.type, maxHp: m.maxHp - carried(m, 'maxHp'), dmgMult: m.dmgMult, again: m.again, straggler: m.straggler };
    // Anima (M16): every Sorceress in the fight takes in the Hexed stacks it died with.
    const hexed = m.st.hexed?.length ?? 0;
    if (enc && hexed > 0) {
      for (const id of enc.heroes) {
        const s = world.heroes[id];
        if (s?.cls !== 'sorceress' || !inDungeon(s)) continue;
        s.anima += hexed;
        events.push({ actor: s.id, kind: 'status', target: s.id, text: `${s.name} draws in its curse. (+${hexed} Anima, ${s.anima} in all)` });
      }
    }
    if (enc) {
      enc.lastSlain = slain;
      (enc.slain ??= []).push(slain);
    }
    // A Zombie gets back up where it fell (unless an Undertaker raises it first: see 'raise').
    if (m.type === 'zombie' && m.room >= 0) {
      world.risings.push({ ...slain, id: m.id, room: m.room, at: world.time + CR_RULES.zombieRise });
      events.push({ actor: m.id, kind: 'info', text: 'The Zombie twitches. It will not stay down.' });
    }
    // A Zombie pays out once, however often it's put down; and only counts once for an Emergency.
    if (!m.again) world.kills[m.type] = (world.kills[m.type] ?? 0) + 1;
    // Stragglers have nothing of their own: only what they picked up, which falls where they do.
    if (!m.again && !m.straggler) world.bounty[m.room] = (world.bounty[m.room] ?? 0) + monsterPoints(m);
    if (m.carry && m.room >= 0) {
      addToPile(world, m.room, 0, [m.carry], null, true);
      events.push({ actor: m.id, kind: 'info', text: `${ENEMIES[m.type].name} drops ${ITEMS[m.carry].name}.` });
    }
    // A Boss's regalia breaks into Shards for the players who still need one.
    const regalia = ENEMIES[m.type].regalia;
    if (regalia && m.room >= 0 && dropRegalia(world, m.room, regalia) > 0) {
      events.push({ actor: m.id, kind: 'info', text: `The ${ENEMIES[m.type].name}'s regalia shatters into Shards.` });
    }
    // The last of the Dead King's procession: his treasure spills where they fell.
    if (m.procession && m.room >= 0 && !Object.values(world.monsters).some((o) => o.procession)) {
      dropKingsTreasure(world, m.room);
      events.push({ actor: m.id, kind: 'info', text: "The procession is broken. The Dead King's treasure spills across the floor." });
    }
    if (monstersIn(world, m.room).length === 0 && (world.bounty[m.room] ?? 0) > 0) {
      dropBounty(world, m.room);
      events.push({ actor: m.id, kind: 'info', text: 'Something glints among the remains.' });
    }
  }
}

/** Bring a slain monster back whole in `room` (a Zombie rising, or the Lich's raising). */
function unslay(world: World, room: number, s: Slain, again: boolean): Monster {
  const m: Monster = { id: `m${world.nextId++}`, type: s.type, room, hp: s.maxHp, maxHp: s.maxHp, dmgMult: s.dmgMult, st: {}, again };
  if (s.straggler) m.straggler = true;
  world.monsters[m.id] = m;
  // It's no longer dead: nothing else can raise it, and a Zombie won't rise twice from the one death.
  if (s.id) world.risings = world.risings.filter((r) => r.id !== s.id);
  const enc = world.encounters[room];
  if (enc) {
    enc.slain = (enc.slain ?? []).filter((x) => x !== s && (!s.id || x.id !== s.id));
    if (enc.lastSlain && (enc.lastSlain === s || (s.id && enc.lastSlain.id === s.id))) enc.lastSlain = null;
  }
  return m;
}

/** Zombies whose time has come get back up where they fell, joining (or starting) a fight with anyone there. */
export function tickRisings(world: World) {
  const due = world.risings.filter((r) => r.at <= world.time);
  if (!due.length) return;
  world.risings = world.risings.filter((r) => r.at > world.time);
  for (const r of due) {
    const m = unslay(world, r.room, r, true);
    const text = `The ${ENEMIES[m.type].name} gets back up.`;
    const enc = world.encounters[r.room];
    if (enc) record(world, enc, [{ actor: m.id, kind: 'status', target: m.id, text }]);
    const here = Object.values(world.heroes).filter((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === r.room);
    for (const h of here) notify(world, h, text);
    if (!enc && here.length) onHeroInRoom(world, here[0], r.room);
  }
}

/** The heroes' side as monsters see it, left to right: conscious heroes, then the risen (nearest of all). */
type Victim = { kind: 'hero'; h: Hero } | { kind: 'risen'; r: Risen };

function victims(world: World, enc: Encounter): Victim[] {
  const heroes = combatOrder(world, enc).heroes.filter(isConscious).map((h) => ({ kind: 'hero' as const, h }));
  return [...heroes, ...risenAll(enc).map((r) => ({ kind: 'risen' as const, r }))];
}

/**
 * Monsters go for the nearest unit on the heroes' side (the rightmost), except: Crawlers bite at random,
 * the Bone Giant slams the two nearest, and the Acolyte whispers to a random hero or curses the farthest one.
 */
function monsterAct(world: World, enc: Encounter, m: Monster, events: CombatEvent[]) {
  const rng = world.rng;
  const name = ENEMIES[m.type].name;
  const side = victims(world, enc);
  const heroes = side.flatMap((v) => (v.kind === 'hero' ? [v.h] : []));
  if (heroes.length === 0) return;
  const nearest = side[side.length - 1];

  switch (m.type) {
    case 'ghoul':
    case 'zombie':
      monsterHits(world, enc, m, nearest, ENEMIES[m.type].dmg, 'claws', events);
      return;
    case 'lich': {
      // Its raising goes the moment there's someone to raise; then Doom, again and again.
      const dead = m.spent ? undefined : enc.slain?.at(-1);
      if (dead) {
        m.spent = true;
        const back = unslay(world, enc.room, dead, !!dead.again);
        events.push({ actor: m.id, kind: 'status', target: back.id, text: `${name} speaks a word, and the ${ENEMIES[back.type].name} rises whole.` });
        return;
      }
      for (const id of enc.heroes) {
        const h = world.heroes[id];
        if (h && isConscious(h)) h.st.doom = (h.st.doom ?? 0) + 1;
      }
      events.push({ actor: m.id, kind: 'status', text: `${name} pronounces Doom. Every wound cuts deeper. (+${CR_RULES.doom} dmg taken per stack; it lingers after the Lich)` });
      return;
    }
    case 'crawler': {
      const t = monsterHits(world, enc, m, rng.pick(side), ENEMIES.crawler.dmg, 'bites', events);
      // Warded Mail: what clings to you lets go sooner.
      if (t && isConscious(t)) addPoison(t.st, 1, Math.max(1, 3 - wornStat(t, 'debuffResist')));
      return;
    }
    case 'acolyte':
      if (rng.chance(0.5)) {
        const t = rng.pick(heroes);
        const lost = Math.round(loseLight(t, LIGHT_LOSS.whisper));
        events.push({
          actor: m.id, kind: 'light', target: t.id, amount: -lost,
          text: lost > 0 ? `${name} whispers to ${t.name}, and their lamp gutters. (−${lost} light)` : `${name} whispers, but ${t.name}'s lamp holds steady.`,
        });
      } else {
        monsterHits(world, enc, m, side[0], ENEMIES.acolyte.dmg, 'curses', events);
      }
      return;
    case 'giant':
      for (const t of side.slice(-2)) monsterHits(world, enc, m, t, ENEMIES.giant.dmg, 'slams', events);
      return;
    case 'wight': {
      const t = monsterHits(world, enc, m, nearest, ENEMIES.wight.dmg, 'snuffs at', events);
      if (t && inDungeon(t)) {
        const lost = Math.round(loseLight(t, CR_RULES.wightSnuff));
        if (lost > 0) events.push({ actor: m.id, kind: 'light', target: t.id, amount: -lost, text: `${t.name}'s light gutters. (−${lost} light)` });
      }
      return;
    }
    case 'king': {
      // Kneel and Charge in turn, starting with either.
      const move = (m.cycle ??= rng.chance(0.5) ? 'kneel' : 'charge');
      m.cycle = move === 'kneel' ? 'charge' : 'kneel';
      if (move === 'kneel') {
        for (const t of heroes) t.st.stun = true;
        events.push({ actor: m.id, kind: 'status', text: `${name} bids them kneel, and they do. Every hero is Stunned!` });
        return;
      }
      enc.charge = (enc.charge ?? 0) + 1;
      events.push({ actor: m.id, kind: 'status', text: `${name} charges, and his court surges with him. (every monster here: −${KING_RULES.chargeHaste}s Speed until the fight ends)` });
      monsterHits(world, enc, m, nearest, ENEMIES.king.dmg, 'rides down', events);
      return;
    }
    case 'queen': {
      const court = monstersIn(world, enc.room).filter((o) => o !== m);
      if (court.length === 0) {
        // Dirge: the last of her court is gone, and she mourns loudly.
        for (const t of heroes) loseLight(t, CR_RULES.dirgeLight);
        events.push({ actor: m.id, kind: 'light', text: `${name} keens a dirge for her fallen court, and every lamp gutters. (−${CR_RULES.dirgeLight} light to all)` });
        return;
      }
      for (const o of court) {
        o.hp = Math.min(o.maxHp, o.hp + CR_RULES.hymnHeal);
        if (enc.next[o.id] !== undefined) enc.next[o.id] = at(Math.max(world.time, enc.next[o.id] - CR_RULES.hymnHaste));
      }
      events.push({ actor: m.id, kind: 'status', text: `${name} sings a hymn. Her court is healed and quickened. (+${CR_RULES.hymnHeal} HP, ${CR_RULES.hymnHaste}s sooner)` });
      return;
    }
  }
}

/**
 * Monster attacks a hero (or the risen), honouring Guard, dodge, brace, Shield and darkness.
 * Returns the hero actually hit, if it was a hero.
 */
function monsterHits(world: World, enc: Encounter, m: Monster, victim: Victim, base: number, verb: string, events: CombatEvent[]): Hero | null {
  const name = ENEMIES[m.type].name;
  const villagerText = maybeHitVillager(world, enc.room, Math.round(monsterBlow(m, base)), name);
  if (villagerText) {
    events.push({ actor: m.id, kind: 'info', text: villagerText });
    return null;
  }
  if (victim.kind === 'risen') {
    const r = victim.r;
    const rname = risenName(world, r);
    // What "every ally" cards gave it covers it like a hero: Veil-like evades, Smoke, Shield.
    const st = risenSt(world, r);
    if (st.evade) {
      if (--st.evade <= 0) delete st.evade;
      events.push({ actor: m.id, kind: 'miss', target: r.id, text: `${name} ${verb} at ${rname}, who is not quite there.` });
      return null;
    }
    const dodge = Math.max(inSmoke(world, st) ? 0.5 : 0, st.sidestep ?? 0);
    if (dodge > 0 && world.rng.chance(dodge)) {
      events.push({ actor: m.id, kind: 'miss', target: r.id, text: `${name} ${verb} at ${rname} — dodged!` });
      return null;
    }
    let dmg = risenTakes(world, r, Math.max(1, Math.round(monsterBlow(m, base) * weakMult(m.st))));
    if (st.shield) {
      const absorbed = Math.min(st.shield, dmg);
      st.shield -= absorbed;
      dmg -= absorbed;
      if (st.shield <= 0) delete st.shield;
    }
    r.hp = Math.max(0, r.hp - dmg);
    events.push({ actor: m.id, kind: 'damage', target: r.id, amount: dmg, text: dmg > 0 ? `${name} ${verb} ${rname} for ${dmg}.` : `${name} ${verb} ${rname}, but its Shield soaks it up.` });
    if (r.hp <= 0) {
      events.push({ actor: r.id, kind: 'death', target: r.id, text: r.type === 'wolf' ? `${rname} yelps and falls.` : `${rname} falls apart.` });
      delete enc.next[r.id];
      if (r.hero) risenAllyFalls(world, world.heroes[r.hero], enc.room);
    }
    return null;
  }
  const t = victim.h;
  // Blinded: it swings at nothing (the charge is used up).
  if (m.st.blind) {
    delete m.st.blind;
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} blindly at ${t.name}, and misses.` });
    return null;
  }
  // Fade, Blink, Veil: this one simply misses.
  if (t.st.evade) {
    if (--t.st.evade <= 0) delete t.st.evade;
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} at ${t.name}, who is not quite there.` });
    return null;
  }
  const dodge = Math.max(inSmoke(world, t.st) ? 0.5 : 0, t.st.sidestep ?? 0, wornStat(t, 'dodge'));
  if (dodge > 0 && world.rng.chance(dodge)) {
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} at ${t.name} — dodged!` });
    return null;
  }
  // Gossamer Shroud: the first attack in a fight passes through it.
  const shroud = clothReady(t, 'gossamer');
  if (shroud) {
    spendCloth(t, shroud);
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} at ${t.name}, but strikes only gossamer.` });
    return null;
  }
  let dmg = monsterBlow(m, base);
  dmg *= weakMult(m.st);
  if (t.light <= 0) dmg *= 1.25;
  const gate = (t.st.gate ?? 0) > world.time;
  const nearest = combatOrder(world, enc).heroes.filter(isConscious).at(-1) === t;
  if (t.st.brace) dmg *= CARD_RULES.braceMult;
  // Patchwork Coat: the first blow in a fight is halved.
  const patch = clothReady(t, 'patchwork');
  if (patch) {
    spendCloth(t, patch);
    dmg *= CLOTH.patchworkMult;
  }
  // Bulwark Plate: steadier at the front.
  const front = nearest ? wornStat(t, 'frontBlock') : 0;
  dmg = Math.max(1, afterBlock(t, Math.max(1, Math.round(dmg))) - front) + doomOf(t);
  let absorbed = 0;
  if (t.st.shield) {
    absorbed = Math.min(t.st.shield, dmg);
    t.st.shield -= absorbed;
    dmg -= absorbed;
    if (t.st.shield <= 0) delete t.st.shield;
  }
  events.push({
    actor: m.id, kind: 'damage', target: t.id, amount: dmg,
    text: dmg > 0 ? `${name} ${verb} ${t.name} for ${dmg}.` : `${name} ${verb} ${t.name}, but their Shield soaks it up.`,
  });
  applyHeroDamage(world, enc, t, dmg, events);
  // Thornwall: what the Shield stopped goes back into the attacker.
  if (t.st.thornwall && absorbed > 0 && world.monsters[m.id]) {
    const back = monsterTakes(world, m, absorbed);
    events.push({ actor: t.id, kind: 'damage', target: m.id, amount: back, text: `${name} is torn on ${t.name}'s thornwall for ${back}.` });
    applyMonsterDamage(world, m, back, events);
  }
  // Hold the Gate: a blow that lands on a Shield is thrown back.
  if (gate && absorbed > 0 && world.monsters[m.id] && enc.next[m.id] !== undefined) {
    const secs = CARD_RULES.gateDelay + wornStat(t, 'delayBonus');
    enc.next[m.id] = at(enc.next[m.id] + secs);
    events.push({ actor: t.id, kind: 'status', target: m.id, text: `${name} is thrown back from the gate. (Delayed ${secs}s)` });
  }
  // Scale Ward: the scales bite back.
  if (t.st.spikes && world.monsters[m.id]) {
    const back = monsterTakes(world, m, t.st.spikes);
    events.push({ actor: t.id, kind: 'damage', target: m.id, amount: back, text: `${name} is cut on ${t.name}'s scales for ${back}.` });
    applyMonsterDamage(world, m, back, events);
  }
  // Thorn Ring: a blow that lands costs the attacker its bonus plus the wearer's Block.
  const thorns = thornsOf(t);
  if (thorns > 0 && dmg > 0 && world.monsters[m.id] && m.hp > 0) {
    const back = monsterTakes(world, m, thorns);
    events.push({ actor: t.id, kind: 'damage', target: m.id, amount: back, text: `Thorns! ${name} takes ${back}.` });
    applyMonsterDamage(world, m, back, events);
  }
  return t;
}

function applyHeroDamage(world: World, enc: Encounter, h: Hero, dmg: number, events: CombatEvent[]) {
  hurtHero(world, h, dmg, events, enc);
}

/**
 * Damage to a hero from anything (blows, poison, cave-ins…), which can take them down. Returns false if nothing landed.
 */
export function hurtHero(world: World, h: Hero, dmg: number, events: CombatEvent[] | null, enc?: Encounter): boolean {
  if (!isConscious(h) || dmg <= 0) return false;
  h.hp -= dmg;
  if (h.hp <= 0 && blinkAway(world, h, events, enc)) return true;
  h.lowestHp = Math.min(h.lowestHp, Math.max(0, h.hp) / h.maxHp);
  syncInjuries(h);
  if (h.hp <= 0) downHero(world, h, events, enc);
  else penitence(world, h, events);
  return true;
}

/** Blinkcloth Mantle: instead of going down, slip out at 1 HP into a random room next door. Returns true if it did. */
function blinkAway(world: World, h: Hero, events: CombatEvent[] | null, enc?: Encounter): boolean {
  const c = clothReady(h, 'blink');
  if (!c || h.pos.kind !== 'room') return false;
  const from = h.pos.room;
  const ways = neighbours(world.dungeon, from).filter((n) => !world.collapsed.includes(corridorBetween(world.dungeon, from, n)!.id));
  if (!ways.length) return false;
  spendCloth(h, c);
  const to = world.rng.pick(ways);
  h.hp = 1;
  h.lowestHp = Math.min(h.lowestHp, 1 / h.maxHp);
  syncInjuries(h);
  const lost = Math.round(loseLight(h, CLOTH.blinkLight));
  events?.push({ actor: h.id, kind: 'flee', target: h.id, text: `${h.name} slips away in a flicker of blinkcloth!` });
  const fight = enc ?? (h.encounter !== null ? world.encounters[h.encounter] : undefined);
  if (fight) leaveEncounter(world, fight, h);
  h.channel = null;
  h.pos = { kind: 'room', room: to };
  h.prevRoom = from;
  h.path = [];
  h.heading = null;
  leftRoom(h);
  if (!h.seen.includes(to)) h.seen.push(to);
  notify(world, h, `Your blinkcloth flings you into ${theRoom(world.dungeon.rooms[to].name)}. (−${lost} light)`);
  chronicle(world, `${h.name}'s blinkcloth snatched them out of ${theRoom(world.dungeon.rooms[from].name)}.`);
  onHeroInRoom(world, h, to);
  return true;
}

/** Penitent's Sackcloth: dropping low mends you a little. */
function penitence(world: World, h: Hero, events: CombatEvent[] | null) {
  if (h.hp >= h.maxHp * CLOTH.penitentBelow) return;
  const c = clothReady(h, 'penitent');
  if (!c) return;
  spendCloth(h, c);
  const healed = heal(h, CLOTH.penitentHeal);
  if (events) events.push({ actor: h.id, kind: 'heal', target: h.id, amount: healed, text: `${h.name}'s sackcloth answers their pain. (+${healed})` });
  else notify(world, h, `Your sackcloth answers your pain. (+${healed})`);
}

/** The injuries this run has dealt so far: below half HP a Minor, below a quarter a Major instead, and going down one more Major. */
function runInjuriesOf(h: Hero): Injury[] {
  const out: Injury[] = [];
  if (h.lowestHp < VILLAGE_RULES.majorBelow) out.push('major');
  else if (h.lowestHp < VILLAGE_RULES.minorBelow) out.push('minor');
  if (h.downedMajor) out.push('major');
  return out;
}

/**
 * Injuries take effect the moment they happen (user, 2026-10-10), not just in the next run: max HP drops (HP over
 * it is lost) and each Major adds Speed. Call after anything that changes `lowestHp` or `downedMajor`.
 */
export function syncInjuries(h: Hero) {
  const now = runInjuriesOf(h);
  const was = h.runInjuries ?? [];
  if (now.length === was.length && now.every((x, i) => x === was[i])) return;
  const delta = Math.round((injuredMaxHp(h.cls, [...h.injuries, ...now]) - injuredMaxHp(h.cls, [...h.injuries, ...was])) * riteMult(h));
  h.runInjuries = now;
  h.maxHp = Math.max(1, h.maxHp + delta);
  h.hp = Math.min(h.hp, h.maxHp);
  const majors = [...h.injuries, ...now].filter((i) => i === 'major').length;
  h.speedMods = h.speedMods.filter((m) => m.label !== MAJOR_INJURY_LABEL);
  for (let i = 0; i < majors; i++) h.speedMods.push({ amount: VILLAGE_RULES.majorSpeed, until: null, label: MAJOR_INJURY_LABEL });
}

export const MAJOR_INJURY_LABEL = 'Major Injury';

/**
 * `rest`: the Open Coffin (user, 2026-10-11). They lay down on purpose: no injury, nobody is shaken by it, and they
 * get up with the HP they lay down with (`restHp`).
 */
export function downHero(world: World, h: Hero, events: CombatEvent[] | null, enc?: Encounter, rest = false) {
  h.restHp = rest ? h.hp : null;
  h.hp = 0;
  h.downedAt = world.time;
  if (!rest) {
    h.lowestHp = 0;
    h.downedMajor = true;
    syncInjuries(h);
  }
  world.stats.downs++;
  h.st = {};
  h.channel = null;
  events?.push({ actor: h.id, kind: 'down', target: h.id, text: `${h.name} falls!` });
  if (!rest) chronicle(world, `${h.name} went down in ${roomName(world, h)}.`);
  // Gravecloth: they'll get up again by themselves (and again, as long as they stay in this room).
  const grave = h.pos.kind === 'room' ? clothReady(h, 'grave') : null;
  if (grave && h.pos.kind === 'room') {
    if (grave.graveRoom !== h.pos.room) spendCloth(h, grave);
    grave.graveRoom = h.pos.room;
    h.riseAt = world.time + CLOTH.graveTurns * speedOf(h, world.time);
    events?.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name}'s gravecloth stirs. (getting back up soon)` });
  }
  if (rest) return;
  const witnesses = enc ? enc.heroes.map((id) => world.heroes[id]) : Object.values(world.heroes);
  for (const w of witnesses) {
    if (w !== h && isConscious(w) && sameRoom(w, h) && w.cls !== 'undertaker') loseLight(w, LIGHT_LOSS.allyDown);
  }
}

function sameRoom(a: Hero, b: Hero) {
  return a.pos.kind === 'room' && b.pos.kind === 'room' && a.pos.room === b.pos.room;
}

/** Out of the fight and back down a tunnel: the way they came, or (`anyTunnel`: Slip Away) any of the room's. */
export function flee(world: World, enc: Encounter, h: Hero, anyTunnel = false) {
  leaveEncounter(world, enc, h);
  leftRoom(h);
  const d = world.dungeon;
  const from = enc.room;
  let to = anyTunnel ? null : h.prevRoom;
  if (to === null || !corridorBetween(d, from, to)) to = world.rng.pick(neighbours(d, from));
  const c = corridorBetween(d, from, to)!;
  h.pos = { kind: 'corridor', corridor: c.id, from, to, t: 0, dur: speedOf(h, world.time) };
  h.path = [];
  h.heading = null;
}

/** Dying and death for downed heroes. Called every tick. */
export function tickDowned(world: World) {
  for (const h of Object.values(world.heroes)) {
    if (inDungeon(h) && h.downedAt !== null && h.riseAt !== null && world.time >= h.riseAt && !h.dead) {
      reviveHero(h, CLOTH.graveHp, world);
      notify(world, h, 'Your gravecloth drags you back to your feet.');
      const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
      if (enc) say(world, enc, `${h.name} rises again in their gravecloth.`);
      // The fight may have ended with them down; the monsters are still there.
      else if (h.pos.kind === 'room') onHeroInRoom(world, h, h.pos.room);
      continue;
    }
    if (inDungeon(h) && h.downedAt !== null && world.time - h.downedAt >= DEATH_TIMER) dieOut(world, h);
  }
}

/** A downed hero dies where they lie: their things hit the floor, and anyone watching takes it hard. */
export function dieOut(world: World, h: Hero) {
  h.dead = true;
  h.diedAt = world.time;
  h.fate = `died in ${roomName(world, h)}`;
  chronicle(world, `${h.name} died in ${roomName(world, h)}.`);
  dropEverything(world, h);
  dropRisenAllies(world, h);
  const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
  if (enc) {
    say(world, enc, `${h.name} has died.`);
    enc.heroes = enc.heroes.filter((id) => id !== h.id);
  }
  h.encounter = null;
  for (const w of Object.values(world.heroes)) {
    // Mortician: death holds no dread for the Undertaker.
    if (w !== h && isConscious(w) && sameRoom(w, h) && w.cls !== 'undertaker') loseLight(w, LIGHT_LOSS.allyDeath);
  }
}

/** A dead Undertaker's Risen allies fall with them, wherever they are (with them, or still fighting on). */
export function dropRisenAllies(world: World, u: Hero) {
  for (const r of u.legion) if (r.hero) risenAllyFalls(world, world.heroes[r.hero], bodyRoom(u));
  u.legion = u.legion.filter((r) => !r.hero);
  for (const enc of Object.values(world.encounters)) {
    for (const r of enc.legion ?? []) {
      if (r.by !== u.id || !r.hero || r.hp <= 0) continue;
      r.hp = 0;
      delete enc.next[r.id];
      say(world, enc, `With ${u.name} gone, ${risenName(world, r)} falls still.`);
      risenAllyFalls(world, world.heroes[r.hero], enc.room);
    }
  }
}
