import type { Rank } from './enemies';

export type ClassId = 'warden' | 'cutthroat' | 'lampbearer' | 'hexer';

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  color: string;
  maxHp: number;
  /** Speed: seconds between this hero's turns in a fight, and to walk a tunnel. Lower is faster. */
  speed: number;
  /** One-line pitch for the class picker. */
  blurb: string;
}

/** Max HP is HP_PER_SPEED × Speed: the quicker a hero acts, the less they can take. */
export const HP_PER_SPEED = 9;

export const CLASSES: Record<ClassId, ClassDef> = {
  warden: { id: 'warden', name: 'Warden', role: 'Tank', color: '#5b8fd9', maxHp: 54, speed: 6,
    blurb: 'Holds the front. Shield Bash, Guard an ally, Rally the party.' },
  cutthroat: { id: 'cutthroat', name: 'Cutthroat', role: 'Burst & locks', color: '#d94a4a', maxHp: 27, speed: 3,
    blurb: 'Fast and deadly. Backstab, Poison Blade, Smoke Bomb. Opens locks quickly.' },
  lampbearer: { id: 'lampbearer', name: 'Lampbearer', role: 'Healer & light', color: '#e8c547', maxHp: 45, speed: 5,
    blurb: 'Keeps the dark at bay. Mend, Flare, Vigil. Allies nearby burn light slower.' },
  hexer: { id: 'hexer', name: 'Hexer', role: 'Control & rituals', color: '#a66ad9', maxHp: 36, speed: 4,
    blurb: 'Curses and rituals. Hex, Wither, Blood Pact. Cleanses altars twice as fast.' },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/** Which combat rank each class fights from. */
export const HERO_RANK: Record<ClassId, Rank> = {
  warden: 'front',
  cutthroat: 'front',
  lampbearer: 'back',
  hexer: 'back',
};
