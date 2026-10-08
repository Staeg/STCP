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
  /** Rounds you must wait after using it. 0 = every round. */
  cooldown: number;
  target: AbilityTarget;
  /** Main number (damage or healing); the description quotes it. */
  power: number;
  desc: string;
}

export const ABILITIES: Record<ClassId, [AbilityDef, AbilityDef, AbilityDef]> = {
  warden: [
    { id: 'bash', name: 'Shield Bash', cooldown: 2, target: 'enemyFront', power: 8, desc: '8 dmg to a front enemy. 50% Stun.' },
    { id: 'guard', name: 'Guard', cooldown: 1, target: 'otherAlly', power: 0, desc: 'Take the hits aimed at an ally this round.' },
    { id: 'rally', name: 'Rally', cooldown: 4, target: 'allAllies', power: 5, desc: 'All allies: −10 stress, +5 Block.' },
  ],
  cutthroat: [
    { id: 'backstab', name: 'Backstab', cooldown: 0, target: 'enemy', power: 10, desc: '10 dmg. Crits (×2) vs Stunned or Marked.' },
    { id: 'poison', name: 'Poison Blade', cooldown: 2, target: 'enemy', power: 5, desc: '5 dmg + Bleed (3/round, 3 rounds).' },
    { id: 'smoke', name: 'Smoke Bomb', cooldown: 5, target: 'allAllies', power: 0, desc: 'Allies: 50% dodge this round, and fleeing always works.' },
  ],
  lampbearer: [
    { id: 'mend', name: 'Mend', cooldown: 1, target: 'ally', power: 10, desc: 'Heal 10 and cure Bleed.' },
    { id: 'flare', name: 'Flare', cooldown: 3, target: 'allEnemies', power: 5, desc: '5 dmg to all enemies, +15 light to allies. Marks undead.' },
    { id: 'vigil', name: 'Vigil', cooldown: 3, target: 'ally', power: 15, desc: '−15 stress and immune to stress for 2 rounds.' },
  ],
  hexer: [
    { id: 'hex', name: 'Hex', cooldown: 0, target: 'enemy', power: 7, desc: '7 dmg and Mark the target.' },
    { id: 'wither', name: 'Wither', cooldown: 3, target: 'enemy', power: 0, desc: 'Target deals −50% damage for 2 rounds.' },
    { id: 'pact', name: 'Blood Pact', cooldown: 4, target: 'allEnemies', power: 15, desc: 'Lose 6 HP: 15 dmg split across enemies; heal weakest ally 6.' },
  ],
};
