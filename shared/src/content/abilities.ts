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
  desc: string;
}

export const ABILITIES: Record<ClassId, [AbilityDef, AbilityDef, AbilityDef]> = {
  warden: [
    { id: 'bash', name: 'Shield Bash', cooldown: 2, target: 'enemyFront', desc: '6 dmg to a front enemy. 50% Stun.' },
    { id: 'guard', name: 'Guard', cooldown: 1, target: 'otherAlly', desc: 'Take the hits aimed at an ally this round.' },
    { id: 'rally', name: 'Rally', cooldown: 4, target: 'allAllies', desc: 'All allies: −10 stress, +4 Block.' },
  ],
  cutthroat: [
    { id: 'backstab', name: 'Backstab', cooldown: 0, target: 'enemy', desc: '8 dmg. Crits (×2) vs Stunned or Marked.' },
    { id: 'poison', name: 'Poison Blade', cooldown: 2, target: 'enemy', desc: '4 dmg + Bleed (3/round, 3 rounds).' },
    { id: 'smoke', name: 'Smoke Bomb', cooldown: 5, target: 'allAllies', desc: 'Allies: 50% dodge this round, and fleeing always works.' },
  ],
  lampbearer: [
    { id: 'mend', name: 'Mend', cooldown: 1, target: 'ally', desc: 'Heal 10 and cure Bleed.' },
    { id: 'flare', name: 'Flare', cooldown: 3, target: 'allEnemies', desc: '4 dmg to all enemies, +15 light to allies. Marks undead.' },
    { id: 'vigil', name: 'Vigil', cooldown: 3, target: 'ally', desc: '−15 stress and immune to stress for 2 rounds.' },
  ],
  hexer: [
    { id: 'hex', name: 'Hex', cooldown: 0, target: 'enemy', desc: '5 dmg and Mark the target.' },
    { id: 'wither', name: 'Wither', cooldown: 3, target: 'enemy', desc: 'Target deals −50% damage for 2 rounds.' },
    { id: 'pact', name: 'Blood Pact', cooldown: 4, target: 'allEnemies', desc: 'Lose 6 HP: 12 dmg split across enemies; heal weakest ally 6.' },
  ],
};
