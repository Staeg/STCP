/**
 * Legendary Gear (user, 2026-10-11): the fourth item tier, above Rare. Only the Dead King's treasure holds one. Each
 * piece adds to its wearer's stats like any other and gives them an active ability of its own, with a cooldown in
 * their own turns. Brought in from the Village, a Legendary adds a whole CR (`KIT_RULES.legendaryCr`).
 */
export type LegendId = 'foredoom' | 'quake' | 'unmake' | 'lethe' | 'bastion' | 'arise' | 'howl' | 'waystep';

/**
 * none: nothing to aim · ally: a conscious hero with you (in your fight, or your room out of one), you included ·
 * fallen: a downed or dead ally in your room · room: any room on your map
 */
export type LegendTarget = 'none' | 'ally' | 'fallen' | 'room';

export interface LegendDef {
  id: LegendId;
  name: string;
  /** Your own turns before it can be used again. */
  cooldown: number;
  /** Usable in a fight (as your turn) / out of one (it happens when your Speed timer runs out, using that turn). */
  combat: boolean;
  field: boolean;
  target: LegendTarget;
  desc: string;
}

export const LEGEND_RULES = {
  /** Howl: wolves at your side at most. */
  maxWolves: 4,
  /** Bastion: Shield gained per point of your Block. */
  bastionPerBlock: 3,
};

/** Bosses are T4 (only the Dead King): Foredoom never takes one. */
export const BOSS_TIER = 4;

export const LEGENDS: Record<LegendId, LegendDef> = {
  foredoom: { id: 'foredoom', name: 'Foredoom', cooldown: 8, combat: false, field: true, target: 'none',
    desc: 'Mark your next fight: as it begins, its strongest foe (the highest tier; ties at random) dies on the spot. Never a Boss.' },
  quake: { id: 'quake', name: 'Quake', cooldown: 6, combat: true, field: false, target: 'none',
    desc: 'Strike every enemy with your basic attack’s damage, and Stun them all.' },
  unmake: { id: 'unmake', name: 'Unmake', cooldown: 6, combat: true, field: true, target: 'room',
    desc: 'Pick any room on your map: every monster, all the loot and the event there are gone, as if they had never been. Your own fight too, Bosses and treasure included.' },
  lethe: { id: 'lethe', name: 'Lethe', cooldown: 12, combat: true, field: true, target: 'ally',
    desc: 'An ally with you (or you) is healed in full and their stress drops to 0, but their light goes out (0).' },
  bastion: { id: 'bastion', name: 'Bastion', cooldown: 6, combat: true, field: true, target: 'none',
    desc: `Gain Shield equal to ${LEGEND_RULES.bastionPerBlock}× your Block.` },
  arise: { id: 'arise', name: 'Arise', cooldown: 10, combat: true, field: true, target: 'fallen',
    desc: 'A downed or dead ally in your room comes back to life at full HP.' },
  howl: { id: 'howl', name: 'Howl', cooldown: 6, combat: true, field: true, target: 'none',
    desc: `A wolf comes to fight at your side and follows you from fight to fight (up to ${LEGEND_RULES.maxWolves}). Its bites cost their target 1 Block until the fight ends.` },
  waystep: { id: 'waystep', name: 'Waystep', cooldown: 4, combat: true, field: true, target: 'room',
    desc: 'Step out of the world and into any room on your map. From a fight, you leave it.' },
};

/** "Cooldown 8 · in fights and out" for item text. */
export function legendNote(id: LegendId): string {
  const l = LEGENDS[id];
  const where = l.combat && l.field ? 'in a fight or out' : l.combat ? 'in a fight' : 'out of a fight';
  return `${l.name} (cooldown ${l.cooldown}, ${where}): ${l.desc}`;
}
