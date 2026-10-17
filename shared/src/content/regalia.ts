import type { ClassId } from './classes';

/**
 * Regalia and Specializations (user, 2026-10-13). Every Boss carries regalia. Killed, it drops one Shard of it for
 * each player still inside whose Village lacks that Shard (up to 4). A hero carries one Shard at most, and only one
 * their Village lacks; carried out, it is the Village's for good. Each Shard unlocks something in the Village: the
 * first one brought home unlocks Specializations, and most Shards unlock a Spec of their own.
 */
export type ShardId = 'crown';
export type SpecId = 'seasoned';

export interface ShardDef {
  id: ShardId;
  name: string;
  glyph: string;
  /** The Spec it unlocks in the Village. */
  spec: SpecId;
}

export interface SpecDef {
  id: SpecId;
  name: string;
  desc: string;
  /** Classes that can take it (all, unless listed). */
  classes?: ClassId[];
}

export const SHARDS: Record<ShardId, ShardDef> = {
  crown: { id: 'crown', name: 'Shard of the Crown', glyph: '♔', spec: 'seasoned' },
};
export const SHARD_IDS = Object.keys(SHARDS) as ShardId[];

export const SPECS: Record<SpecId, SpecDef> = {
  seasoned: { id: 'seasoned', name: 'Seasoned', desc: 'Holds 4 cards in a fight instead of 3.' },
};
export const SPEC_IDS = Object.keys(SPECS) as SpecId[];

export const REGALIA_RULES = {
  /** Gold a Spec costs, per Character. */
  specCost: 250,
  /** The most Shards a Boss drops. */
  maxShards: 4,
};

/** The Specs a Village's Shards have unlocked. */
export function specsUnlocked(shards: readonly ShardId[]): SpecId[] {
  return SPEC_IDS.filter((s) => shards.some((x) => SHARDS[x].spec === s));
}

/** Can a Character of this class take this Spec? */
export function specFits(spec: SpecId, cls: ClassId): boolean {
  return !SPECS[spec].classes || SPECS[spec].classes!.includes(cls);
}

/** Seasoned (user, 2026-10-17; it was the class's other Talent): the hand a Seasoned Character holds in a fight. */
export const SEASONED_HAND = 4;
