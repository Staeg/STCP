export type EnemyId = 'ghoul' | 'crawler' | 'acolyte' | 'brute';
export type Rank = 'front' | 'back';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  maxHp: number;
  rank: Rank;
  speed: number;
  undead: boolean;
  /** Placeholder glyph until sprites (M9). */
  glyph: string;
  desc: string;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  ghoul: { id: 'ghoul', name: 'Ghoul', maxHp: 18, rank: 'front', speed: 2, undead: true, glyph: '☠', desc: 'Claw: 5 dmg to a front hero.' },
  crawler: { id: 'crawler', name: 'Crawler', maxHp: 10, rank: 'front', speed: 6, undead: false, glyph: '✷', desc: 'Fast. Bite: 3 dmg + Bleed.' },
  acolyte: { id: 'acolyte', name: 'Acolyte', maxHp: 14, rank: 'back', speed: 4, undead: false, glyph: '♆', desc: 'Whisper: +6 stress, or Curse: 4 dmg to a back hero.' },
  brute: { id: 'brute', name: 'Bone Brute', maxHp: 40, rank: 'front', speed: 1, undead: true, glyph: '♜', desc: 'Every other round, Slam: 9 dmg to all front heroes.' },
};

export const ENCOUNTER_GROUPS: { weight: number; units: EnemyId[] }[] = [
  { weight: 3, units: ['ghoul'] },
  { weight: 3, units: ['ghoul', 'acolyte'] },
  { weight: 2, units: ['crawler', 'crawler'] },
  { weight: 2, units: ['ghoul', 'crawler'] },
  { weight: 1, units: ['ghoul', 'ghoul', 'acolyte'] },
  { weight: 1, units: ['acolyte', 'crawler', 'crawler'] },
];

/** Chance that a normal room starts with monsters. */
export const ROOM_MONSTER_CHANCE = 0.45;
/** Monster HP and damage scale by (1 + this × tier). */
export const TIER_SCALING = 0.15;
