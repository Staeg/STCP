import type { Rng } from '../rng';
import type { ShardId } from './regalia';

export type EnemyId = 'ghoul' | 'crawler' | 'acolyte' | 'giant' | 'wight' | 'queen' | 'zombie' | 'lich' | 'king' | 'wolf';

/**
 * Power tier: 0 the common dead, 4 the worst there is. Which units of tiers 0–3 a run uses is rolled (see `Roster`);
 * T4 only ever comes from its event (the Dead King, with Crowned in Dread).
 */
export type Tier = 0 | 1 | 2 | 3 | 4;
/** The tiers a run's roster, its encounter tables and Challenge Rating draw on. */
export type RosterTier = Exclude<Tier, 4>;

export interface EnemyDef {
  id: EnemyId;
  name: string;
  tier: Tier;
  maxHp: number;
  /** Speed: seconds between its turns. Default 5; lower is quicker. */
  speed: number;
  /** Base damage of its main attack (scaled by Escalation). */
  dmg: number;
  /** Block: flat reduction on any damage it takes, from any source (a hit always does at least 1), as a hero's. */
  block: number;
  undead: boolean;
  /** Never more than one to a room. */
  onePerRoom?: boolean;
  /** Never spawns on its own: a group that would be only this gets one of the run's T0 units beside it. */
  needsCompany?: boolean;
  /** Only ever spawned by its event, never by the roster or Challenge Rating. */
  eventOnly?: boolean;
  /** Fights for the heroes, never against them (Howl's wolves). Not in the Bestiary. */
  ally?: boolean;
  /** A Boss's regalia: killed, it drops Shards of it for the players who still need one (see `content/regalia.ts`). */
  regalia?: ShardId;
  /** Placeholder glyph until sprites (M9). */
  glyph: string;
  desc: string;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  // ---- T0 ----
  ghoul: { id: 'ghoul', name: 'Ghoul', tier: 0, maxHp: 14, speed: 5, dmg: 4, block: 0, undead: true, glyph: '☠', desc: 'Claw: 4 dmg to the nearest hero.' },
  crawler: { id: 'crawler', name: 'Crawler', tier: 0, maxHp: 8, speed: 3, dmg: 2, block: 0, undead: false, glyph: '✷', desc: 'Fast. Bite: 2 dmg + Poison to a random hero.' },
  acolyte: { id: 'acolyte', name: 'Acolyte', tier: 0, maxHp: 11, speed: 4, dmg: 3, block: 0, undead: false, glyph: '♆', desc: 'Whisper: +4 stress to a random hero, or Curse: 3 dmg to the farthest hero.' },
  // ---- T1 ----
  wight: { id: 'wight', name: 'Lantern Wight', tier: 1, maxHp: 16, speed: 5, dmg: 3, block: 0, undead: true, glyph: '♰', desc: 'Snuff: 3 dmg and −15 light to the nearest hero.' },
  zombie: { id: 'zombie', name: 'Zombie', tier: 1, maxHp: 10, speed: 5, dmg: 3, block: 0, undead: true, glyph: '⚰',
    desc: 'Claw: 3 dmg to the nearest hero. Gets back up 12s after it dies, where it fell, unless an Undertaker raises it.' },
  // ---- T2 ----
  giant: { id: 'giant', name: 'Bone Giant', tier: 2, maxHp: 34, speed: 8, dmg: 7, block: 3, undead: true, glyph: '♜', desc: 'Slow. Slam: 7 dmg to the two nearest heroes. Block 3: every hit on it does 3 less (at least 1).' },
  queen: { id: 'queen', name: 'Forsaken Queen', tier: 2, maxHp: 32, speed: 6, dmg: 4, block: 0, undead: false, glyph: '♛', onePerRoom: true, needsCompany: true,
    desc: 'Hymn: every other monster heals 4 and acts 2s sooner. Alone, Dirge: +5 stress to every hero.' },
  // ---- T3 ----
  lich: { id: 'lich', name: 'Lich', tier: 3, maxHp: 30, speed: 6, dmg: 3, block: 0, undead: true, glyph: '♚', onePerRoom: true,
    desc: 'Aura: every hero takes 3 dmg before each of their turns. Once a fight it raises a slain monster whole; otherwise Doom: every hero in the fight gains a stack of +1 dmg taken from everything. Stacks hold while a Lich stands in their fight, then fade one per turn of theirs, even after the fight.' },
  // ---- T4: only with Crowned in Dread (user, 2026-10-11) ----
  king: { id: 'king', name: 'Dead King', tier: 4, maxHp: 100, speed: 10, dmg: 10, block: 0, undead: true, glyph: '♔', onePerRoom: true, eventOnly: true, regalia: 'crown',
    desc: 'Very slow. Block 3 for every other monster still standing in the fight. Takes turns between Kneel (every hero in the fight is Stunned) and Charge (10 dmg to the nearest hero; every monster in the fight is 1s faster until it ends), starting with either. Slain, his regalia breaks into a Shard of the Crown for every player inside whose Village lacks one.' },
  // ---- Allies: Howl (Fenrir's Tooth, a Legendary) calls them (user, 2026-10-11) ----
  wolf: { id: 'wolf', name: 'Wolf', tier: 0, maxHp: 15, speed: 5, dmg: 2, block: 0, undead: false, glyph: 'ᴥ', eventOnly: true, ally: true,
    desc: 'Fights at the side of whoever howled for it, from fight to fight. Bite: 2 dmg to the nearest enemy, and −1 Block on it until the fight ends.' },
};

export const TIERS: RosterTier[] = [0, 1, 2, 3];
export const UNITS_BY_TIER: Record<RosterTier, EnemyId[]> = { 0: [], 1: [], 2: [], 3: [] };
for (const e of Object.values(ENEMIES)) if (!e.eventOnly && e.tier !== 4) UNITS_BY_TIER[e.tier].push(e.id);

/** The Dead King (T4). */
export const KING_RULES = {
  /** Block for every other monster still standing in his fight. */
  blockPerCourtier: 3,
  /** Charge: every monster in the fight is this much faster (seconds) until it ends; each Charge adds more. */
  chargeHaste: 1,
  /** No monster gets quicker than this. */
  speedFloor: 2,
};

/**
 * The monsters a run uses (user, 2026-10-10), rolled at its start. `main`: per tier, the run's default units, which
 * fill the encounter tables (T1 from Escalation 1, T2 from Escalation 3). `cr`: per tier, one more unit that only
 * Challenge Rating brings (see CR_RULES), or null.
 */
export interface Roster {
  main: Record<RosterTier, EnemyId[]>;
  cr: Record<RosterTier, EnemyId | null>;
}

export const ROSTER_RULES = {
  /** Default units per tier: 2 of T0, 1 of T1, 1 of T2, no T3. */
  defaults: { 0: 2, 1: 1, 2: 1, 3: 0 } as Record<RosterTier, number>,
  /** The Escalation from which ordinary groups use each tier (lairs and secret rooms don't wait). */
  escalation: { 0: 0, 1: 1, 2: 3, 3: Infinity } as Record<RosterTier, number>,
};

/** Shuffle each tier: the first `ROSTER_RULES.defaults[tier]` are the run's defaults, the next its CR unit. */
export function rollRoster(rng: Rng): Roster {
  const roster: Roster = { main: { 0: [], 1: [], 2: [], 3: [] }, cr: { 0: null, 1: null, 2: null, 3: null } };
  for (const t of TIERS) {
    const units = rng.shuffle(UNITS_BY_TIER[t]);
    const n = ROSTER_RULES.defaults[t];
    roster.main[t] = units.slice(0, n);
    roster.cr[t] = units[n] ?? null;
  }
  return roster;
}

/**
 * Challenge Rating: rolled at the start from Talents, Gear and Rites (see village.ts). It raises the gold found,
 * brings each tier's CR unit more and more often, and makes monsters tougher. No cap.
 */
export const CR_RULES = {
  /** Every bit of gold found is worth (1 + this × CR). */
  goldPerCr: 0.15,
  /**
   * Per tier: from CR `from`, each group spawned has `chance` (rolled independently per tier) to bring that tier's
   * CR unit along; each CR above `growFrom` adds `perCr`. Lairs always bring every CR unit already unlocked.
   */
  units: {
    0: { from: 1, chance: 0.25, perCr: 0.05 },
    1: { from: 2, chance: 0.2, perCr: 0.04 },
    2: { from: 4, chance: 0.15, perCr: 0.03 },
    3: { from: 5, chance: 0.1, perCr: 0.02 },
  } as Record<RosterTier, { from: number; chance: number; perCr: number }>,
  growFrom: 6,
  /** From CR `lowCr`, monsters of tier `lowTiersMax` and below get `lowBonus` more HP and damage. */
  lowCr: 3,
  lowTiersMax: 1 as Tier,
  lowBonus: 0.25,
  /** From CR `allCr`, every monster gets `allBonus` more HP and damage. */
  allCr: 6,
  allBonus: 0.25,
  /** Each CR above `growFrom`: every monster gets this much more HP and damage. */
  perCrAbove: 0.05,
  /** Wight's Snuff: light taken from its target. */
  wightSnuff: 15,
  /** Hymn: the other monsters heal this much and their next turn comes this many seconds sooner. */
  hymnHeal: 4,
  hymnHaste: 2,
  /** Dirge (when she's alone): stress to every hero in the fight. */
  dirgeStress: 5, // 8 until the stress rework (×⅔)
  /** Zombie: gets back up this many seconds after it dies. */
  zombieRise: 12,
  /** Lich's Doom: extra damage heroes take from everything, per stack (see `Statuses.doom`). */
  doom: 1,
};

/** Chance that a group spawned at this CR brings the tier's CR unit (0 before it's unlocked). */
export function crUnitChance(tier: RosterTier, cr: number): number {
  const u = CR_RULES.units[tier];
  if (cr < u.from) return 0;
  return Math.min(1, u.chance + u.perCr * Math.max(0, cr - CR_RULES.growFrom));
}

/** Extra HP and damage (a fraction, added to Escalation's) that monsters of this tier get at this CR. */
export function crBonus(tier: Tier, cr: number): number {
  let b = 0;
  if (cr >= CR_RULES.lowCr && tier <= CR_RULES.lowTiersMax) b += CR_RULES.lowBonus;
  if (cr >= CR_RULES.allCr) b += CR_RULES.allBonus;
  return b + CR_RULES.perCrAbove * Math.max(0, cr - CR_RULES.growFrom);
}

/** A group template: each entry is a tier, filled with one of the run's default units of that tier. */
export interface GroupTemplate {
  weight: number;
  tiers: RosterTier[];
  minEscalation?: number;
}

/** Ordinary groups. Rows with T1 or T2 wait for `ROSTER_RULES.escalation`. */
export const ENCOUNTER_GROUPS: GroupTemplate[] = [
  { weight: 3, tiers: [0] },
  { weight: 7, tiers: [0, 0] },
  { weight: 2, tiers: [0, 0, 0] },
  { weight: 2, tiers: [1] },
  { weight: 2, tiers: [1, 0] },
  { weight: 2, tiers: [2] },
  { weight: 1, tiers: [2, 0], minEscalation: 4 },
];

/** Lairs: bigger groups some rooms start with, guarding better loot (see spawnInitialMonsters). They don't wait for Escalation. */
export const LAIR_GROUPS: GroupTemplate[] = [
  { weight: 3, tiers: [0, 0, 0, 0] },
  { weight: 2, tiers: [1, 0, 0, 0] },
  { weight: 2, tiers: [2, 0] },
  { weight: 1, tiers: [1, 1, 0, 0] },
];

/** The small guard a secret room gets when it opens. They don't wait for Escalation. */
export const SECRET_GUARDS: GroupTemplate[] = [
  { weight: 5, tiers: [0, 0] },
  { weight: 2, tiers: [1, 0] },
  { weight: 1, tiers: [2] },
];

/** How the dungeon gets worse (see sim/escalation.ts). Seconds unless noted. */
export const ESCALATION = {
  /** Chance that a normal room starts with monsters. */
  roomMonsterChance: 0.3,
  /** Chance that a room which starts with monsters is a lair instead (LAIR_GROUPS). */
  lairChance: 0.15,
  /** Monster HP and damage scale by (1 + this × Escalation + the CR bonus). */
  escalationScaling: 0.09,
  respawnEvery: 45,
  respawnEveryLate: 30,
  wandererEvery: 60,
  /** Stragglers: one of the run's T0s every this many seconds, by Escalation 0/1/2/3/4+ (user, 2026-10-12). */
  stragglerEvery: [50, 40, 30, 20, 10],
  /** Chance each straggler with empty hands picks up something lying in a room it ends up in. */
  stragglerPickup: 0.05,
  collapseEvery: 60,
  /** When a collapse can hit a tunnel that cuts nothing off (part of a loop), it does so this often. */
  collapsePreferLoops: 0.75,
  /** Seconds to dig through rubble (the Undertaker takes one turn instead). */
  digTime: 18,
  waveEvery: 45,
  waveEveryLate: 25,
  /** Max live monsters = capBase + capPerEscalation × Escalation. */
  capBase: 8,
  capPerEscalation: 1.5,
  /** Packs take this × their slowest member's Speed to walk a tunnel. */
  packSlowness: 1.5,
  /** Light drains this much faster from Escalation 4. */
  lateLightDrain: 1.5,
};
