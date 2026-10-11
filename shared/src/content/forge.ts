import type { Rng } from '../rng';
import { ANVIL_UPGRADES } from './events';
import { GEAR_TYPE_NAMES, isGear, ITEMS, itemTier, LOOT_TABLE, type GearType, type ItemId } from './items';

/**
 * Gear smithing, shared by the Smith's Anvil event and the Village Blacksmith. A piece's *kind* for this is its Gear
 * type (Dagger, Hammer, Staff, Leather, Mail, Cloth), or its slot for amulets and rings.
 */
export type GearKind = GearType | 'amulet' | 'ring';
export const GEAR_KINDS: readonly GearKind[] = ['dagger', 'hammer', 'staff', 'leather', 'mail', 'cloth', 'amulet', 'ring'];
export const GEAR_KIND_NAMES: Record<GearKind, string> = { ...GEAR_TYPE_NAMES, amulet: 'Amulet', ring: 'Ring' };
export const GEAR_KIND_PLURALS: Record<GearKind, string> = {
  dagger: 'Daggers', hammer: 'Hammers', staff: 'Staves', leather: 'Leather armor', mail: 'Mail', cloth: 'Cloth', amulet: 'Amulets', ring: 'Rings',
};
export const RARITY_NAMES = { 1: 'common', 2: 'uncommon', 3: 'rare' } as const;

export function gearKind(item: ItemId): GearKind | null {
  if (!isGear(item)) return null;
  const d = ITEMS[item];
  return d.gearType ?? (d.kind as 'amulet' | 'ring');
}

/** Every piece of Gear that can turn up in the dungeon, with its loot weight. */
const GEAR_POOL = LOOT_TABLE.filter((e) => isGear(e.item));

/** Weighted pick from loot-table entries. */
function pickWeighted(rng: Rng, pool: { item: ItemId; weight: number }[]): ItemId | null {
  if (!pool.length) return null;
  let roll = rng.float(0, pool.reduce((s, e) => s + e.weight, 0));
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return pool[pool.length - 1].item;
}

/** A random piece of Gear of this rarity (as often as it drops in the dungeon). */
export function randomGear(rng: Rng, rarity: 1 | 2 | 3): ItemId {
  return pickWeighted(rng, GEAR_POOL.filter((e) => e.rarity === rarity))!;
}

/** What a piece could be rerolled into: another of its kind and rarity. */
export function rerollPool(item: ItemId): ItemId[] {
  const kind = gearKind(item);
  return GEAR_POOL.filter((e) => e.item !== item && e.rarity === itemTier(item) && gearKind(e.item) === kind).map((e) => e.item);
}

/** Can the anvil better it? Anything but a Rare. */
export function forgeable(item: ItemId | null | undefined): item is ItemId {
  return !!item && isGear(item) && itemTier(item) < 3;
}

/** What the anvil makes of it: "a Skinning Knife", "a random rare Staff". */
export function anvilInto(item: ItemId): string {
  const next = ANVIL_UPGRADES[item];
  if (next) return `${/^[AEIOU]/.test(ITEMS[next].name) ? 'an' : 'a'} ${ITEMS[next].name}`;
  const d = ITEMS[item];
  return `a random ${RARITY_NAMES[(itemTier(item) + 1) as 2 | 3]} ${d.gearType ? GEAR_TYPE_NAMES[d.gearType] : d.kind}`;
}

/** The anvil's work: the next piece up, or else a random piece of the same kind one rarity up. */
export function reforged(rng: Rng, item: ItemId): ItemId {
  const next = ANVIL_UPGRADES[item];
  if (next) return next;
  const kind = gearKind(item);
  const pool = GEAR_POOL.filter((e) => e.rarity === itemTier(item) + 1 && gearKind(e.item) === kind).map((e) => e.item);
  return pool.length ? rng.pick(pool) : item;
}
