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
  /** Can also be used outside a fight (it then happens when the hero's timer runs out, using up that turn). */
  field?: boolean;
}

/** Numbers for the class perks and the abilities with more than one number. */
export const CLASS_RULES = {
  /** Shield Bash: chance to Stun. */
  bashStun: 0.35,
  /** Vengeance: lasts this many of the Warden's own turns. */
  vengeanceTurns: 2,
  /** Smoke Bomb: seconds it lasts. */
  smokeSecs: 6,
  /** Flare: light it gives everyone in the room. */
  flareLight: 10,
  /** Lampbearer: their own light fades at this fraction of the usual rate. */
  lampLightDrain: 0.5,
  /** Hex: each Hexed stack adds this much to the damage Hex deals, for this many of the target's turns. */
  hexedBonus: 1,
  hexedTurns: 2,
  /** Wither: enemies deal half damage for this many of their own turns. */
  witherTurns: 2,
  /** Blood Pact: HP every ally (the Witch too) pays. It never takes anyone below 1. */
  pactCost: 6,
  /** Undertaker: Spade's damage grows this much for every enemy Last Rites kills, for the rest of the run. */
  spadePerRites: 1,
  /** Undertaker: stress an ally's death takes away (instead of adding STRESS.allyDeath). */
  morticianRelief: 10,
  /** Raise: the risen fight for this many of their own turns, at this fraction of their max HP. */
  raiseTurns: 4,
  raiseHp: 1,
  /** Bellwright: Clang pushes the target's next turn back this many seconds; Peal pulls allies' forward. */
  clangDelay: 6,
  pealHaste: 3,
  /** Knell: power minus this per ally in the fight. */
  knellPerAlly: 5,
  /** Toll (out of combat): cooldown in your own turns; allies see you live for this long (seconds). */
  tollCooldown: 4,
  tollReveal: 10,
  /** Zealot: +1.5% damage per stress point; Absolution spends stress above this. */
  zealotDmgPerStress: 0.015,
  absolutionFloor: 50,
  /** Alchemist: a fresh consumable this often (seconds). */
  brewEvery: 45,
  /** Acid: extra damage on every hit the target takes, for this many of its turns. */
  acidBonus: 2,
  acidTurns: 2,
  /** Fumes: Bleed on every enemy. */
  fumesBleed: 4,
  fumesTurns: 3,
};

/** Slot order: the basic attack, then the best ability alone, then the best one with a team. */
export const ABILITIES: Record<ClassId, [AbilityDef, AbilityDef, AbilityDef]> = {
  warden: [
    { id: 'bash', name: 'Shield Bash', cooldown: 0, target: 'enemyFirst', power: 10, desc: '10 dmg to the nearest enemy. 35% Stun.' },
    { id: 'vengeance', name: 'Vengeance', cooldown: 4, target: 'self', power: 0, desc: 'For your next 2 turns, anyone who attacks you takes the full damage of the attack back (before armor, Block or bracing).' },
    { id: 'rally', name: 'Rally', cooldown: 4, target: 'allAllies', power: 3, desc: 'All allies: −10 stress, +3 Block.' },
  ],
  cutthroat: [
    { id: 'backstab', name: 'Backstab', cooldown: 0, target: 'enemy', power: 7, desc: "7 dmg. Crits (×2) vs an enemy that is Stunned or hasn't acted yet this fight." },
    { id: 'cheap', name: 'Cheap Shot', cooldown: 4, target: 'enemy', power: 3, desc: '3 dmg and Stun.' },
    { id: 'smoke', name: 'Smoke Bomb', cooldown: 5, target: 'allAllies', power: 0, desc: 'Every ally in the fight: 50% dodge, and fleeing always works, for 6s.' },
  ],
  lampbearer: [
    { id: 'flare', name: 'Flare', cooldown: 1, target: 'allEnemies', power: 3, desc: '3 dmg to all enemies, +10 light to everyone in the room.', field: true },
    { id: 'vigil', name: 'Vigil', cooldown: 3, target: 'ally', power: 8, desc: "−8 stress. If you're the only hero in the fight, every enemy action until your next turn sets off a free Flare.", field: true },
    { id: 'mend', name: 'Mend', cooldown: 1, target: 'otherAlly', power: 8, desc: 'Heal an ally (not yourself) 8 and cure Bleed.', field: true },
  ],
  witch: [
    { id: 'hex', name: 'Hex', cooldown: 0, target: 'enemy', power: 5, desc: '5 dmg and Hexed: Hex deals +100% to it for its next 2 turns. Stacks.' },
    { id: 'pact', name: 'Blood Pact', cooldown: 6, target: 'allEnemies', power: 15, desc: 'Every ally (you too) loses 6 HP, never below 1. 15 dmg to every enemy.' },
    { id: 'wither', name: 'Wither', cooldown: 4, target: 'allEnemies', power: 0, desc: 'Every enemy deals −50% damage for its next 2 turns.' },
  ],
  undertaker: [
    { id: 'spade', name: 'Spade', cooldown: 0, target: 'enemy', power: 10, desc: '10 dmg, +1 for every enemy your Last Rites has killed this run.' },
    { id: 'rites', name: 'Last Rites', cooldown: 3, target: 'damagedEnemy', power: 0, desc: 'Kill any wounded enemy outright.' },
    { id: 'raise', name: 'Raise', cooldown: 5, target: 'self', power: 0, desc: 'The last enemy slain in this fight rises on your side at full HP, for 4 of its turns. It stands nearest the enemy, so they attack it.' },
  ],
  bellwright: [
    { id: 'clang', name: 'Clang', cooldown: 0, target: 'enemyFirst', power: 8, desc: '8 dmg to the nearest enemy, and its next turn comes 6s later.' },
    { id: 'knell', name: 'Knell', cooldown: 4, target: 'allEnemies', power: 15, desc: '15 dmg to every enemy, −5 for each ally in the fight. Unusable with 3 allies.' },
    { id: 'peal', name: 'Peal', cooldown: 3, target: 'allAllies', power: 3, desc: "Every ally's next turn comes 3s sooner." },
  ],
  zealot: [
    { id: 'scourge', name: 'Scourge', cooldown: 0, target: 'enemy', power: 8, desc: '8 dmg.' },
    { id: 'absolution', name: 'Absolution', cooldown: 4, target: 'allEnemies', power: 0, desc: 'Spend your stress above 50 as damage, split across enemies.' },
    { id: 'sins', name: 'Take Their Sins', cooldown: 2, target: 'otherAlly', power: 25, desc: 'Take up to 25 stress off an ally onto yourself.', field: true },
  ],
  alchemist: [
    { id: 'acid', name: 'Acid Flask', cooldown: 0, target: 'enemy', power: 6, desc: '6 dmg. For its next 2 turns it takes +2 from every hit, Bleed included.' },
    { id: 'fumes', name: 'Fumes', cooldown: 3, target: 'allEnemies', power: 3, desc: 'Every enemy Bleeds 4 at the end of each of its next 3 turns (stacks with other Bleeds).' },
    { id: 'elixir', name: 'Elixir', cooldown: 4, target: 'ally', power: 2, desc: "An ally's next item (or yours) has double effect.", field: true },
  ],
};

/** Find an ability by id (any class). */
export function abilityById(id: string): AbilityDef | undefined {
  for (const list of Object.values(ABILITIES)) {
    const ab = list.find((a) => a.id === id);
    if (ab) return ab;
  }
  return undefined;
}
