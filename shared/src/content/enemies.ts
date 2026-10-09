export type EnemyId = 'ghoul' | 'crawler' | 'acolyte' | 'brute';
export type Rank = 'front' | 'back';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  maxHp: number;
  rank: Rank;
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
  ghoul: { id: 'ghoul', name: 'Ghoul', maxHp: 14, rank: 'front', speed: 5, dmg: 4, undead: true, glyph: '☠', desc: 'Claw: 4 dmg to a front hero.' },
  crawler: { id: 'crawler', name: 'Crawler', maxHp: 8, rank: 'front', speed: 3, dmg: 2, undead: false, glyph: '✷', desc: 'Fast. Bite: 2 dmg + Bleed.' },
  acolyte: { id: 'acolyte', name: 'Acolyte', maxHp: 11, rank: 'back', speed: 4, dmg: 3, undead: false, glyph: '♆', desc: 'Whisper: +6 stress, or Curse: 3 dmg to a back hero.' },
  brute: { id: 'brute', name: 'Bone Brute', maxHp: 34, rank: 'front', speed: 8, dmg: 7, undead: true, glyph: '♜', desc: 'Slow. Slam: 7 dmg to all front heroes.' },
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

/** How the dungeon gets worse (see sim/escalation.ts). Seconds unless noted. */
export const ESCALATION = {
  /** Chance that a normal room starts with monsters. */
  roomMonsterChance: 0.3,
  /** Monster HP and damage scale by (1 + this × tier). */
  tierScaling: 0.09,
  respawnEvery: 45,
  respawnEveryLate: 30,
  wandererEvery: 60,
  collapseEvery: 60,
  /** When a collapse can hit a tunnel that cuts nothing off (part of a loop), it does so this often. */
  collapsePreferLoops: 0.75,
  /** Seconds to dig through rubble (Warden is faster). Multiples of the 6s beat. */
  digTime: 18,
  digTimeWarden: 12,
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

