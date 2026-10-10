import type { Rng } from '../rng';

export type EnemyId = 'ghoul' | 'crawler' | 'acolyte' | 'brute' | 'wight' | 'queen' | 'zombie' | 'lich';

/** Power tier: 0 the common dead, 3 the worst there is. Which units of each tier a run uses is rolled (see `Roster`). */
export type Tier = 0 | 1 | 2 | 3;

export interface EnemyDef {
  id: EnemyId;
  name: string;
  tier: Tier;
  maxHp: number;
  /** Speed: seconds between its turns. Default 5; lower is quicker. */
  speed: number;
  /** Base damage of its main attack (scaled by Escalation). */
  dmg: number;
  undead: boolean;
  /** Never more than one to a room. */
  onePerRoom?: boolean;
  /** Never spawns on its own: a group that would be only this gets one of the run's T0 units beside it. */
  needsCompany?: boolean;
  /** Placeholder glyph until sprites (M9). */
  glyph: string;
  desc: string;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  // ---- T0 ----
  ghoul: { id: 'ghoul', name: 'Ghoul', tier: 0, maxHp: 14, speed: 5, dmg: 4, undead: true, glyph: '☠', desc: 'Claw: 4 dmg to the nearest hero.' },
  crawler: { id: 'crawler', name: 'Crawler', tier: 0, maxHp: 8, speed: 3, dmg: 2, undead: false, glyph: '✷', desc: 'Fast. Bite: 2 dmg + Poison to a random hero.' },
  acolyte: { id: 'acolyte', name: 'Acolyte', tier: 0, maxHp: 11, speed: 4, dmg: 3, undead: false, glyph: '♆', desc: 'Whisper: +6 stress to a random hero, or Curse: 3 dmg to the farthest hero.' },
  // ---- T1 ----
  wight: { id: 'wight', name: 'Lantern Wight', tier: 1, maxHp: 16, speed: 5, dmg: 3, undead: true, glyph: '♰', desc: 'Snuff: 3 dmg and −15 light to the nearest hero.' },
  zombie: { id: 'zombie', name: 'Zombie', tier: 1, maxHp: 10, speed: 5, dmg: 3, undead: true, glyph: '⚰',
    desc: 'Claw: 3 dmg to the nearest hero. Gets back up 12s after it dies, where it fell, unless an Undertaker raises it.' },
  // ---- T2 ----
  brute: { id: 'brute', name: 'Bone Brute', tier: 2, maxHp: 34, speed: 8, dmg: 7, undead: true, glyph: '♜', desc: 'Slow. Slam: 7 dmg to the two nearest heroes.' },
  queen: { id: 'queen', name: 'Forsaken Queen', tier: 2, maxHp: 32, speed: 6, dmg: 4, undead: false, glyph: '♛', onePerRoom: true, needsCompany: true,
    desc: 'Hymn: every other monster heals 4 and acts 2s sooner. Alone, Dirge: +8 stress to every hero.' },
  // ---- T3 ----
  lich: { id: 'lich', name: 'Lich', tier: 3, maxHp: 30, speed: 6, dmg: 3, undead: true, glyph: '♚', onePerRoom: true,
    desc: 'Aura: every hero takes 3 dmg before each of their turns. Once a fight it raises a slain monster whole; otherwise Doom: heroes take +1 dmg from everything for the rest of the fight (stacks).' },
};

export const TIERS: Tier[] = [0, 1, 2, 3];
export const UNITS_BY_TIER: Record<Tier, EnemyId[]> = { 0: [], 1: [], 2: [], 3: [] };
for (const e of Object.values(ENEMIES)) UNITS_BY_TIER[e.tier].push(e.id);

/**
 * The monsters a run uses (user, 2026-10-10), rolled at its start. `main`: per tier, the run's default units, which
 * fill the encounter tables (T1 from Escalation 1, T2 from Escalation 3). `cr`: per tier, one more unit that only
 * Challenge Rating brings (see CR_RULES), or null.
 */
export interface Roster {
  main: Record<Tier, EnemyId[]>;
  cr: Record<Tier, EnemyId | null>;
}

export const ROSTER_RULES = {
  /** Default units per tier: 2 of T0, 1 of T1, 1 of T2, no T3. */
  defaults: { 0: 2, 1: 1, 2: 1, 3: 0 } as Record<Tier, number>,
  /** The Escalation from which ordinary groups use each tier (lairs and secret rooms don't wait). */
  escalation: { 0: 0, 1: 1, 2: 3, 3: Infinity } as Record<Tier, number>,
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
  } as Record<Tier, { from: number; chance: number; perCr: number }>,
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
  dirgeStress: 8,
  /** Zombie: gets back up this many seconds after it dies. */
  zombieRise: 12,
  /** Lich's Doom: extra damage heroes take from everything, per cast, for the rest of the fight. */
  doom: 1,
};

/** Chance that a group spawned at this CR brings the tier's CR unit (0 before it's unlocked). */
export function crUnitChance(tier: Tier, cr: number): number {
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
  tiers: Tier[];
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
