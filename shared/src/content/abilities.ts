import type { ClassId } from './classes';

/**
 * enemy: any living enemy · enemyFront: a front-rank enemy (any if none in front)
 * ally: any conscious hero in the fight, including you · otherAlly: excluding you
 * allEnemies / allAllies / self: no target to pick
 */
export type AbilityTarget = 'enemy' | 'enemyFront' | 'ally' | 'otherAlly' | 'allEnemies' | 'allAllies' | 'self';

export interface AbilityDef {
  id: string;
  name: string;
  /** Your own turns you must wait after using it. 0 = every turn. */
  cooldown: number;
  target: AbilityTarget;
  /** Main number (damage or healing); the description quotes it. */
  power: number;
  desc: string;
}

/** The Lampbearer can also Mend outside a fight: small heal, long cooldown. */
export const FIELD_MEND = { heal: 8, cooldown: 20 };

export const ABILITIES: Record<ClassId, [AbilityDef, AbilityDef, AbilityDef]> = {
  warden: [
    { id: 'bash', name: 'Shield Bash', cooldown: 0, target: 'enemyFront', power: 7, desc: '7 dmg to a front enemy. 35% Stun.' },
    { id: 'guard', name: 'Guard', cooldown: 1, target: 'otherAlly', power: 0, desc: 'Take the hits aimed at an ally until your next turn.' },
    { id: 'rally', name: 'Rally', cooldown: 4, target: 'allAllies', power: 5, desc: 'All allies: −10 stress, +5 Block.' },
  ],
  cutthroat: [
    { id: 'backstab', name: 'Backstab', cooldown: 0, target: 'enemy', power: 10, desc: '10 dmg. Crits (×2) vs Stunned or Marked.' },
    { id: 'poison', name: 'Poison Blade', cooldown: 2, target: 'enemy', power: 5, desc: '5 dmg + Bleed (3 at the end of each of its next 3 turns).' },
    { id: 'smoke', name: 'Smoke Bomb', cooldown: 5, target: 'allAllies', power: 0, desc: 'Allies: 50% dodge, and fleeing always works, until your next turn.' },
  ],
  lampbearer: [
    { id: 'mend', name: 'Mend', cooldown: 1, target: 'ally', power: 10, desc: 'Heal 10 and cure Bleed.' },
    { id: 'flare', name: 'Flare', cooldown: 1, target: 'allEnemies', power: 5, desc: '5 dmg to all enemies, +10 light to allies. Marks undead.' },
    { id: 'vigil', name: 'Vigil', cooldown: 3, target: 'ally', power: 15, desc: '−15 stress and immune to stress for their next 2 turns.' },
  ],
  hexer: [
    { id: 'hex', name: 'Hex', cooldown: 0, target: 'enemy', power: 7, desc: '7 dmg and Mark the target.' },
    { id: 'wither', name: 'Wither', cooldown: 3, target: 'enemy', power: 0, desc: 'Target deals −50% damage for its next 2 turns.' },
    { id: 'pact', name: 'Blood Pact', cooldown: 4, target: 'allEnemies', power: 15, desc: 'Lose 6 HP: 15 dmg split across enemies; heal weakest ally 6.' },
  ],
};
