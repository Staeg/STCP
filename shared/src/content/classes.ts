export type ClassId = 'warden' | 'cutthroat' | 'lampbearer' | 'hexer' | 'undertaker' | 'bellringer' | 'zealot' | 'alchemist';

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
    blurb: 'Holds the line. Shield Bash, Guard an ally, Rally the party.' },
  cutthroat: { id: 'cutthroat', name: 'Cutthroat', role: 'Burst & locks', color: '#d94a4a', maxHp: 27, speed: 3,
    blurb: 'Fast and deadly. Backstab, Poison Blade, Smoke Bomb. Opens locks quickly.' },
  lampbearer: { id: 'lampbearer', name: 'Lampbearer', role: 'Healer & light', color: '#e8c547', maxHp: 45, speed: 5,
    blurb: 'Keeps the dark at bay. Mend, Flare, Vigil. Allies nearby burn light slower.' },
  hexer: { id: 'hexer', name: 'Hexer', role: 'Control & rituals', color: '#a66ad9', maxHp: 36, speed: 4,
    blurb: 'Curses and rituals. Hex, Wither, Blood Pact. Cleanses altars twice as fast.' },
  undertaker: { id: 'undertaker', name: 'Undertaker', role: 'Executions & the dead', color: '#8fa39a', maxHp: 54, speed: 6,
    blurb: 'Spade, Last Rites, Raise. Digs through rubble in one turn. Carries the fallen\'s gold home for them.' },
  bellringer: { id: 'bellringer', name: 'Bellringer', role: 'Tempo & the call', color: '#d98a3a', maxHp: 63, speed: 7,
    blurb: 'Clang, Peal, Knell (stronger alone). Out of combat, Toll: every ally hears where you are, and so do the monsters.' },
  zealot: { id: 'zealot', name: 'Zealot', role: 'Stress as fuel', color: '#e6dcc4', maxHp: 36, speed: 4,
    blurb: 'Never breaks; stress makes you hit harder. Scourge, Take Their Sins, Absolution.' },
  alchemist: { id: 'alchemist', name: 'Alchemist', role: 'Brews & poisons', color: '#5fc46a', maxHp: 45, speed: 5,
    blurb: 'Brews a consumable every minute. Acid Flask, Fumes, Elixir (doubles an ally\'s next item).' },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/** Colours for a second (third…) hero of a class already in the party, so allies stay tellable apart. */
export const SPARE_COLORS = ['#4ad9d0', '#ff7fbf', '#b0d94a', '#6a7cff', '#ffb36a', '#ff4ae0'];
