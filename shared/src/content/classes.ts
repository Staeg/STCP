import { CLASS_RULES } from './innates';

export type ClassId = 'warden' | 'cutthroat' | 'lampbearer' | 'sorceress' | 'undertaker' | 'bellwright' | 'zealot' | 'alchemist';

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  color: string;
  maxHp: number;
  /** Speed: seconds to walk a tunnel, and before their first action in a fight (cards set the rest). Lower is faster. */
  speed: number;
  /** The class's Innate ability (always on, or the Bellwright's Toll), for the class picker. */
  innate: { name: string; desc: string };
}

/** Max HP is HP_PER_SPEED × Speed: the quicker a hero acts, the less they can take. */
export const HP_PER_SPEED = 9;

const R = CLASS_RULES;

export const CLASSES: Record<ClassId, ClassDef> = {
  warden: { id: 'warden', name: 'Warden', role: 'Tank', color: '#5b8fd9', maxHp: 54, speed: 6,
    innate: { name: 'Stalwart', desc: `Keeps ${R.stalwartKeep * 100}% of their Shield when a fight ends (everyone else loses all of theirs).` } },
  cutthroat: { id: 'cutthroat', name: 'Cutthroat', role: 'Burst & locks', color: '#d94a4a', maxHp: 27, speed: 3,
    innate: { name: 'Sixth Sense', desc: 'Spots loot next door.' } },
  lampbearer: { id: 'lampbearer', name: 'Lampbearer', role: 'Healer & light', color: '#e8c547', maxHp: 45, speed: 5,
    innate: { name: 'Beacon', desc: 'Their own light fades half as fast.' } },
  sorceress: { id: 'sorceress', name: 'Sorceress', role: 'Curses & blood', color: '#a66ad9', maxHp: 36, speed: 4,
    innate: { name: 'Anima', desc: 'Coming with the Sorceress rework (M16).' } },
  undertaker: { id: 'undertaker', name: 'Undertaker', role: 'Executions & the dead', color: '#8fa39a', maxHp: 54, speed: 6,
    innate: { name: 'Mortician', desc: 'Digs through rubble in one turn. Raises each fallen ally once: walk them out and their Village keeps what they carry. Allies falling cost them no light.' } },
  bellwright: { id: 'bellwright', name: 'Bellwright', role: 'Tempo & the call', color: '#d98a3a', maxHp: 63, speed: 7,
    innate: { name: 'Toll', desc: `Once a run, out of combat, ring the bell (uses your turn; a Loom weaves it back). Every ally, wherever they are, hears it: your room goes on their map and they see you live for ${R.tollReveal}s. Every monster in the dungeon reels: those in a fight lose their next turn, the rest stand still for ${R.tollDaze}s and start any fight in that time Stunned. Then every monster not fighting comes one room closer to the bell.` } },
  zealot: { id: 'zealot', name: 'Zealot', role: 'Darkness as fuel', color: '#e6dcc4', maxHp: 36, speed: 4,
    innate: { name: 'Fervour', desc: `Deals +${R.zealotDmgPerDark * 100}% damage for every point of light below 100 (+${Math.round(R.zealotDmgPerDark * 100 * 100)}% in total darkness).` } },
  alchemist: { id: 'alchemist', name: 'Alchemist', role: 'Brews & poisons', color: '#5fc46a', maxHp: 45, speed: 5,
    innate: { name: 'Long Reach', desc: 'Out of a fight, uses consumables on the rooms next door too: a Firebomb lands on every monster there, a Bandage or Smelling Salts on an ally there.' } },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/** Colours for a second (third…) hero of a class already in the party, so allies stay tellable apart. */
export const SPARE_COLORS = ['#4ad9d0', '#ff7fbf', '#b0d94a', '#6a7cff', '#ffb36a', '#ff4ae0'];
