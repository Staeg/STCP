export type EnemyId = 'ghoul' | 'crawler' | 'acolyte' | 'brute' | 'wight' | 'queen';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  maxHp: number;
  /** Speed: seconds between its turns. Default 5; lower is quicker. */
  speed: number;
  /** Base damage of its main attack (scaled by tier). */
  dmg: number;
  undead: boolean;
  /** Placeholder glyph until sprites (M9). */
  glyph: string;
  desc: string;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  ghoul: { id: 'ghoul', name: 'Ghoul', maxHp: 14, speed: 5, dmg: 4, undead: true, glyph: '☠', desc: 'Claw: 4 dmg to the nearest hero.' },
  crawler: { id: 'crawler', name: 'Crawler', maxHp: 8, speed: 3, dmg: 2, undead: false, glyph: '✷', desc: 'Fast. Bite: 2 dmg + Poison to a random hero.' },
  acolyte: { id: 'acolyte', name: 'Acolyte', maxHp: 11, speed: 4, dmg: 3, undead: false, glyph: '♆', desc: 'Whisper: +6 stress to a random hero, or Curse: 3 dmg to the farthest hero.' },
  brute: { id: 'brute', name: 'Bone Brute', maxHp: 34, speed: 8, dmg: 7, undead: true, glyph: '♜', desc: 'Slow. Slam: 7 dmg to the two nearest heroes.' },
  // Challenge Rating monsters (M12): only in runs with Talented heroes (see CR_RULES).
  wight: { id: 'wight', name: 'Lantern Wight', maxHp: 16, speed: 5, dmg: 3, undead: true, glyph: '♰', desc: 'Snuff: 3 dmg and −15 light to the nearest hero. (CR 1+)' },
  queen: { id: 'queen', name: 'Forsaken Queen', maxHp: 32, speed: 6, dmg: 4, undead: false, glyph: '♛',
    desc: 'Hymn: every other monster heals 4 and acts 2s sooner. Alone, Dirge: +8 stress to every hero. (CR 3+)' },
};

/**
 * Challenge Rating (M12): how many heroes in the run have a Talent (0–4). It raises the gold found and brings in
 * monsters that never appear otherwise. Monster HP and damage don't change with it.
 */
export const CR_RULES = {
  /** Every bit of gold found is worth (1 + this × CR). */
  goldPerCr: 0.15,
  /** Chance, by CR, that each Ghoul spawned comes with a Lantern Wight beside it (index = CR). */
  wightChance: [0, 0.25, 0.5, 0.5, 0.5],
  /** Wight's Snuff: light taken from its target. */
  wightSnuff: 15,
  /** Chance, by CR, that a lair holds a Forsaken Queen. */
  queenLairChance: [0, 0, 0, 1 / 3, 1],
  /** At CR 4, from this tier, each exit wave has this chance of bringing a Queen. */
  queenWaveCr: 4,
  queenWaveTier: 5,
  queenWaveChance: 0.25,
  /** Hymn: the other monsters heal this much and their next turn comes this many seconds sooner. */
  hymnHeal: 4,
  hymnHaste: 2,
  /** Dirge (when she's alone): stress to every hero in the fight. */
  dirgeStress: 8,
};

export const ENCOUNTER_GROUPS: { weight: number; units: EnemyId[]; minTier?: number }[] = [
  { weight: 3, units: ['ghoul'] },
  { weight: 3, units: ['ghoul', 'acolyte'] },
  { weight: 2, units: ['crawler', 'crawler'] },
  { weight: 2, units: ['ghoul', 'crawler'] },
  { weight: 1, units: ['ghoul', 'ghoul', 'acolyte'] },
  { weight: 1, units: ['acolyte', 'crawler', 'crawler'] },
  { weight: 2, units: ['brute'], minTier: 3 },
  { weight: 1, units: ['brute', 'acolyte'], minTier: 4 },
];

/** Lairs: bigger groups some rooms start with, guarding better loot (see spawnInitialMonsters). */
export const LAIR_GROUPS: { weight: number; units: EnemyId[] }[] = [
  { weight: 3, units: ['ghoul', 'ghoul', 'acolyte', 'crawler'] },
  { weight: 2, units: ['crawler', 'crawler', 'crawler', 'acolyte'] },
  { weight: 2, units: ['brute', 'ghoul'] },
  { weight: 1, units: ['ghoul', 'ghoul', 'acolyte', 'acolyte'] },
];

/** The small guard a secret room gets when it opens (scaled to the tier then). */
export const SECRET_GUARDS: { weight: number; units: EnemyId[] }[] = [
  { weight: 3, units: ['ghoul', 'crawler'] },
  { weight: 2, units: ['crawler', 'crawler'] },
  { weight: 2, units: ['ghoul', 'acolyte'] },
  { weight: 1, units: ['brute'] },
];

/** How the dungeon gets worse (see sim/escalation.ts). Seconds unless noted. */
export const ESCALATION = {
  /** Chance that a normal room starts with monsters. */
  roomMonsterChance: 0.3,
  /** Chance that a room which starts with monsters is a lair instead (LAIR_GROUPS). */
  lairChance: 0.15,
  /** Monster HP and damage scale by (1 + this × tier). */
  tierScaling: 0.09,
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
  /** Max live monsters = capBase + capPerTier × tier. */
  capBase: 8,
  capPerTier: 1.5,
  /** Packs take this × their slowest member's Speed to walk a tunnel. */
  packSlowness: 1.5,
  /** Light drains this much faster from tier 4. */
  lateLightDrain: 1.5,
};

