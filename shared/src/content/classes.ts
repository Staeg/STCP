import { CLASS_RULES } from './abilities';

export type ClassId = 'warden' | 'cutthroat' | 'lampbearer' | 'sorceress' | 'undertaker' | 'bellwright' | 'zealot' | 'alchemist';

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  color: string;
  maxHp: number;
  /** Speed: seconds between this hero's turns in a fight, and to walk a tunnel. Lower is faster. */
  speed: number;
  /** The class's Innate ability (always on, or the Bellwright's Toll), for the class picker. */
  innate: { name: string; desc: string };
}

/** Max HP is HP_PER_SPEED × Speed: the quicker a hero acts, the less they can take. */
export const HP_PER_SPEED = 9;

const R = CLASS_RULES;

export const CLASSES: Record<ClassId, ClassDef> = {
  warden: { id: 'warden', name: 'Warden', role: 'Tank', color: '#5b8fd9', maxHp: 54, speed: 6,
    innate: { name: 'Stalwart', desc: 'Takes 20% less damage while standing nearest the enemy.' } },
  cutthroat: { id: 'cutthroat', name: 'Cutthroat', role: 'Burst & locks', color: '#d94a4a', maxHp: 27, speed: 3,
    innate: { name: 'Light Fingers', desc: 'Spots loot next door.' } },
  lampbearer: { id: 'lampbearer', name: 'Lampbearer', role: 'Healer & light', color: '#e8c547', maxHp: 45, speed: 5,
    innate: { name: 'Beacon', desc: 'Their own light fades half as fast.' } },
  sorceress: { id: 'sorceress', name: 'Sorceress', role: 'Curses & blood', color: '#a66ad9', maxHp: 36, speed: 4,
    innate: { name: 'Mad Grace', desc: `${-R.sorceressInsaneSpeed}s faster while Insane.` } },
  undertaker: { id: 'undertaker', name: 'Undertaker', role: 'Executions & the dead', color: '#8fa39a', maxHp: 54, speed: 6,
    innate: { name: 'Mortician', desc: 'Digs through rubble in one turn. Raises each fallen ally once: walk them out and their Village keeps what they carry.' } },
  bellwright: { id: 'bellwright', name: 'Bellwright', role: 'Tempo & the call', color: '#d98a3a', maxHp: 63, speed: 7,
    innate: { name: 'Toll', desc: `Out of combat, ring the bell (uses your turn; cooldown ${R.tollCooldown} of your turns). Every ally, wherever they are, hears it: your room goes on their map and they see you live for ${R.tollReveal}s. Every monster in the dungeon reels: those in a fight lose their next turn, the rest stand still for ${R.tollDaze}s and start any fight in that time Stunned. Monsters in the rooms next door come to the bell.` } },
  zealot: { id: 'zealot', name: 'Zealot', role: 'Stress as fuel', color: '#e6dcc4', maxHp: 36, speed: 4,
    innate: { name: 'Fervour', desc: `Never goes Insane and has no heart attacks; stress stops at 100. Deals +${R.zealotDmgPerStress * 100}% damage per point of stress (+${Math.round(R.zealotDmgPerStress * 100 * 100)}% at 100).` } },
  alchemist: { id: 'alchemist', name: 'Alchemist', role: 'Brews & poisons', color: '#5fc46a', maxHp: 45, speed: 5,
    innate: { name: 'Brewer', desc: `Brews a consumable every ${R.brewEvery} seconds, if the pack has room.` } },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/** Colours for a second (third…) hero of a class already in the party, so allies stay tellable apart. */
export const SPARE_COLORS = ['#4ad9d0', '#ff7fbf', '#b0d94a', '#6a7cff', '#ffb36a', '#ff4ae0'];
