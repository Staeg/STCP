export type ClassId = 'warden' | 'cutthroat' | 'lampbearer' | 'witch' | 'undertaker' | 'bellwright' | 'zealot' | 'alchemist';

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  color: string;
  maxHp: number;
  /** Speed: seconds between this hero's turns in a fight, and to walk a tunnel. Lower is faster. */
  speed: number;
  /** The class perk, for the class picker. */
  blurb: string;
}

/** Max HP is HP_PER_SPEED × Speed: the quicker a hero acts, the less they can take. */
export const HP_PER_SPEED = 9;

export const CLASSES: Record<ClassId, ClassDef> = {
  warden: { id: 'warden', name: 'Warden', role: 'Tank', color: '#5b8fd9', maxHp: 54, speed: 6,
    blurb: 'Takes 20% less damage while standing nearest the enemy.' },
  cutthroat: { id: 'cutthroat', name: 'Cutthroat', role: 'Burst & locks', color: '#d94a4a', maxHp: 27, speed: 3,
    blurb: 'Spots loot next door.' },
  lampbearer: { id: 'lampbearer', name: 'Lampbearer', role: 'Healer & light', color: '#e8c547', maxHp: 45, speed: 5,
    blurb: 'Their own light fades half as fast.' },
  witch: { id: 'witch', name: 'Witch', role: 'Curses & blood', color: '#a66ad9', maxHp: 36, speed: 4,
    blurb: '−1.5s Speed while Afflicted.' },
  undertaker: { id: 'undertaker', name: 'Undertaker', role: 'Executions & the dead', color: '#8fa39a', maxHp: 54, speed: 6,
    blurb: 'Digs through rubble in one turn. Carries the fallen\'s gold home for them.' },
  bellwright: { id: 'bellwright', name: 'Bellwright', role: 'Tempo & the call', color: '#d98a3a', maxHp: 63, speed: 7,
    blurb: 'Out of combat, Toll: every ally hears where you are, and so do the monsters.' },
  zealot: { id: 'zealot', name: 'Zealot', role: 'Stress as fuel', color: '#e6dcc4', maxHp: 36, speed: 4,
    blurb: 'Never breaks; stress makes you hit harder.' },
  alchemist: { id: 'alchemist', name: 'Alchemist', role: 'Brews & poisons', color: '#5fc46a', maxHp: 45, speed: 5,
    blurb: 'Brews a consumable every 45 seconds.' },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/** Colours for a second (third…) hero of a class already in the party, so allies stay tellable apart. */
export const SPARE_COLORS = ['#4ad9d0', '#ff7fbf', '#b0d94a', '#6a7cff', '#ffb36a', '#ff4ae0'];
