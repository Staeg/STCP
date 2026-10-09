import type { ClassId } from './classes';

/**
 * enemy: any living enemy · enemyFirst: the nearest enemy (leftmost on the enemy side)
 * damagedEnemy: any enemy below full HP
 * ally: any conscious hero in the fight, including you · otherAlly: excluding you
 * allEnemies / allAllies / self: no target to pick
 */
export type AbilityTarget = 'enemy' | 'enemyFirst' | 'damagedEnemy' | 'ally' | 'otherAlly' | 'allEnemies' | 'allAllies' | 'self';

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

/** Numbers for the class perks and the abilities with more than one number. */
export const CLASS_RULES = {
  /** Undertaker: stress an ally's death takes away (instead of adding STRESS.allyDeath). */
  morticianRelief: 10,
  /** Raise: the risen fight for this many of their own turns, at this fraction of their max HP. */
  raiseTurns: 2,
  raiseHp: 0.5,
  /** Bellringer: Clang pushes the target's next turn back this many seconds; Peal pulls allies' forward. */
  clangDelay: 5,
  pealHaste: 3,
  /** Knell: power minus this per ally in the fight. */
  knellPerAlly: 3,
  /** Toll (out of combat): cooldown in seconds; allies see you live for this long. */
  tollCooldown: 30,
  tollReveal: 10,
  /** Zealot: +1% damage per stress point; Absolution spends stress above this. */
  zealotDmgPerStress: 0.01,
  absolutionFloor: 50,
  /** Alchemist: a fresh consumable this often (seconds). */
  brewEvery: 60,
  /** Acid: extra damage on every hit the target takes, for this many of its turns. */
  acidBonus: 2,
  acidTurns: 2,
  /** Fumes: Bleed on every enemy. */
  fumesBleed: 3,
  fumesTurns: 3,
};

export const ABILITIES: Record<ClassId, [AbilityDef, AbilityDef, AbilityDef]> = {
  warden: [
    { id: 'bash', name: 'Shield Bash', cooldown: 0, target: 'enemyFirst', power: 7, desc: '7 dmg to the nearest enemy. 35% Stun.' },
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
  undertaker: [
    { id: 'spade', name: 'Spade', cooldown: 0, target: 'enemy', power: 6, desc: '6 dmg.' },
    { id: 'rites', name: 'Last Rites', cooldown: 4, target: 'damagedEnemy', power: 0, desc: 'Kill any wounded enemy outright.' },
    { id: 'raise', name: 'Raise', cooldown: 5, target: 'self', power: 0, desc: 'The last enemy slain in this fight rises on your side at half HP, for 2 of its turns. It stands nearest the enemy, so they attack it.' },
  ],
  bellringer: [
    { id: 'clang', name: 'Clang', cooldown: 0, target: 'enemyFirst', power: 5, desc: '5 dmg to the nearest enemy, and its next turn comes 5s later.' },
    { id: 'peal', name: 'Peal', cooldown: 3, target: 'allAllies', power: 3, desc: "Every ally's next turn comes 3s sooner." },
    { id: 'knell', name: 'Knell', cooldown: 4, target: 'allEnemies', power: 9, desc: '9 dmg to every enemy, −3 for each ally in the fight. Unusable with 3 allies.' },
  ],
  zealot: [
    { id: 'scourge', name: 'Scourge', cooldown: 0, target: 'enemy', power: 5, desc: '5 dmg.' },
    { id: 'sins', name: 'Take Their Sins', cooldown: 2, target: 'otherAlly', power: 25, desc: 'Take up to 25 stress off an ally onto yourself. Works outside fights too.' },
    { id: 'absolution', name: 'Absolution', cooldown: 4, target: 'allEnemies', power: 0, desc: 'Spend your stress above 50 as damage, split across enemies.' },
  ],
  alchemist: [
    { id: 'acid', name: 'Acid Flask', cooldown: 0, target: 'enemy', power: 5, desc: '5 dmg. For its next 2 turns it takes +2 from every hit, Bleed included.' },
    { id: 'fumes', name: 'Fumes', cooldown: 3, target: 'allEnemies', power: 3, desc: 'Every enemy Bleeds 3 at the end of each of its next 3 turns (stacks with other Bleeds).' },
    { id: 'elixir', name: 'Elixir', cooldown: 4, target: 'ally', power: 2, desc: "An ally's next item has double effect. Works outside fights too, on yourself as well." },
  ],
};
