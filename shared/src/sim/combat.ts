import { ABILITIES, type AbilityDef } from '../content/abilities';
import { HERO_RANK } from '../content/classes';
import { EXIT_OPENS_AT, LIGHT_MAX } from '../content/constants';
import { ENCOUNTER_GROUPS, ENEMIES, ESCALATION, type EnemyId, type Rank } from '../content/enemies';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { ITEMS } from '../content/items';
import { applyItem, dropBounty, dropEverything, itemTargets, monsterPoints } from './loot';
import { maybeHitVillager } from './events';
import { chronicle, extractHero, roomName, type Hero, type World } from './world';
import { speedOf } from './speed';

export const BLEED_OUT = 36;
export const REVIVE_CHANNEL = 6;
export const REVIVE_HP_FRACTION = 0.3;
export const FLEE_CHANCE = 0.7;
export const STRESS_MAX = 100;

/** Turn counts are the affected unit's own turns: they tick down at the end of each of its turns. */
export interface Statuses {
  /** Skips its next turn. */
  stun?: boolean;
  /** `rounds`: turns of bleeding left. */
  bleed?: { dmg: number; rounds: number };
  /** Turns remaining. */
  mark?: number;
  block?: number;
  /** Deals half damage; turns remaining. */
  weak?: number;
  /** Immune to stress; turns remaining. */
  calm?: number;
  // ---- Until someone's next turn ----
  /** Guarded by this hero until the guard's next turn. */
  guardedBy?: string;
  /** In this hero's smoke (50% dodge, sure to flee) until the smoker's next turn. */
  dodge?: string;
  /** Bracing until their own next turn. */
  brace?: boolean;
}

export interface Monster {
  id: string;
  type: EnemyId;
  room: number;
  hp: number;
  maxHp: number;
  rank: Rank;
  dmgMult: number;
  st: Statuses;
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
      rank: def.rank,
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

export function heroRank(h: Hero): Rank {
  return HERO_RANK[h.cls];
}

export function addStress(h: Hero, amount: number) {
  if (amount > 0 && h.st.calm) return 0;
  if (amount > 0 && h.items.includes('ward')) amount *= 0.75;
  const before = h.stress;
  h.stress = Math.max(0, Math.min(STRESS_MAX, h.stress + amount));
  return h.stress - before;
}

/** Weapon bonus: multiplies every bit of damage this hero deals. */
export function damageMult(h: Hero): number {
  return 1 + (h.weapon ? ITEMS[h.weapon].dmgPct ?? 0 : 0);
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

function resetAfterFight(h: Hero) {
  h.encounter = null;
  h.cooldowns = {};
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
}

/**
 * Heroes and monsters in the order the fight screen shows them, left to right:
 * heroes back rank first (join order within a rank), monsters front rank first.
 * This is also who goes first when turns come up at the same moment.
 */
export function combatOrder(world: World, enc: Encounter): { heroes: Hero[]; monsters: Monster[] } {
  const heroes = enc.heroes.map((id, i) => ({ h: world.heroes[id], i }));
  const monsters = monstersIn(world, enc.room).map((m, i) => ({ m, i }));
  const backFirst = (h: Hero) => (heroRank(h) === 'back' ? 0 : 1);
  const frontFirst = (m: Monster) => (m.rank === 'front' ? 0 : 1);
  return {
    heroes: heroes.sort((a, b) => backFirst(a.h) - backFirst(b.h) || a.i - b.i).map((x) => x.h),
    monsters: monsters.sort((a, b) => frontFirst(a.m) - frontFirst(b.m) || a.i - b.i).map((x) => x.m),
  };
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

type Unit = { kind: 'hero'; h: Hero } | { kind: 'monster'; m: Monster };

/** The unit whose turn is due soonest (and is due now). Ties go to heroes before monsters, left to right. */
function nextUp(world: World, enc: Encounter): Unit | null {
  const { heroes, monsters } = combatOrder(world, enc);
  const units: (Unit & { t: number | undefined })[] = [
    ...heroes.filter(isConscious).map((h) => ({ kind: 'hero' as const, h, t: enc.next[h.id] })),
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
    case 'enemyFront': {
      const front = monsters.filter((m) => m.rank === 'front');
      return (front.length ? front : monsters).map((m) => m.id);
    }
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
  return !!ab && ['enemy', 'enemyFront', 'ally', 'otherAlly'].includes(ab.target);
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
      if (!choice.target || !targets.includes(choice.target)) return 'Pick a valid target.';
    }
    enc.choices[h.id] = { action: 'item', item: idx, target: def.target === 'ally' || def.target === 'downed' ? choice.target : undefined };
    return null;
  }
  const ab = abilityOf(h, choice.action);
  if (ab && (h.cooldowns[ab.id] ?? 0) > 0) return `${ab.name} is on cooldown.`;
  if (needsTarget(h, choice.action)) {
    const targets = validTargets(world, enc, h, choice.action);
    if (targets.length === 0) return 'No valid target.';
    if (!choice.target || !targets.includes(choice.target)) return 'Pick a valid target.';
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
  const id = unit.kind === 'hero' ? unit.h.id : unit.m.id;
  const speed = unit.kind === 'hero' ? speedOf(unit.h, world.time) : ENEMIES[unit.m.type].speed;
  enc.next[id] = at(enc.next[id] + speed);
  if (unit.kind === 'hero') heroTurn(world, enc, unit.h, events);
  else monsterTurn(world, enc, unit.m, events);
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
    if (st.guardedBy === id) delete st.guardedBy;
    if (st.dodge === id) delete st.dodge;
  }
}

/** Bleeding and status timers, at the end of a unit's own turn. */
function endOfTurn(st: Statuses, name: string, id: string, reduce: (n: number) => number, hurt: (n: number) => void, events: CombatEvent[]) {
  if (st.bleed) {
    const dmg = reduce(st.bleed.dmg);
    events.push({ actor: id, kind: 'damage', target: id, amount: dmg, text: `${name} bleeds for ${dmg}.` });
    if (--st.bleed.rounds <= 0) delete st.bleed;
    hurt(dmg);
  }
  for (const k of ['mark', 'weak', 'calm'] as const) {
    if (st[k] !== undefined && --st[k]! <= 0) delete st[k];
  }
}

function heroTurn(world: World, enc: Encounter, h: Hero, events: CombatEvent[]) {
  world.stats.turns++;
  endLingering(world, enc, h.id);
  delete h.st.brace;
  // The fallback is judged before cooldowns tick, so it matches what the hero's screen promised.
  let choice = enc.choices[h.id];
  delete enc.choices[h.id];
  if (!choice) {
    const auto = defaultChoice(world, enc, h);
    choice = auto ?? { action: 'brace' };
    events.push({ actor: h.id, kind: 'info', text: auto ? `${h.name} hesitates, then uses ${abilityOf(h, auto.action)!.name}.` : `${h.name} hesitates and braces.` });
  }
  // Cooldowns count the hero's own turns: "cooldown N" = unusable for their next N turns.
  for (const k of Object.keys(h.cooldowns)) h.cooldowns[k] = Math.max(0, h.cooldowns[k] - 1);
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
    endOfTurn(h.st, h.name, h.id, (n) => armored(h, n), (n) => applyHeroDamage(world, enc, h, n, events), events);
  }
}

function monsterTurn(world: World, enc: Encounter, m: Monster, events: CombatEvent[]) {
  endLingering(world, enc, m.id);
  if (m.st.stun) {
    m.st.stun = false;
    events.push({ actor: m.id, kind: 'status', text: `${ENEMIES[m.type].name} is stunned!` });
  } else {
    monsterAct(world, enc, m, events);
  }
  if (world.monsters[m.id]) endOfTurn(m.st, ENEMIES[m.type].name, m.id, (n) => n, (n) => applyMonsterDamage(world, m, n, events), events);
}

function heroAct(world: World, enc: Encounter, h: Hero, c: Choice, events: CombatEvent[]) {
  const rng = world.rng;
  const room = enc.room;
  const allies = () => enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  const enemies = () => monstersIn(world, room);
  /** Re-pick a target if the chosen one died before our turn. */
  const pickEnemy = (front: boolean): Monster | null => {
    const chosen = c.target ? world.monsters[c.target] : undefined;
    if (chosen && chosen.room === room) return chosen;
    const pool = enemies();
    const fr = pool.filter((m) => m.rank === 'front');
    const list = front && fr.length ? fr : pool;
    return list.length ? rng.pick(list) : null;
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
    if (h.st.dodge || rng.chance(FLEE_CHANCE)) {
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
    const result = applyItem(world, h, idx, c.target);
    if (result.startsWith('!')) {
      events.push({ actor: h.id, kind: 'info', text: `${h.name} fumbles in their pack.` });
      return;
    }
    if (item === 'firebomb') {
      events.push({ actor: h.id, kind: 'status', text: result });
      for (const m of enemies()) heroHits(world, enc, h, m, 8, events, 'Firebomb');
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
  h.cooldowns[ab.id] = ab.cooldown;
  switch (ab.id) {
    case 'bash': {
      const t = pickEnemy(true);
      if (!t) return;
      if (heroHits(world, enc, h, t, ab.power, events, ab.name) && world.monsters[t.id] && rng.chance(0.35)) {
        t.st.stun = true;
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} is stunned.` });
      }
      return;
    }
    case 'guard': {
      const t = pickAlly();
      if (!t) return;
      t.st.guardedBy = h.id;
      events.push({ actor: h.id, kind: 'status', target: t.id, text: `${h.name} guards ${t.name}.` });
      return;
    }
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
      const crit = !!(t.st.stun || t.st.mark);
      heroHits(world, enc, h, t, crit ? ab.power * 2 : ab.power, events, ab.name, crit);
      return;
    }
    case 'poison': {
      const t = pickEnemy(false);
      if (!t) return;
      if (heroHits(world, enc, h, t, ab.power, events, ab.name) && world.monsters[t.id]) {
        t.st.bleed = { dmg: Math.round(3 * damageMult(h)), rounds: 3 };
        events.push({ actor: h.id, kind: 'status', target: t.id, text: `${ENEMIES[t.type].name} is bleeding.` });
      }
      return;
    }
    case 'smoke':
      for (const a of allies()) a.st.dodge = h.id;
      events.push({ actor: h.id, kind: 'status', text: `${h.name} hurls a smoke bomb!` });
      return;
    case 'mend': {
      const t = pickAlly();
      if (!t) return;
      const healed = heal(t, ab.power);
      delete t.st.bleed;
      events.push({ actor: h.id, kind: 'heal', target: t.id, amount: healed, text: `${h.name} mends ${t.name} (+${healed}).` });
      return;
    }
    case 'flare':
      for (const x of Object.values(world.heroes)) {
        if (inDungeon(x) && x.pos.kind === 'room' && x.pos.room === room) x.light = Math.min(LIGHT_MAX, x.light + 10);
      }
      events.push({ actor: h.id, kind: 'status', text: `${h.name} ignites a flare! (+10 light)` });
      for (const m of enemies()) {
        if (heroHits(world, enc, h, m, ab.power, events, ab.name) && world.monsters[m.id] && ENEMIES[m.type].undead) m.st.mark = 3;
      }
      return;
    case 'vigil': {
      const t = pickAlly();
      if (!t) return;
      addStress(t, -ab.power);
      t.st.calm = 2;
      events.push({ actor: h.id, kind: 'status', target: t.id, text: `${h.name} keeps vigil over ${t.name}. (−15 stress)` });
      return;
    }
    case 'hex': {
      const t = pickEnemy(false);
      if (!t) return;
      if (heroHits(world, enc, h, t, ab.power, events, ab.name) && world.monsters[t.id]) t.st.mark = 3;
      return;
    }
    case 'wither': {
      const t = pickEnemy(false);
      if (!t) return;
      t.st.weak = 2;
      events.push({ actor: h.id, kind: 'status', target: t.id, text: `${h.name} withers the ${ENEMIES[t.type].name}.` });
      return;
    }
    case 'pact': {
      const cost = armored(h, 6);
      h.hp = Math.max(1, h.hp - cost);
      events.push({ actor: h.id, kind: 'damage', target: h.id, amount: cost, text: `${h.name} spills their own blood.` });
      const targets = enemies();
      const each = Math.ceil(ab.power / Math.max(1, targets.length));
      for (const m of targets) heroHits(world, enc, h, m, each, events, ab.name);
      const weakest = allies().filter((a) => a === h || a.affliction !== 'paranoid').sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (weakest) {
        const healed = heal(weakest, 6);
        events.push({ actor: h.id, kind: 'heal', target: weakest.id, amount: healed, text: `${weakest.name} is restored (+${healed}).` });
      }
      return;
    }
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
  dmg = Math.max(1, Math.round(dmg));
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
    world.bounty[m.room] = (world.bounty[m.room] ?? 0) + monsterPoints(m);
    if (monstersIn(world, m.room).length === 0) {
      dropBounty(world, m.room);
      events.push({ actor: m.id, kind: 'info', text: 'Something glints among the remains.' });
    }
  }
}

function monsterAct(world: World, enc: Encounter, m: Monster, events: CombatEvent[]) {
  const rng = world.rng;
  const name = ENEMIES[m.type].name;
  const conscious = enc.heroes.map((id) => world.heroes[id]).filter(isConscious);
  if (conscious.length === 0) return;
  const front = conscious.filter((h) => heroRank(h) === 'front');
  const back = conscious.filter((h) => heroRank(h) === 'back');
  const frontOrAny = () => rng.pick(front.length ? front : conscious);

  switch (m.type) {
    case 'ghoul':
      monsterHits(world, enc, m, frontOrAny(), ENEMIES.ghoul.dmg, 'claws', events);
      return;
    case 'crawler': {
      const t = monsterHits(world, enc, m, frontOrAny(), ENEMIES.crawler.dmg, 'bites', events);
      if (t && isConscious(t)) t.st.bleed = { dmg: 1, rounds: 3 };
      return;
    }
    case 'acolyte':
      if (rng.chance(0.5)) {
        const t = rng.pick(conscious);
        const added = addStress(t, 6);
        events.push({
          actor: m.id, kind: 'stress', target: t.id, amount: added,
          text: added > 0 ? `${name} whispers to ${t.name}. (+${added} stress)` : `${name} whispers, but ${t.name} is unshaken.`,
        });
      } else {
        monsterHits(world, enc, m, rng.pick(back.length ? back : conscious), ENEMIES.acolyte.dmg, 'curses', events);
      }
      return;
    case 'brute':
      for (const t of front.length ? front : [frontOrAny()]) monsterHits(world, enc, m, t, ENEMIES.brute.dmg, 'slams', events);
      return;
  }
}

/** Monster attacks a hero, honouring Guard, dodge, brace, Block and darkness. Returns who was actually hit. */
function monsterHits(world: World, enc: Encounter, m: Monster, target: Hero, base: number, verb: string, events: CombatEvent[]): Hero | null {
  const name = ENEMIES[m.type].name;
  const villagerText = maybeHitVillager(world, enc.room, Math.round(base * m.dmgMult), name);
  if (villagerText) {
    events.push({ actor: m.id, kind: 'info', text: villagerText });
    return null;
  }
  let t = target;
  const guard = t.st.guardedBy ? world.heroes[t.st.guardedBy] : undefined;
  if (guard && isConscious(guard) && guard.encounter === enc.room && guard !== t) {
    events.push({ actor: guard.id, kind: 'info', target: t.id, text: `${guard.name} steps in front of ${t.name}!` });
    t = guard;
  }
  if (t.st.dodge && world.rng.chance(0.5)) {
    events.push({ actor: m.id, kind: 'miss', target: t.id, text: `${name} ${verb} at ${t.name} — dodged!` });
    return null;
  }
  let dmg = base * m.dmgMult;
  if (m.st.weak) dmg *= 0.5;
  if (t.light <= 0) dmg *= 1.25;
  if (t.cls === 'warden' && heroRank(t) === 'front') dmg *= 0.8;
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
        if (w !== h && isConscious(w) && sameRoom(w, h)) addStress(w, 25);
      }
    }
  }
}

