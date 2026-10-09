import { ABILITIES, CLASS_RULES, abilityById, type AbilityDef } from '../content/abilities';
import { EXIT_OPENS_AT, LIGHT_MAX } from '../content/constants';
import { ENCOUNTER_GROUPS, ENEMIES, ESCALATION, type EnemyId } from '../content/enemies';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { ITEMS } from '../content/items';
import { applyItem, dropBounty, dropEverything, itemTargets, monsterPoints } from './loot';
import { maybeHitVillager } from './events';
import { chronicle, extractHero, roomName, type Hero, type World } from './world';
import { speedOf } from './speed';

export const BLEED_OUT = 36;
export const REVIVE_CHANNEL = 6;
export const REVIVE_HP_FRACTION = 0.3;
export const FLEE_CHANCE = 0.5;
export const STRESS_MAX = 100;

/** Turn counts are the affected unit's own turns: they tick down at the end of each of its turns. */
export interface Statuses {
  /** Skips its next turn. */
  stun?: boolean;
  /** Each Bleed runs on its own: `rounds` = turns of bleeding left for that one. */
  bleed?: Bleed[];
  /** Acid: takes CLASS_RULES.acidBonus more from every hit; turns remaining. */
  acid?: number;
  /** Hexed: one entry per stack, each the turns it has left. Every stack adds CLASS_RULES.hexedBonus to Hex's damage. */
  hexed?: number[];
  block?: number;
  /** Deals half damage; turns remaining. */
  weak?: number;
  /** Warden's Vengeance: attackers take their attack back. Own turns remaining (ticks at the start of each). */
  vengeance?: number;
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

export interface Bleed {
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
  lastSlain?: { type: EnemyId; maxHp: number; dmgMult: number } | null;
  risen?: Risen | null;
}

// ---------------------------------------------------------------------------
// Spawning

export function spawnInitialMonsters(world: World) {
  const d = world.dungeon;
  const safe = new Set([d.entrance, d.exit, ...neighbours(d, d.entrance)]);
  for (const room of d.rooms) {
    if (safe.has(room.id) || !world.rng.chance(ESCALATION.roomMonsterChance)) continue;
    spawnGroup(world, room.id, pickGroup(world), 0);
  }
}

export function pickGroup(world: World, tier = 0): EnemyId[] {
  const groups = ENCOUNTER_GROUPS.filter((g) => (g.minTier ?? 0) <= tier);
  const total = groups.reduce((s, g) => s + g.weight, 0);
  let roll = world.rng.float(0, total);
  for (const g of groups) {
    roll -= g.weight;
    if (roll <= 0) return g.units;
  }
  return groups[0].units;
}

export function spawnGroup(world: World, room: number, units: EnemyId[], tier: number): Monster[] {
  const scale = 1 + ESCALATION.tierScaling * tier;
  return units.map((type) => {
    const def = ENEMIES[type];
    const m: Monster = {
      id: `m${world.nextId++}`,
      type,
      room,
      hp: Math.round(def.maxHp * scale),
      maxHp: Math.round(def.maxHp * scale),
      dmgMult: scale,
      st: {},
    };
    world.monsters[m.id] = m;
    return m;
  });
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
  if (amount > 0 && h.items.includes('ward')) amount *= 0.75;
  const before = h.stress;
  h.stress = Math.max(0, Math.min(STRESS_MAX, h.stress + amount));
  return h.stress - before;
}

/** Weapon bonus (and the Zealot's stress): multiplies every bit of damage this hero deals. */
export function damageMult(h: Hero): number {
  const weapon = 1 + (h.weapon ? ITEMS[h.weapon].dmgPct ?? 0 : 0);
  const zeal = h.cls === 'zealot' ? 1 + h.stress * CLASS_RULES.zealotDmgPerStress : 1;
  return weapon * zeal;
}

/** Zealot: move up to `max` stress from an ally onto yourself (ignores Calm and Ward Charm). Returns how much moved. */
export function takeSins(zealot: Hero, t: Hero, max: number): number {
  const moved = Math.min(max, t.stress);
  t.stress -= moved;
  zealot.stress = Math.min(STRESS_MAX, zealot.stress + moved);
  return moved;
}

/** Armor: flat reduction on any damage this hero takes, from any source. A hit always does at least 1. */
export function armored(h: Hero, dmg: number): number {
  if (dmg <= 0 || !h.armor) return dmg;
  return Math.max(1, dmg - (ITEMS[h.armor].armor ?? 0));
}

export function reviveHero(h: Hero, fraction = REVIVE_HP_FRACTION, world?: World, by?: Hero) {
  h.downedAt = null;
  if (world) world.stats.revives++;
  if (world) chronicle(world, by ? `${by.name} got ${h.name} back on their feet.` : `${h.name} got back up.`);
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
  } else {
    enlist(enc, hero);
    enc.log.push(`${hero.name} joins the fight.`);
  }
  startTimers(world, enc);
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
  enc.heroes = enc.heroes.filter((id) => id !== h.id);
  delete enc.choices[h.id];
  delete enc.next[h.id];
  resetAfterFight(h);
}

/** Cooldowns carry on outside the fight (see `tickFieldCooldowns`). */
function resetAfterFight(h: Hero) {
  h.encounter = null;
  h.cdClock = 0;
  const bleed = h.st.bleed;
  h.st = bleed ? { bleed } : {};
}

function endEncounter(world: World, enc: Encounter) {
  for (const id of enc.heroes) {
    const h = world.heroes[id];
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
    else enc.next[id] ??= at(world.time + speedOf(h, world.time));
  }
  for (const m of monstersIn(world, enc.room)) enc.next[m.id] ??= at(world.time + ENEMIES[m.type].speed);
  if (enc.risen) enc.next[enc.risen.id] ??= at(world.time + ENEMIES[enc.risen.type].speed);
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
  const risen = risenOf(enc);
  const units: (Unit & { t: number | undefined })[] = [
    ...heroes.filter(isConscious).map((h) => ({ kind: 'hero' as const, h, t: enc.next[h.id] })),
    ...(risen ? [{ kind: 'risen' as const, r: risen, t: enc.next[risen.id] }] : []),
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
  const abilities: readonly AbilityDef[] = ABILITIES[h.cls];
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
export function readyAbilities(cls: Hero['cls'], cooldowns: Record<string, number>): (0 | 1 | 2)[] {
  return ([0, 1, 2] as const).filter((i) => (cooldowns[ABILITIES[cls][i].id] ?? 0) <= 0);
}

/**
 * What a hero does if their turn comes before they've picked: the first ability that's ready and has a
 * target, aimed sensibly (an enemy for attacks, the most hurt ally for heals). Null if none can be used
 * (then they brace).
 */
export function defaultChoice(world: World, enc: Encounter, h: Hero): Choice | null {
  for (const i of readyAbilities(h.cls, h.cooldowns)) {
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
 * Bleeding and status timers, at the end of a unit's own turn. Every Bleed ticks on its own (its own damage,
 * its own countdown); `adjust` turns each tick into the damage actually taken (armor, acid). Stops if the unit dies.
 */
function endOfTurn(st: Statuses, name: string, id: string, adjust: (n: number) => number, hurt: (n: number) => boolean, events: CombatEvent[]) {
  for (const b of [...(st.bleed ?? [])]) {
    const dmg = adjust(b.dmg);
    events.push({ actor: id, kind: 'damage', target: id, amount: dmg, text: `${name} bleeds for ${dmg}.` });
    b.rounds--;
    if (st.bleed) st.bleed = st.bleed.filter((x) => x.rounds > 0);
    if (st.bleed?.length === 0) delete st.bleed;
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

/** Outside a fight, a turn's worth of time (the hero's Speed) ticks cooldowns down just as a turn in a fight does. */
export function tickFieldCooldowns(world: World, h: Hero, dt: number) {
  if (Object.keys(h.cooldowns).length === 0) {
    h.cdClock = 0;
    return;
  }
  h.cdClock += dt;
  const speed = speedOf(h, world.time);
  while (h.cdClock >= speed - 1e-6) {
    h.cdClock -= speed;
    tickCooldowns(h);
  }
}

/** Add a Bleed alongside any already running. */
export function addBleed(st: Statuses, dmg: number, rounds: number) {
  (st.bleed ??= []).push({ dmg, rounds });
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
  if (h.st.vengeance !== undefined && --h.st.vengeance <= 0) delete h.st.vengeance;
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
    endOfTurn(h.st, h.name, h.id, (n) => armored(h, n), (n) => {
      applyHeroDamage(world, enc, h, n, events);
      return isConscious(h);
    }, events);
  }
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
        if (world.monsters[m.id]) addBleed(m.st, 1, 3);
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
  if (--r.turns <= 0 && r.hp > 0) {
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
    if (inSmoke(world, h.st) || rng.chance(FLEE_CHANCE)) {
      if (enc.room === world.dungeon.exit && world.time >= EXIT_OPENS_AT) {
        leaveEncounter(world, enc, h);
        extractHero(world, h);
        events.push({ actor: h.id, kind: 'flee', text: `${h.name} escapes through the exit!` });
        return;
      }
      flee(world, enc, h);
      addStress(h, 5);
      events.push({ actor: h.id, kind: 'flee', text: `${h.name} flees!` });
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
      h.st.vengeance = CLASS_RULES.vengeanceTurns;
      events.push({ actor: h.id, kind: 'status', target: h.id, text: `${h.name} swears vengeance. Whoever strikes them will feel it.` });
      return;
    case 'rally':
      for (const a of allies()) {
        a.st.block = (a.st.block ?? 0) + ab.power;
        addStress(a, -10);
      }
      events.push({ actor: h.id, kind: 'status', text: `${h.name} rallies the party! (+${ab.power} Block, −10 stress)` });
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
      const t = pickAlly();
      if (!t || t === h) return;
      const healed = heal(t, ab.power);
      delete t.st.bleed;
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
      enc.risen = { id: `r${world.nextId++}`, type: dead.type, hp, maxHp: hp, dmgMult: dead.dmgMult, turns: CLASS_RULES.raiseTurns, by: h.id };
      enc.lastSlain = null;
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
      return;
    }
    case 'peal':
      for (const a of othersIn(world, enc, h)) {
        if (enc.next[a.id] !== undefined) enc.next[a.id] = at(Math.max(world.time, enc.next[a.id] - ab.power));
      }
      events.push({ actor: h.id, kind: 'status', text: `${h.name} rings a bright peal! (allies act ${ab.power}s sooner)` });
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
      return;
    }
    case 'absolution': {
      const spend = h.stress - CLASS_RULES.absolutionFloor;
      const targets = enemies();
      const each = Math.ceil(spend / Math.max(1, targets.length));
      events.push({ actor: h.id, kind: 'status', text: `${h.name} pours out their torment! (−${spend} stress)` });
      // The damage is dealt at the stress it came from; then it's spent.
      for (const m of targets) heroHits(world, enc, h, m, each, events, ab.name);
      h.stress = CLASS_RULES.absolutionFloor;
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
      events.push({ actor: h.id, kind: 'status', text: `${h.name} smashes a flask of fumes!` });
      for (const m of enemies()) addBleed(m.st, Math.round(CLASS_RULES.fumesBleed * damageMult(h)), CLASS_RULES.fumesTurns);
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
  let dmg = base * damageMult(h);
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
    if (enc) enc.lastSlain = { type: m.type, maxHp: m.maxHp, dmgMult: m.dmgMult };
    world.bounty[m.room] = (world.bounty[m.room] ?? 0) + monsterPoints(m);
    if (monstersIn(world, m.room).length === 0) {
      dropBounty(world, m.room);
      events.push({ actor: m.id, kind: 'info', text: 'Something glints among the remains.' });
    }
  }
}

/** The heroes' side as monsters see it, left to right: conscious heroes, then the risen (nearest of all). */
type Victim = { kind: 'hero'; h: Hero } | { kind: 'risen'; r: Risen };

function victims(world: World, enc: Encounter): Victim[] {
  const heroes = combatOrder(world, enc).heroes.filter(isConscious).map((h) => ({ kind: 'hero' as const, h }));
  const risen = risenOf(enc);
  return risen ? [...heroes, { kind: 'risen' as const, r: risen }] : heroes;
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
      monsterHits(world, enc, m, nearest, ENEMIES.ghoul.dmg, 'claws', events);
      return;
    case 'crawler': {
      const t = monsterHits(world, enc, m, rng.pick(side), ENEMIES.crawler.dmg, 'bites', events);
      if (t && isConscious(t)) addBleed(t.st, 1, 3);
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
  }
}

/**
 * Monster attacks a hero (or the risen), honouring Guard, dodge, brace, Block and darkness.
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
  dmg = armored(t, Math.max(1, Math.round(dmg)));
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
  return t;
}

function applyHeroDamage(world: World, enc: Encounter, h: Hero, dmg: number, events: CombatEvent[]) {
  if (!isConscious(h)) return;
  h.hp -= dmg;
  if (h.hp <= 0) downHero(world, h, events, enc);
}

export function downHero(world: World, h: Hero, events: CombatEvent[] | null, enc?: Encounter) {
  h.hp = 0;
  h.downedAt = world.time;
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
    if (!inDungeon(h) || h.downedAt === null) continue;
    if (world.time - h.downedAt >= BLEED_OUT) {
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
  }
}

