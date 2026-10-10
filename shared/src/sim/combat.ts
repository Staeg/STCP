import { CLASS_RULES, abilityById, type AbilityDef } from '../content/abilities';
import { escalationAt, EXIT_OPENS_AT, LIGHT_MAX } from '../content/constants';
import {
  crBonus, crUnitChance, CR_RULES, ENCOUNTER_GROUPS, ENEMIES, ESCALATION, LAIR_GROUPS, ROSTER_RULES, TIERS, type EnemyId, type GroupTemplate,
} from '../content/enemies';
import { abilitiesFor, TALENT_RULES, type TalentId } from '../content/talents';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { ITEMS, LOOT } from '../content/items';
import { applyItem, dropBounty, dropEverything, itemTargets, monsterPoints, wornMult, wornStat } from './loot';
import { ELITE_EVENTS } from '../content/events';
import { maybeHitVillager } from './events';
import { chronicle, extractHero, roomName, type Hero, type World } from './world';
import { notify } from './notify';
import { speedOf } from './speed';
import { injuredMaxHp, KIT_RULES, VILLAGE_RULES, type Injury } from '../village';

export const BLEED_OUT = 36;
export const REVIVE_CHANNEL = 6;
export const REVIVE_HP_FRACTION = 0.3;
export const FLEE_CHANCE = 0.5;
export const STRESS_MAX = 100;

/** Turn counts are the affected unit's own turns: they tick down at the end of each of its turns. */
export interface Statuses {
  /** Skips its next turn. */
  stun?: boolean;
  /** Each Poison runs on its own: `rounds` = turns of poison left for that one. */
  poison?: Poison[];
  /** Acid: takes CLASS_RULES.acidBonus more from every hit; turns remaining. */
  acid?: number;
  /** Hexed: one entry per stack, each the turns it has left. Every stack adds CLASS_RULES.hexedBonus to Hex's damage. */
  hexed?: number[];
  block?: number;
  /** Deals half damage; turns remaining. */
  weak?: number;
  /** Warden's Vengeance: attackers take their attack back. Own turns remaining (ticks at the start of each). */
  vengeance?: number;
  /** Bellwright's Clang: −CLASS_RULES.clangHaste Speed per stack. `turns` = own turns until one stack fades (ticks at the start of each). */
  clang?: { stacks: number; turns: number };
  /** Monster: has taken a turn in this fight (Backstab crits those that haven't). */
  acted?: boolean;
  /** In smoke (50% dodge, sure to flee) until this game time. */
  dodge?: number;
  // ---- Until someone's next turn ----
  /** Lampbearer's lone Vigil: every enemy action sets off a Flare, until this hero's next turn. */
  vigil?: string;
  /** Bracing until their own next turn. */
  brace?: boolean;
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
  /** Great Bell: stopped in its tracks until this game time; a fight it starts before then, it starts Stunned. */
  dazedUntil?: number;
  /** A Zombie back on its feet: killing it again adds nothing to the room's bounty. */
  again?: boolean;
  /** Lich: its raising is used up. */
  spent?: boolean;
}

/** A slain monster as a fight remembers it (what Raise and the Lich bring back). */
export interface Slain {
  /** The id it had: a Zombie's pending rise is keyed by it. */
  id?: string;
  type: EnemyId;
  maxHp: number;
  dmgMult: number;
  again?: boolean;
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
  type: EnemyId;
  hp: number;
  maxHp: number;
  dmgMult: number;
  /** Own turns left before it crumbles. */
  turns: number;
  by: string;
  /** Unholy Uprising: never crumbles; only falls when its HP runs out. */
  permanent?: boolean;
}

export type CombatAction = 'a0' | 'a1' | 'a2' | 'flee' | 'revive' | 'brace' | 'item';

export interface Choice {
  action: CombatAction;
  target?: string;
  /** Inventory slot, for action 'item'. */
  item?: number;
}

export type CombatEventKind = 'damage' | 'heal' | 'miss' | 'status' | 'flee' | 'down' | 'death' | 'info' | 'stress';

export interface CombatEvent {
  /** Increases through the fight, so clients can replay only what's new. */
  seq?: number;
  actor: string;
  kind: CombatEventKind;
  text: string;
  target?: string;
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
  /** Lich's Doom: heroes here take this much more from every blow, aura and poison tick. */
  doom?: number;
  risen?: Risen | null;
  /** Unholy Uprising: the Risen that follow an Undertaker everywhere, fighting here (fallen ones stay until it ends). */
  legion?: Risen[];
  /** Heroes who have had their first timer in this fight (Opening Act only speeds up the first). */
  opened?: string[];
}

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

export function addStress(h: Hero, amount: number) {
  if (amount > 0) amount *= wornMult(h, 'stressMult');
  const before = h.stress;
  h.stress = Math.max(0, Math.min(stressCap(h), h.stress + amount));
  return h.stress - before;
}

/** How high stress can go: 100, or more for a Zealot who reached the Zen Zenith. */
export function stressCap(h: Pick<Hero, 'elite'>): number {
  return h.elite.zenith ? ELITE_EVENTS.zenithStressMax : STRESS_MAX;
}

/** Weapon bonus (and the Zealot's stress, and Everflame): multiplies every bit of damage this hero deals. */
export function damageMult(h: Hero, world?: World): number {
  const weapon = 1 + (h.weapon ? ITEMS[h.weapon].dmgPct ?? 0 : 0);
  const zeal = h.cls === 'zealot' ? 1 + h.stress * CLASS_RULES.zealotDmgPerStress : 1;
  return weapon * zeal * everflame(h, world) * riteMult(h);
}

/** Effigy Rite: +20% damage and max HP; Tome Rite: −20%. */
export function riteMult(h: { rites: readonly string[] }): number {
  return (h.rites.includes('effigy') ? KIT_RULES.effigyMult : 1) * (h.rites.includes('tome') ? KIT_RULES.tomeMult : 1);
}

/** Everflame: the Lampbearer burns brighter the more light their allies still carry. */
export function everflame(h: Hero, world?: World): number {
  if (h.talent !== 'everflame' || !world) return 1;
  const light = Object.values(world.heroes).filter((o) => o !== h && inDungeon(o)).reduce((s, o) => s + o.light, 0);
  return 1 + TALENT_RULES.everflamePerLight * light;
}

/** A hero's three abilities, as their Talent has changed them. */
export function abilitiesOf(h: { cls: Hero['cls']; talent?: TalentId | null }): [AbilityDef, AbilityDef, AbilityDef] {
  return abilitiesFor(h.cls, h.talent);
}

/** Zealot: move up to `max` stress from an ally onto yourself (ignores Calm and Ward Charm). Returns how much moved. */
export function takeSins(zealot: Hero, t: Hero, max: number): number {
  const moved = Math.min(max, t.stress);
  t.stress -= moved;
  zealot.stress = Math.min(stressCap(zealot), zealot.stress + moved);
  return moved;
}

/**
 * Armor: flat reduction on any damage this hero takes, from any source. A hit always does at least 1.
 * A Quickblood Ring then adds to it.
 */
export function armored(h: Hero, dmg: number): number {
  if (dmg <= 0) return dmg;
  const reduced = h.armor ? Math.max(1, dmg - (ITEMS[h.armor].armor ?? 0)) : dmg;
  return reduced + wornStat(h, 'hurt');
}

export function reviveHero(h: Hero, fraction = REVIVE_HP_FRACTION, world?: World, by?: Hero) {
  h.downedAt = null;
  if (world) world.stats.revives++;
  if (world) chronicle(world, by ? `${by.name} got ${h.name} back on their feet.` : `${h.name} got back up.`);
  // Pallbearer: the Undertaker brings them back whole, and spares them the lasting wound of going down.
  if (by?.talent === 'pallbearer' && by !== h) {
    fraction = 1;
    h.downedMajor = false;
    syncInjuries(h);
  }
  h.hp = Math.max(1, Math.ceil(h.maxHp * fraction));
}

// ---------------------------------------------------------------------------
// Encounter lifecycle

/** A hero has arrived in a room (or is in one). Starts or joins a fight if monsters are present. */
export function onHeroInRoom(world: World, hero: Hero, room: number) {
  if (!inDungeon(hero) || hero.encounter !== null) return;
  if (monstersIn(world, room).length === 0) return;
  let enc = world.encounters[room];
  if (!enc) {
    enc = { room, startedAt: world.time, heroes: [], next: {}, choices: {}, events: [], seq: 0, log: [] };
    world.encounters[room] = enc;
    world.stats.fights++;
    // Everyone already standing here is pulled in, including the downed.
    for (const h of Object.values(world.heroes)) {
      if (inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room) enlist(enc, h);
    }
    const names = monstersIn(world, room).map((m) => ENEMIES[m.type].name).join(', ');
    enc.log.push(`Ambush! ${names}.`);
    for (const id of enc.heroes) onEnlist(world, enc, world.heroes[id]);
  } else {
    enlist(enc, hero);
    enc.log.push(`${hero.name} joins the fight.`);
    onEnlist(world, enc, hero);
  }
  startTimers(world, enc);
}

/** Talents that act when a hero walks into a fight. */
function onEnlist(world: World, enc: Encounter, h: Hero) {
  if (!isConscious(h)) return;
  // Evil Eye: every enemy here starts the fight Hexed.
  if (h.talent === 'evilEye') {
    for (const m of monstersIn(world, enc.room)) (m.st.hexed ??= []).push(CLASS_RULES.hexedTurns);
    enc.log.push(`${h.name}'s evil eye falls on every foe. (Hexed)`);
  }
  // Unholy Uprising: the Undertaker's dead come too.
  if (h.legion.length) {
    for (const r of h.legion) (enc.legion ??= []).push({ ...r, id: `r${world.nextId++}`, by: h.id });
    enc.log.push(`${h.name}'s dead shamble in behind them: ${h.legion.map((r) => ENEMIES[r.type].name).join(', ')}.`);
    h.legion = [];
  }
  // Restless Dead: the risen that followed the Undertaker here fights on.
  if (h.risen && !risenOf(enc)) {
    enc.risen = { ...h.risen, id: `r${world.nextId++}`, by: h.id };
    h.risen = null;
    enc.log.push(`The risen ${ENEMIES[enc.risen.type].name} shambles in behind ${h.name}.`);
  }
}

/** Restless Dead: when the Undertaker leaves a fight (or it ends), their risen goes with them (and the Uprising's dead, if they still can). */
function keepRisen(enc: Encounter, h: Hero) {
  if (enc.legion && inDungeon(h)) {
    const mine = enc.legion.filter((r) => r.by === h.id);
    for (const r of mine) if (r.hp > 0) h.legion.push({ type: r.type, hp: r.hp, maxHp: r.maxHp, dmgMult: r.dmgMult, turns: r.turns, permanent: true });
    enc.legion = enc.legion.filter((r) => r.by !== h.id);
  }
  const r = risenOf(enc);
  if (!r || r.by !== h.id || h.talent !== 'restlessDead' || !isConscious(h)) return;
  h.risen = { type: r.type, hp: r.hp, maxHp: r.maxHp, dmgMult: r.dmgMult, turns: r.turns };
  enc.risen = null;
}

function enlist(enc: Encounter, h: Hero) {
  if (enc.heroes.includes(h.id)) return;
  enc.heroes.push(h.id);
  h.encounter = enc.room;
  h.path = [];
  h.heading = null;
  h.channel = null;
}

function leaveEncounter(world: World, enc: Encounter, h: Hero) {
  keepRisen(enc, h);
  enc.heroes = enc.heroes.filter((id) => id !== h.id);
  delete enc.choices[h.id];
  delete enc.next[h.id];
  resetAfterFight(h);
}

/**
 * Cooldowns and timed statuses carry on outside the fight (see `fieldTurn`); what only means something in a
 * fight (Stun, Shield, Brace, Vigil, having acted) ends with it.
 */
function resetAfterFight(h: Hero) {
  h.encounter = null;
  h.cdClock = 0;
  const { poison, acid, hexed, weak, vengeance, dodge, clang } = h.st;
  h.st = Object.fromEntries(Object.entries({ poison, acid, hexed, weak, vengeance, dodge, clang }).filter(([, v]) => v !== undefined));
}

function endEncounter(world: World, enc: Encounter) {
  // Unholy Uprising: fighting beside the restless dead wears on the living.
  const raisers = new Set((enc.legion ?? []).map((r) => r.by));
  for (const by of raisers) {
    for (const id of enc.heroes) {
      const o = world.heroes[id];
      if (!o || id === by || !inDungeon(o)) continue;
      const added = Math.round(addStress(o, ELITE_EVENTS.uprisingStress));
      if (added > 0) notify(world, o, `The dead that fought beside you turn their empty eyes on you. (+${added} stress)`);
    }
  }
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (h) keepRisen(enc, h);
    if (h) resetAfterFight(h);
  }
  for (const m of monstersIn(world, enc.room)) m.st = {};
  world.stats.fightTime += world.time - enc.startedAt;
  delete world.encounters[enc.room];
}

/** Turn times are kept to the millisecond, so units that should tie do tie. */
const at = (t: number) => Math.round(t * 1000) / 1000;

/**
 * Give every standing unit without a timer a fresh one (a full Speed's wait), and drop the timers of
 * the downed (they get a fresh one when they're back up).
 */
function startTimers(world: World, enc: Encounter) {
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (!isConscious(h)) delete enc.next[id];
    else if (enc.next[id] === undefined) {
      // Opening Act: the Cutthroat's first turn of the fight comes at half their Speed.
      const first = !(enc.opened ??= []).includes(id);
      if (first) enc.opened.push(id);
      const wait = speedOf(h, world.time) * (first && h.talent === 'openingAct' ? TALENT_RULES.openingFraction : 1);
      enc.next[id] = at(world.time + wait);
    }
  }
  for (const m of monstersIn(world, enc.room)) {
    if (enc.next[m.id] !== undefined) continue;
    enc.next[m.id] = at(world.time + ENEMIES[m.type].speed);
    // Great Bell: still reeling from the Toll.
    if ((m.dazedUntil ?? 0) > world.time) m.st.stun = true;
  }
  if (enc.risen) enc.next[enc.risen.id] ??= at(world.time + ENEMIES[enc.risen.type].speed);
  for (const r of risenAll(enc)) enc.next[r.id] ??= at(world.time + ENEMIES[r.type].speed);
}

/**
 * Heroes and monsters in the order the fight screen shows them, left to right, with the two sides
 * facing each other in the middle: the slowest of each side stands nearest the enemy.
 * Heroes go fastest → slowest, monsters slowest → fastest (ties: join order). The risen stand
 * nearest of all on the heroes' side (see `risenOf`). This is also who goes first when turns tie.
 */
export function combatOrder(world: World, enc: Encounter): { heroes: Hero[]; monsters: Monster[] } {
  const heroes = enc.heroes.map((id, i) => ({ h: world.heroes[id], s: speedOf(world.heroes[id], world.time), i }));
  const monsters = monstersIn(world, enc.room).map((m, i) => ({ m, s: ENEMIES[m.type].speed, i }));
  return {
    heroes: heroes.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.h),
    monsters: monsters.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.m),
  };
}

/** The risen ally in this fight, if it's still standing. */
export function risenOf(enc: Encounter): Risen | null {
  return enc.risen && enc.risen.hp > 0 && enc.risen.turns > 0 ? enc.risen : null;
}

/** Every risen ally still standing here: the Uprising's dead, then the one Raised (nearest the enemy). */
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

type Unit = { kind: 'hero'; h: Hero } | { kind: 'monster'; m: Monster } | { kind: 'risen'; r: Risen };

/** The unit whose turn is due soonest (and is due now). Ties go to heroes before monsters, left to right. */
function nextUp(world: World, enc: Encounter): Unit | null {
  const { heroes, monsters } = combatOrder(world, enc);
  const units: (Unit & { t: number | undefined })[] = [
    ...heroes.filter(isConscious).map((h) => ({ kind: 'hero' as const, h, t: enc.next[h.id] })),
    ...risenAll(enc).map((r) => ({ kind: 'risen' as const, r, t: enc.next[r.id] })),
    ...monsters.map((m) => ({ kind: 'monster' as const, m, t: enc.next[m.id] })),
  ];
  let best: (typeof units)[number] | null = null;
  for (const u of units) {
    if (u.t === undefined || u.t > world.time + 1e-9) continue;
    if (!best || u.t < best.t!) best = u; // strict, so the earlier unit in the order wins a tie
  }
  return best;
}

// ---------------------------------------------------------------------------
// Choices

export function abilityOf(h: Hero, action: CombatAction): AbilityDef | null {
  const abilities: readonly AbilityDef[] = abilitiesOf(h);
  const idx = action === 'a0' ? 0 : action === 'a1' ? 1 : action === 'a2' ? 2 : -1;
  return abilities[idx] ?? null;
}

/** Ids of units this hero could target with the given action, or [] if it needs no target. */
export function validTargets(world: World, enc: Encounter, h: Hero, action: CombatAction): string[] {
  const monsters = monstersIn(world, enc.room);
  const allies = enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  if (action === 'revive') return enc.heroes.map((id) => world.heroes[id]).filter((x) => !x.dead && x.downedAt !== null).map((x) => x.id);
  const ab = abilityOf(h, action);
  if (!ab) return [];
  switch (ab.target) {
    case 'enemy':
      return monsters.map((m) => m.id);
    case 'enemyFirst': {
      const first = combatOrder(world, enc).monsters[0];
      return first ? [first.id] : [];
    }
    case 'damagedEnemy':
      return monsters.filter((m) => m.hp < m.maxHp).map((m) => m.id);
    case 'ally':
      return allies.map((x) => x.id);
    case 'otherAlly':
      return allies.filter((x) => x.id !== h.id).map((x) => x.id);
    default:
      return [];
  }
}

export function needsTarget(h: Hero, action: CombatAction): boolean {
  if (action === 'revive') return true;
  const ab = abilityOf(h, action);
  return !!ab && ['enemy', 'enemyFirst', 'damagedEnemy', 'ally', 'otherAlly'].includes(ab.target);
}

/** Conscious heroes in the fight other than `h`. */
function othersIn(world: World, enc: Encounter, h: Hero): Hero[] {
  return enc.heroes.map((id) => world.heroes[id]).filter((x) => x !== h && isConscious(x));
}

/** Knell's damage right now: weaker the more allies stand with you. */
export function knellDamage(power: number, allies: number): number {
  return Math.max(0, power - CLASS_RULES.knellPerAlly * allies);
}

/** Why an ability that's off cooldown still can't be used right now (null = it can). Targets are checked separately. */
export function unusableReason(world: World, enc: Encounter, h: Hero, ab: AbilityDef): string | null {
  switch (ab.id) {
    case 'knell':
      return knellDamage(ab.power, othersIn(world, enc, h).length) <= 0 ? 'Too many allies here: the Knell rings hollow.' : null;
    case 'absolution':
      return h.stress <= CLASS_RULES.absolutionFloor ? `Needs more than ${CLASS_RULES.absolutionFloor} stress.` : null;
    case 'raise':
      return risenOf(enc) ? 'One of the dead already fights for you.' : !enc.lastSlain ? 'Nothing has died here since your last Raise.' : null;
    default:
      return null;
  }
}

/** Ability slots (0–2) not cooling down, in order. The first of them is what an undecided hero falls back on. */
export function readyAbilities(h: { cls: Hero['cls']; talent?: TalentId | null; cooldowns: Record<string, number> }): (0 | 1 | 2)[] {
  const abilities = abilitiesOf(h);
  return ([0, 1, 2] as const).filter((i) => (h.cooldowns[abilities[i].id] ?? 0) <= 0);
}

/**
 * What a hero does if their turn comes before they've picked: the first ability that's ready and has a
 * target, aimed sensibly (an enemy for attacks, the most hurt ally for heals). Null if none can be used
 * (then they brace).
 */
export function defaultChoice(world: World, enc: Encounter, h: Hero): Choice | null {
  for (const i of readyAbilities(h)) {
    const action = `a${i}` as CombatAction;
    const ab = abilityOf(h, action)!;
    if (unusableReason(world, enc, h, ab)) continue;
    if (!needsTarget(h, action)) return { action };
    const targets = validTargets(world, enc, h, action);
    if (targets.length === 0) continue;
    if (ab.target === 'ally' || ab.target === 'otherAlly') {
      const hurt = targets.map((id) => world.heroes[id]).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      return { action, target: hurt.id };
    }
    return { action, target: world.rng.pick(targets) };
  }
  return null;
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
    const pick: Choice = { action: 'item', item: idx, target: def.target === 'ally' || def.target === 'downed' ? choice.target : undefined };
    // Quick Hands: the Alchemist uses it there and then, and keeps their turn.
    if (h.talent === 'quickHands') {
      const target = pick.target ?? leftmostTarget(world, enc, h, pick);
      const events: CombatEvent[] = [];
      heroAct(world, enc, h, { ...pick, target }, events);
      record(enc, events);
      return null;
    }
    enc.choices[h.id] = pick;
    return null;
  }
  const ab = abilityOf(h, choice.action);
  if (ab && (h.cooldowns[ab.id] ?? 0) > 0) return `${ab.name} is on cooldown.`;
  const why = ab && unusableReason(world, enc, h, ab);
  if (why) return why;
  if (needsTarget(h, choice.action)) {
    const targets = validTargets(world, enc, h, choice.action);
    if (targets.length === 0) return 'No valid target.';
    if (choice.target !== undefined && !targets.includes(choice.target)) return 'Pick a valid target.';
  } else if (ab && ab.target === 'otherAlly') {
    return 'No valid target.';
  }
  enc.choices[h.id] = { action: choice.action, target: needsTarget(h, choice.action) ? choice.target : undefined };
  return null;
}

// ---------------------------------------------------------------------------
// Resolution

function takeTurn(world: World, enc: Encounter, unit: Unit) {
  const events: CombatEvent[] = [];
  const id = unit.kind === 'hero' ? unit.h.id : unit.kind === 'monster' ? unit.m.id : unit.r.id;
  const speed = unit.kind === 'hero' ? speedOf(unit.h, world.time) : ENEMIES[unit.kind === 'monster' ? unit.m.type : unit.r.type].speed;
  enc.next[id] = at(enc.next[id] + speed);
  if (unit.kind === 'hero') heroTurn(world, enc, unit.h, events);
  else if (unit.kind === 'monster') monsterTurn(world, enc, unit.m, events);
  else risenTurn(world, enc, unit.r, events);
  record(enc, events);
}

/** Add what just happened to the fight's event list and log. */
function record(enc: Encounter, events: CombatEvent[]) {
  for (const e of events) e.seq = ++enc.seq;
  enc.events.push(...events);
  if (enc.events.length > 30) enc.events.splice(0, enc.events.length - 30);
  enc.log.push(...events.map((e) => e.text));
  if (enc.log.length > 40) enc.log.splice(0, enc.log.length - 40);
}

/** Effects that last "until X's next turn" end as X's turn begins. */
function endLingering(world: World, enc: Encounter, id: string) {
  for (const hid of enc.heroes) {
    const st = world.heroes[hid].st;
    if (st.vigil === id) delete st.vigil;
  }
}

/**
 * Poison and status timers, at the end of a unit's own turn. Every Poison ticks on its own (its own damage,
 * its own countdown); `adjust` turns each tick into the damage actually taken (armor, acid). Stops if the unit dies.
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
  for (const k of ['weak', 'acid'] as const) {
    if (st[k] !== undefined && --st[k]! <= 0) delete st[k];
  }
  if (st.hexed) {
    st.hexed = st.hexed.map((n) => n - 1).filter((n) => n > 0);
    if (st.hexed.length === 0) delete st.hexed;
  }
}

/** Is this unit in smoke right now? */
export function inSmoke(world: World, st: Statuses): boolean {
  return st.dodge !== undefined && st.dodge > world.time;
}

/** Cooldowns count the hero's own turns: "cooldown N" = unusable for their next N turns. */
export function tickCooldowns(h: Hero) {
  for (const k of Object.keys(h.cooldowns)) {
    h.cooldowns[k] = Math.max(0, h.cooldowns[k] - 1);
    if (h.cooldowns[k] === 0) delete h.cooldowns[k];
  }
}

/** A turn passing outside a fight: cooldowns and statuses tick as they would in one, Poison included. */
export function fieldTurn(world: World, h: Hero) {
  fieldTurnStart(h);
  fieldTurnEnd(world, h);
}

/** Before a field turn's action, as in a fight: cooldowns, Vengeance and Clang tick. */
export function fieldTurnStart(h: Hero) {
  tickCooldowns(h);
  startOfTurn(h.st);
}

/** After a field turn's action, as in a fight: Poison bites and Weak/Acid/Hexed count down (so a Bandage cures first). */
export function fieldTurnEnd(world: World, h: Hero) {
  if (!isConscious(h)) return;
  const events: CombatEvent[] = [];
  endOfTurn(h.st, h.name, h.id, (n) => armored(h, n), (n) => {
    if (hurtHero(world, h, n, null)) notify(world, h, `You take ${n} poison damage.`);
    return isConscious(h);
  }, events);
}

/** Statuses of a hero's own that tick at the start of their turn. */
function startOfTurn(st: Statuses) {
  if (st.vengeance !== undefined && --st.vengeance <= 0) delete st.vengeance;
  if (st.clang && --st.clang.turns <= 0) {
    if (--st.clang.stacks <= 0) delete st.clang;
    else st.clang.turns = CLASS_RULES.clangTurns;
  }
}

/** Anything that ticks per turn outside a fight. */
function hasFieldTimers(h: Hero): boolean {
  const st = h.st;
  return Object.keys(h.cooldowns).length > 0 || !!(st.poison || st.acid || st.hexed || st.weak || st.vengeance || st.clang);
}

/** While channelling (digging, reviving) outside a fight, each Speed's worth of time ticks cooldowns down as a turn would. */
export function tickFieldCooldowns(world: World, h: Hero, dt: number) {
  if (!hasFieldTimers(h)) {
    h.cdClock = 0;
    return;
  }
  h.cdClock += dt;
  const speed = speedOf(h, world.time);
  while (h.cdClock >= speed - 1e-6 && isConscious(h)) {
    h.cdClock -= speed;
    fieldTurn(world, h);
  }
}

/** Add a Poison alongside any already running. */
export function addPoison(st: Statuses, dmg: number, rounds: number) {
  (st.poison ??= []).push({ dmg, rounds });
}

/** What a monster actually takes from a hit of `dmg` (Acid adds to every one). */
function acidic(m: Monster, dmg: number): number {
  return m.st.acid ? dmg + CLASS_RULES.acidBonus : dmg;
}

function heroTurn(world: World, enc: Encounter, h: Hero, events: CombatEvent[]) {
  world.stats.turns++;
  endLingering(world, enc, h.id);
  delete h.st.brace;
  // The fallback is judged before cooldowns tick, so it matches what the hero's screen promised.
  let choice: Choice | undefined = enc.choices[h.id];
  delete enc.choices[h.id];
  // Things changed since it was picked (an ally joined, nothing left to raise…): fall back like an undecided hero.
  const picked = choice && abilityOf(h, choice.action);
  if (picked && unusableReason(world, enc, h, picked)) choice = undefined;
  if (!choice) {
    const auto = defaultChoice(world, enc, h);
    choice = auto ?? { action: 'brace' };
    events.push({ actor: h.id, kind: 'info', text: auto ? `${h.name} hesitates, then uses ${abilityOf(h, auto.action)!.name}.` : `${h.name} hesitates and braces.` });
  } else if (choice.target === undefined) {
    // Picked a move but not who to aim it at: it goes to the leftmost target on the fight screen.
    const target = leftmostTarget(world, enc, h, choice);
    if (target) choice = { ...choice, target };
  }
  tickCooldowns(h);
  startOfTurn(h.st);
  if (!lichAura(world, enc, h, events)) return;
  if (h.st.stun) {
    h.st.stun = false;
    events.push({ actor: h.id, kind: 'status', text: `${h.name} is stunned!` });
  } else if (h.affliction === 'fearful' && choice.action !== 'flee' && world.rng.chance(0.25)) {
    events.push({ actor: h.id, kind: 'info', text: `${h.name} panics!` });
    heroAct(world, enc, h, { action: 'flee' }, events);
  } else {
    heroAct(world, enc, h, choice, events);
  }
  if (isConscious(h) && h.encounter === enc.room) {
    endOfTurn(h.st, h.name, h.id, (n) => armored(h, n) + (enc.doom ?? 0), (n) => {
      applyHeroDamage(world, enc, h, n, events);
      return isConscious(h);
    }, events);
  }
}

/**
 * The Lich's aura: before a hero acts, every Lich in the fight hurts them. It can't be dodged or braced; armor
 * takes from it as usual, and darkness, Weak and Doom change it like any blow. Returns false if it took them down.
 */
function lichAura(world: World, enc: Encounter, h: Hero, events: CombatEvent[]): boolean {
  for (const m of monstersIn(world, enc.room)) {
    if (m.type !== 'lich' || !isConscious(h)) continue;
    let dmg = ENEMIES.lich.dmg * m.dmgMult;
    if (m.st.weak) dmg *= 0.5;
    if (h.light <= 0) dmg *= 1.25;
    dmg = armored(h, Math.max(1, Math.round(dmg))) + (enc.doom ?? 0);
    if (h.st.block) {
      const absorbed = Math.min(h.st.block, dmg);
      h.st.block -= absorbed;
      dmg -= absorbed;
      if (h.st.block <= 0) delete h.st.block;
    }
    events.push({
      actor: m.id, kind: 'damage', target: h.id, amount: dmg,
      text: dmg > 0 ? `The Lich's cold presence sears ${h.name} for ${dmg}.` : `The Lich's cold presence washes over ${h.name}, but it's blocked.`,
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
    targets = needsTarget(h, choice.action) ? validTargets(world, enc, h, choice.action) : [];
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
    endOfTurn(m.st, ENEMIES[m.type].name, m.id, (n) => acidic(m, n), (n) => {
      applyMonsterDamage(world, m, n, events);
      return !!world.monsters[m.id];
    }, events);
  }
}

/** The risen fight the monsters with their old attacks, then crumble when their turns run out. */
function risenTurn(world: World, enc: Encounter, r: Risen, events: CombatEvent[]) {
  const name = `Risen ${ENEMIES[r.type].name}`;
  const foes = combatOrder(world, enc).monsters;
  if (foes.length) {
    const dmg = Math.max(1, Math.round(ENEMIES[r.type].dmg * r.dmgMult));
    const hit = (m: Monster, verb: string) => {
      const taken = acidic(m, dmg);
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
      case 'brute':
        for (const m of foes.slice(0, 2)) hit(m, 'slams');
        break;
      case 'acolyte':
        hit(foes[foes.length - 1], 'curses');
        break;
      default:
        hit(foes[0], 'claws');
    }
  }
  if (!r.permanent && --r.turns <= 0 && r.hp > 0) {
    events.push({ actor: r.id, kind: 'death', target: r.id, text: `${name} crumbles back into dust.` });
    delete enc.next[r.id];
  }
}

function heroAct(world: World, enc: Encounter, h: Hero, c: Choice, events: CombatEvent[]) {
  const rng = world.rng;
  const room = enc.room;
  const allies = () => enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  const enemies = () => monstersIn(world, room);
  /** `first`: always the nearest enemy now. Otherwise the chosen one, re-picked at random if it died before our turn. */
  const pickEnemy = (first: boolean): Monster | null => {
    if (first) return combatOrder(world, enc).monsters[0] ?? null;
    const chosen = c.target ? world.monsters[c.target] : undefined;
    if (chosen && chosen.room === room) return chosen;
    const pool = enemies();
    return pool.length ? rng.pick(pool) : null;
  };
  const pickAlly = (): Hero | null => {
    const t = c.target ? world.heroes[c.target] : undefined;
    if (t && t !== h && t.affliction === 'paranoid') {
      events.push({ actor: t.id, kind: 'info', text: `${t.name} refuses ${h.name}'s help. (Paranoid)` });
      return null;
    }
    return t && isConscious(t) && t.encounter === room ? t : null;
  };

  if (c.action === 'brace') {
    h.st.brace = true;
    events.push({ actor: h.id, kind: 'info', text: `${h.name} braces.` });
    return;
  }
  if (c.action === 'flee') {
    const ghost = h.talent === 'ghostStep';
    if (ghost || inSmoke(world, h.st) || rng.chance(FLEE_CHANCE)) {
      if (enc.room === world.dungeon.exit && world.time >= EXIT_OPENS_AT) {
        leaveEncounter(world, enc, h);
        extractHero(world, h);
        events.push({ actor: h.id, kind: 'flee', text: `${h.name} escapes through the exit!` });
        return;
      }
      flee(world, enc, h);
      if (!ghost) addStress(h, 5);
      events.push({ actor: h.id, kind: 'flee', text: ghost ? `${h.name} slips away like a ghost.` : `${h.name} flees!` });
    } else {
      events.push({ actor: h.id, kind: 'info', text: `${h.name} tries to flee, but is cut off!` });
    }
    return;
  }
  if (c.action === 'item') {
    const idx = c.item ?? -1;
    const item = h.items[idx];
    const doubled = h.elixir; // applyItem uses it up
    const result = applyItem(world, h, idx, c.target);
    if (result.startsWith('!')) {
      events.push({ actor: h.id, kind: 'info', text: `${h.name} fumbles in their pack.` });
      return;
    }
    if (item === 'firebomb') {
      events.push({ actor: h.id, kind: 'status', text: result });
      for (const m of enemies()) heroHits(world, enc, h, m, doubled ? 16 : 8, events, 'Firebomb');
    } else {
      const t = c.target ?? h.id;
      events.push({ actor: h.id, kind: item === 'bandage' || item === 'salts' ? 'heal' : 'status', target: t, text: result });
    }
    // Volatile: every flask the Alchemist opens in a fight leaks fumes.
    if (h.talent === 'volatile') fumes(world, enc, h, events, true);
    return;
  }
  if (c.action === 'revive') {
    const t = c.target ? world.heroes[c.target] : undefined;
    if (t && !t.dead && t.downedAt !== null) {
      reviveHero(t, undefined, world, h);
      events.push({ actor: h.id, kind: 'heal', target: t.id, amount: t.hp, text: `${h.name} drags ${t.name} back to their feet.` });
    }
    return;
  }

  const ab = abilityOf(h, c.action)!;
  if (ab.cooldown > 0) h.cooldowns[ab.id] = ab.cooldown;
  switch (ab.id) {
    case 'bash': {
      const t = pickEnemy(true);
      if (!t) return;
      if (heroHits(world, enc, h, t, ab.power, events, ab.name) && world.monsters[t.id] && rng.chance(CLASS_RULES.bashStun)) {
        t.st.stun = true;
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} is stunned.` });
      }
      return;
    }
    case 'vengeance':
      h.st.vengeance = CLASS_RULES.vengeanceTurns + (h.talent === 'unyielding' ? TALENT_RULES.unyieldingTurns : 0);
      events.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name} swears vengeance. Whoever strikes them will feel it.` });
      return;
    case 'rally':
      for (const a of allies()) {
        a.st.block = (a.st.block ?? 0) + ab.power;
        addStress(a, -10);
      }
      events.push({ actor: h.id, kind: 'status', text: `${h.name} rallies the party! (+${ab.power} Shield, −10 stress)` });
      return;
    case 'backstab': {
      const t = pickEnemy(false);
      if (!t) return;
      const crit = !!(t.st.stun || !t.st.acted);
      heroHits(world, enc, h, t, crit ? ab.power * 2 : ab.power, events, ab.name, crit);
      return;
    }
    case 'cheap': {
      const t = pickEnemy(false);
      if (!t) return;
      heroHits(world, enc, h, t, ab.power, events, ab.name);
      if (world.monsters[t.id]) {
        t.st.stun = true;
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} is stunned.` });
      }
      return;
    }
    case 'smoke':
      for (const a of allies()) a.st.dodge = world.time + CLASS_RULES.smokeSecs;
      events.push({ actor: h.id, kind: 'status', text: `${h.name} hurls a smoke bomb! (${CLASS_RULES.smokeSecs}s)` });
      return;
    case 'mend': {
      // Triage: only ever the Lampbearer.
      const t = ab.target === 'self' ? h : pickAlly();
      if (!t || (t === h && ab.target !== 'self')) return;
      const healed = heal(t, ab.power);
      delete t.st.poison;
      events.push({ actor: h.id, kind: 'heal', target: t.id, amount: healed, text: `${h.name} mends ${t.name} (+${healed}).` });
      return;
    }
    case 'flare':
      flare(world, enc, h, events);
      return;
    case 'vigil': {
      const t = pickAlly();
      if (t) {
        addStress(t, -ab.power);
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${h.name} keeps vigil over ${t === h ? 'themself' : t.name}. (−${ab.power} stress)` });
      }
      if (othersIn(world, enc, h).length === 0) {
        h.st.vigil = h.id;
        events.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name} stands alone, lamp raised. Any move against them will meet the light.` });
      }
      return;
    }
    case 'hex': {
      const t = pickEnemy(false);
      if (!t) return;
      const stacks = t.st.hexed?.length ?? 0;
      heroHits(world, enc, h, t, ab.power * (1 + CLASS_RULES.hexedBonus * stacks), events, ab.name);
      if (world.monsters[t.id]) {
        (t.st.hexed ??= []).push(CLASS_RULES.hexedTurns);
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} is Hexed (×${t.st.hexed.length}).` });
      }
      return;
    }
    case 'wither':
      for (const m of enemies()) m.st.weak = CLASS_RULES.witherTurns;
      events.push({ actor: h.id, kind: 'status', text: `${h.name} withers every foe. (−50% damage)` });
      return;
    case 'pact': {
      for (const a of allies()) {
        const cost = Math.min(a.hp - 1, armored(a, CLASS_RULES.pactCost));
        if (cost <= 0) continue;
        a.hp -= cost;
        events.push({ actor: h.id, kind: 'damage', target: a.id, amount: cost, text: a === h ? `${h.name} spills their own blood.` : `The pact takes its due from ${a.name}.` });
      }
      for (const m of enemies()) heroHits(world, enc, h, m, ab.power, events, ab.name);
      return;
    }
    // ---- Undertaker ----
    case 'spade': {
      const t = pickEnemy(false);
      if (t) heroHits(world, enc, h, t, ab.power + h.spadeBonus, events, ab.name);
      return;
    }
    case 'rites': {
      const chosen = c.target ? world.monsters[c.target] : undefined;
      const wounded = enemies().filter((m) => m.hp < m.maxHp);
      const t = chosen && chosen.room === room && chosen.hp < chosen.maxHp ? chosen : wounded.length ? rng.pick(wounded) : null;
      if (!t) {
        events.push({ actor: h.id, kind: 'info', text: `${h.name} finds no one ready for the Last Rites.` });
        return;
      }
      events.push({ actor: h.id, kind: 'damage', target: t.id, amount: t.hp, crit: true, text: `${h.name} reads the Last Rites over the ${ENEMIES[t.type].name}.` });
      applyMonsterDamage(world, t, t.hp, events);
      h.spadeBonus += CLASS_RULES.spadePerRites;
      events.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name}'s spade grows heavier. (Spade +${h.spadeBonus})` });
      return;
    }
    case 'raise': {
      const dead = enc.lastSlain!;
      const hp = Math.max(1, Math.round(dead.maxHp * CLASS_RULES.raiseHp));
      enc.risen = {
        id: `r${world.nextId++}`, type: dead.type, hp, maxHp: hp, dmgMult: dead.dmgMult, by: h.id,
        turns: h.talent === 'restlessDead' ? TALENT_RULES.restlessTurns : CLASS_RULES.raiseTurns,
      };
      enc.lastSlain = null;
      // Raised, it's the Undertaker's: a Zombie won't get back up for the enemy, nor the Lich call it back.
      enc.slain = (enc.slain ?? []).filter((x) => x !== dead && (!dead.id || x.id !== dead.id));
      if (dead.id) world.risings = world.risings.filter((r) => r.id !== dead.id);
      events.push({ actor: h.id, kind: 'status', target: enc.risen.id, text: `${h.name} raises the fallen ${ENEMIES[dead.type].name}. It turns on its kin.` });
      return;
    }
    // ---- Bellwright ----
    case 'clang': {
      const t = pickEnemy(true);
      if (!t) return;
      heroHits(world, enc, h, t, ab.power, events, ab.name);
      if (world.monsters[t.id] && enc.next[t.id] !== undefined) {
        enc.next[t.id] = at(enc.next[t.id] + CLASS_RULES.clangDelay);
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} reels from the din. (+${CLASS_RULES.clangDelay}s)` });
      }
      // The ringing quickens the ringer: one more stack, and the timer starts over.
      h.st.clang = { stacks: (h.st.clang?.stacks ?? 0) + 1, turns: CLASS_RULES.clangTurns };
      return;
    }
    case 'peal':
      for (const a of othersIn(world, enc, h)) {
        if (enc.next[a.id] !== undefined) enc.next[a.id] = at(Math.max(world.time, enc.next[a.id] - CLASS_RULES.pealHaste));
        // Resonance: the note settles nerves and knits wounds.
        if (h.talent === 'resonance') {
          addStress(a, -TALENT_RULES.resonanceStress);
          const healed = heal(a, TALENT_RULES.resonanceHeal);
          if (healed) events.push({ actor: h.id, kind: 'heal', target: a.id, amount: healed, text: `The peal steadies ${a.name}. (+${healed})` });
        }
      }
      events.push({ actor: h.id, kind: 'status', text: `${h.name} rings a bright peal! (allies act ${CLASS_RULES.pealHaste}s sooner${h.talent === 'resonance' ? `, −${TALENT_RULES.resonanceStress} stress` : ''})` });
      return;
    case 'knell': {
      const dmg = knellDamage(ab.power, othersIn(world, enc, h).length);
      events.push({ actor: h.id, kind: 'status', text: `${h.name} tolls the knell.` });
      for (const m of enemies()) heroHits(world, enc, h, m, dmg, events, ab.name);
      return;
    }
    // ---- Zealot ----
    case 'scourge': {
      const t = pickEnemy(false);
      if (t) heroHits(world, enc, h, t, ab.power, events, ab.name);
      return;
    }
    case 'sins': {
      const t = pickAlly();
      if (!t) return;
      const moved = takeSins(h, t, ab.power);
      events.push({ actor: h.id, kind: 'stress', target: h.id, amount: moved, text: `${h.name} takes ${t.name}'s sins upon themself. (${moved} stress moved)` });
      // Martyr: and eases their wounds.
      if (h.talent === 'martyr') {
        const healed = heal(t, TALENT_RULES.martyrHeal);
        if (healed) events.push({ actor: h.id, kind: 'heal', target: t.id, amount: healed, text: `${t.name} is soothed. (+${healed})` });
      }
      return;
    }
    case 'absolution': {
      const spend = h.stress - CLASS_RULES.absolutionFloor;
      // Penitent: all of it becomes damage, but only half of it leaves.
      const paid = h.talent === 'penitent' ? Math.floor(spend / 2) : spend;
      const targets = enemies();
      const each = Math.ceil(spend / Math.max(1, targets.length));
      events.push({ actor: h.id, kind: 'status', text: `${h.name} pours out their torment! (−${paid} stress)` });
      // The damage is dealt at the stress it came from; then it's spent.
      for (const m of targets) heroHits(world, enc, h, m, each, events, ab.name);
      h.stress -= paid;
      return;
    }
    // ---- Alchemist ----
    case 'acid': {
      const t = pickEnemy(false);
      if (!t) return;
      if (heroHits(world, enc, h, t, ab.power, events, ab.name) && world.monsters[t.id]) {
        t.st.acid = CLASS_RULES.acidTurns;
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} is burned by acid.` });
      }
      return;
    }
    case 'fumes':
      fumes(world, enc, h, events);
      return;
    case 'elixir': {
      const t = pickAlly();
      if (!t) return;
      t.elixir = true;
      events.push({ actor: h.id, kind: 'status', target: t.id, text: `${h.name} hands ${t === h ? 'themself' : t.name} an elixir. (next item ×2)` });
      return;
    }
  }
}

/** Fumes: Poison on every enemy (`free`: Volatile's, set off by an item). */
function fumes(world: World, enc: Encounter, h: Hero, events: CombatEvent[], free = false) {
  const foes = monstersIn(world, enc.room);
  if (!foes.length) return;
  events.push({ actor: h.id, kind: 'status', text: free ? `Fumes spill from ${h.name}'s satchel!` : `${h.name} smashes a flask of fumes!` });
  for (const m of foes) addPoison(m.st, Math.round(CLASS_RULES.fumesPoison * damageMult(h, world)), CLASS_RULES.fumesTurns);
}

/** Light for everyone in the room (Flare, in or out of a fight). */
export function flareLight(world: World, room: number) {
  for (const x of Object.values(world.heroes)) {
    if (inDungeon(x) && x.pos.kind === 'room' && x.pos.room === room) x.light = Math.min(LIGHT_MAX, x.light + CLASS_RULES.flareLight);
  }
}

/** The Lampbearer's Flare: damage to every enemy and light for the room. */
function flare(world: World, enc: Encounter, h: Hero, events: CombatEvent[], free = false) {
  flareLight(world, enc.room);
  events.push({ actor: h.id, kind: 'status', text: `${h.name} ${free ? 'answers with a flare' : 'ignites a flare'}! (+${CLASS_RULES.flareLight} light)` });
  for (const m of monstersIn(world, enc.room)) heroHits(world, enc, h, m, abilityById('flare')!.power, events, 'Flare');
}

/** A lone Lampbearer keeping Vigil answers every enemy action with a free Flare (no cooldown). */
function vigilFlares(world: World, enc: Encounter, events: CombatEvent[]) {
  for (const id of enc.heroes) {
    const h = world.heroes[id];
    if (h.st.vigil === h.id && isConscious(h) && h.encounter === enc.room && monstersIn(world, enc.room).length) flare(world, enc, h, events, true);
  }
}

function heal(h: Hero, n: number): number {
  const before = h.hp;
  h.hp = Math.min(h.maxHp, h.hp + n);
  return h.hp - before;
}

/** Hero damages a monster. Returns true if it connected. */
function heroHits(world: World, _enc: Encounter, h: Hero, m: Monster, base: number, events: CombatEvent[], what: string, crit = false): boolean {
  let dmg = base * damageMult(h, world);
  if (h.st.weak) dmg *= 0.5;
  if (h.affliction === 'hopeless') dmg *= 0.7;
  dmg = acidic(m, Math.max(1, Math.round(dmg)));
  if (m.st.block) {
    const absorbed = Math.min(m.st.block, dmg);
    m.st.block -= absorbed;
    dmg -= absorbed;
  }
  events.push({
    actor: h.id, kind: 'damage', target: m.id, amount: dmg, crit,
    text: `${h.name}'s ${what} ${crit ? 'CRITS' : 'hits'} ${ENEMIES[m.type].name} for ${dmg}.`,
  });
  // Sanguine: the Sorceress drinks from every Hex on what she hurts.
  const hexes = m.st.hexed?.length ?? 0;
  if (h.talent === 'sanguine' && hexes > 0 && dmg > 0 && isConscious(h)) {
    const healed = heal(h, TALENT_RULES.sanguineHeal * hexes);
    if (healed) events.push({ actor: h.id, kind: 'heal', target: h.id, amount: healed, text: `${h.name} drinks from the hex. (+${healed})` });
  }
  applyMonsterDamage(world, m, dmg, events);
  return true;
}

function applyMonsterDamage(world: World, m: Monster, dmg: number, events: CombatEvent[]) {
  m.hp -= dmg;
  if (m.hp <= 0) {
    delete world.monsters[m.id];
    world.stats.slain++;
    events.push({ actor: m.id, kind: 'death', target: m.id, text: `${ENEMIES[m.type].name} is slain.` });
    const enc = world.encounters[m.room];
    const slain: Slain = { id: m.id, type: m.type, maxHp: m.maxHp, dmgMult: m.dmgMult, again: m.again };
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
    if (!m.again) world.bounty[m.room] = (world.bounty[m.room] ?? 0) + monsterPoints(m);
    if (monstersIn(world, m.room).length === 0 && (world.bounty[m.room] ?? 0) > 0) {
      dropBounty(world, m.room);
      events.push({ actor: m.id, kind: 'info', text: 'Something glints among the remains.' });
    }
  }
}

/** Bring a slain monster back whole in `room` (a Zombie rising, or the Lich's raising). */
function unslay(world: World, room: number, s: Slain, again: boolean): Monster {
  const m: Monster = { id: `m${world.nextId++}`, type: s.type, room, hp: s.maxHp, maxHp: s.maxHp, dmgMult: s.dmgMult, st: {}, again };
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
    if (enc) record(enc, [{ actor: m.id, kind: 'status', target: m.id, text }]);
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
 * the Bone Brute slams the two nearest, and the Acolyte whispers to a random hero or curses the farthest one.
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
      enc.doom = (enc.doom ?? 0) + CR_RULES.doom;
      events.push({ actor: m.id, kind: 'status', text: `${name} pronounces Doom. Every wound cuts deeper. (heroes take +${enc.doom} dmg this fight)` });
      return;
    }
    case 'crawler': {
      const t = monsterHits(world, enc, m, rng.pick(side), ENEMIES.crawler.dmg, 'bites', events);
      if (t && isConscious(t)) addPoison(t.st, 1, 3);
      return;
    }
    case 'acolyte':
      if (rng.chance(0.5)) {
        const t = rng.pick(heroes);
        const added = addStress(t, 6);
        events.push({
          actor: m.id, kind: 'stress', target: t.id, amount: added,
          text: added > 0 ? `${name} whispers to ${t.name}. (+${added} stress)` : `${name} whispers, but ${t.name} is unshaken.`,
        });
      } else {
        monsterHits(world, enc, m, side[0], ENEMIES.acolyte.dmg, 'curses', events);
      }
      return;
    case 'brute':
      for (const t of side.slice(-2)) monsterHits(world, enc, m, t, ENEMIES.brute.dmg, 'slams', events);
      return;
    case 'wight': {
      const t = monsterHits(world, enc, m, nearest, ENEMIES.wight.dmg, 'snuffs at', events);
      if (t && inDungeon(t)) {
        const before = t.light;
        t.light = Math.max(0, t.light - CR_RULES.wightSnuff);
        if (before > t.light) events.push({ actor: m.id, kind: 'status', target: t.id, text: `${t.name}'s light gutters. (−${Math.round(before - t.light)} light)` });
      }
      return;
    }
    case 'queen': {
      const court = monstersIn(world, enc.room).filter((o) => o !== m);
      if (court.length === 0) {
        // Dirge: the last of her court is gone, and she mourns loudly.
        for (const t of heroes) addStress(t, CR_RULES.dirgeStress);
        events.push({ actor: m.id, kind: 'stress', text: `${name} keens a dirge for her fallen court. (+${CR_RULES.dirgeStress} stress to all)` });
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
  const villagerText = maybeHitVillager(world, enc.room, Math.round(base * m.dmgMult), name);
  if (villagerText) {
    events.push({ actor: m.id, kind: 'info', text: villagerText });
    return null;
  }
  if (victim.kind === 'risen') {
    const r = victim.r;
    const dmg = Math.max(1, Math.round(base * m.dmgMult * (m.st.weak ? 0.5 : 1)));
    r.hp = Math.max(0, r.hp - dmg);
    const rname = `the risen ${ENEMIES[r.type].name}`;
    events.push({ actor: m.id, kind: 'damage', target: r.id, amount: dmg, text: `${name} ${verb} ${rname} for ${dmg}.` });
    if (r.hp <= 0) {
      events.push({ actor: r.id, kind: 'death', target: r.id, text: `${rname[0].toUpperCase()}${rname.slice(1)} falls apart.` });
      delete enc.next[r.id];
    }
    return null;
  }
  const t = victim.h;
  if (t.immuneUntil > world.time) {
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} ${t.name}, who does not even flinch. (Iron Oath)` });
    return null;
  }
  if (inSmoke(world, t.st) && world.rng.chance(0.5)) {
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} at ${t.name} — dodged!` });
    return null;
  }
  let dmg = base * m.dmgMult;
  if (m.st.weak) dmg *= 0.5;
  if (t.light <= 0) dmg *= 1.25;
  // Vengeance: the attacker takes the whole blow back, before any of the Warden's defences.
  const returned = t.st.vengeance ? Math.max(1, Math.round(dmg)) : 0;
  // Stalwart: the Warden takes less while standing nearest the enemy.
  if (t.cls === 'warden' && combatOrder(world, enc).heroes.filter(isConscious).at(-1) === t) dmg *= 0.8;
  if (t.st.brace) dmg *= 0.7;
  dmg = armored(t, Math.max(1, Math.round(dmg))) + (enc.doom ?? 0);
  if (t.st.block) {
    const absorbed = Math.min(t.st.block, dmg);
    t.st.block -= absorbed;
    dmg -= absorbed;
    if (t.st.block <= 0) delete t.st.block;
  }
  events.push({
    actor: m.id, kind: 'damage', target: t.id, amount: dmg,
    text: dmg > 0 ? `${name} ${verb} ${t.name} for ${dmg}.` : `${name} ${verb} ${t.name}, but it's blocked.`,
  });
  applyHeroDamage(world, enc, t, dmg, events);
  if (returned > 0 && world.monsters[m.id]) {
    const back = acidic(m, returned);
    events.push({ actor: t.id, kind: 'damage', target: m.id, amount: back, text: `Vengeance! ${name} takes ${back} back.` });
    applyMonsterDamage(world, m, back, events);
  }
  // Thorn Ring: a blow that lands costs the attacker.
  const thorns = wornStat(t, 'thorns');
  if (thorns > 0 && dmg > 0 && world.monsters[m.id] && m.hp > 0) {
    const back = acidic(m, thorns);
    events.push({ actor: t.id, kind: 'damage', target: m.id, amount: back, text: `Thorns! ${name} takes ${back}.` });
    applyMonsterDamage(world, m, back, events);
  }
  return t;
}

function applyHeroDamage(world: World, enc: Encounter, h: Hero, dmg: number, events: CombatEvent[]) {
  hurtHero(world, h, dmg, events, enc);
}

/**
 * Damage to a hero from anything (blows, poison, cave-ins…), which can take them down. Iron Oath catches the
 * first blow that would, once a run. Returns false if nothing landed.
 */
export function hurtHero(world: World, h: Hero, dmg: number, events: CombatEvent[] | null, enc?: Encounter): boolean {
  if (!isConscious(h) || dmg <= 0) return false;
  if (h.immuneUntil > world.time) return false;
  h.hp -= dmg;
  if (h.hp <= 0 && h.talent === 'ironOath' && !h.oathUsed) {
    h.oathUsed = true;
    h.hp = 1;
    h.immuneUntil = world.time + TALENT_RULES.oathImmune;
    events?.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name} refuses to fall! (Iron Oath: untouchable for ${TALENT_RULES.oathImmune}s)` });
    chronicle(world, `${h.name} kept their Iron Oath and stayed standing in ${roomName(world, h)}.`);
  }
  h.lowestHp = Math.min(h.lowestHp, Math.max(0, h.hp) / h.maxHp);
  syncInjuries(h);
  if (h.hp <= 0) downHero(world, h, events, enc);
  return true;
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

export function downHero(world: World, h: Hero, events: CombatEvent[] | null, enc?: Encounter) {
  h.hp = 0;
  h.downedAt = world.time;
  h.lowestHp = 0;
  h.downedMajor = true;
  syncInjuries(h);
  world.stats.downs++;
  h.st = {};
  h.channel = null;
  events?.push({ actor: h.id, kind: 'down', target: h.id, text: `${h.name} falls!` });
  chronicle(world, `${h.name} went down in ${roomName(world, h)}.`);
  const witnesses = enc ? enc.heroes.map((id) => world.heroes[id]) : Object.values(world.heroes);
  for (const w of witnesses) {
    if (w !== h && isConscious(w) && sameRoom(w, h)) addStress(w, 15);
  }
}

function sameRoom(a: Hero, b: Hero) {
  return a.pos.kind === 'room' && b.pos.kind === 'room' && a.pos.room === b.pos.room;
}

function flee(world: World, enc: Encounter, h: Hero) {
  leaveEncounter(world, enc, h);
  const d = world.dungeon;
  const from = enc.room;
  let to = h.prevRoom;
  if (to === null || !corridorBetween(d, from, to)) to = world.rng.pick(neighbours(d, from));
  const c = corridorBetween(d, from, to)!;
  h.pos = { kind: 'corridor', corridor: c.id, from, to, t: 0, dur: speedOf(h, world.time) };
  h.path = [];
  h.heading = null;
}

/** Bleed-out and death for downed heroes. Called every tick. */
export function tickDowned(world: World) {
  for (const h of Object.values(world.heroes)) {
    if (inDungeon(h) && h.downedAt !== null && world.time - h.downedAt >= BLEED_OUT) bleedOut(world, h);
  }
}

/** A downed hero dies where they lie: their things hit the floor, and anyone watching takes it hard. */
export function bleedOut(world: World, h: Hero) {
  h.dead = true;
  h.diedAt = world.time;
  h.fate = `bled out in ${roomName(world, h)}`;
  chronicle(world, `${h.name} bled out in ${roomName(world, h)}.`);
  dropEverything(world, h);
  const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
  if (enc) {
    enc.log.push(`${h.name} has died.`);
    enc.heroes = enc.heroes.filter((id) => id !== h.id);
  }
  h.encounter = null;
  for (const w of Object.values(world.heroes)) {
    // Mortician: the Undertaker finds a strange peace in it.
    if (w !== h && isConscious(w) && sameRoom(w, h)) addStress(w, w.cls === 'undertaker' ? -CLASS_RULES.morticianRelief : 25);
  }
}

