export type ItemId =
  | 'bandage' | 'torch' | 'tonic' | 'firebomb' | 'salts'
  | 'coin' | 'locket' | 'catseye' | 'ward'
  | 'shortsword' | 'hatchet' | 'mace' | 'spear' | 'runeblade' | 'emberaxe'
  | 'jerkin' | 'leathercoat' | 'chainshirt' | 'brigandine' | 'cuirass' | 'wardmail';

/** Equipment goes in its own slot (one of each), not the pack. */
export type GearSlot = 'weapon' | 'armor';

/** self: only on you · ally: a conscious hero in your room/fight · downed: a downed ally · enemies: all enemies */
export type ItemTarget = 'self' | 'ally' | 'downed' | 'enemies';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'consumable' | 'trinket' | GearSlot;
  glyph: string;
  desc: string;
  target: ItemTarget;
  /** Usable as a combat action. */
  combat: boolean;
  /** Usable while exploring. */
  field: boolean;
  /** Weapons: fraction added to all damage you deal (0.1 = +10%). */
  dmgPct?: number;
  /** Armor: subtracted from every hit you take (never below 1). */
  armor?: number;
  /** Seconds added to your Speed while you wear or carry it (weapons, armor, trinkets). */
  speed?: number;
}

/** Seconds of Speed that worn gear and carried trinkets cost. */
export const GEAR_SPEED = { weapon: 0.5, armor: 0.5, trinket: 0.1 };

const weapon = (id: ItemId, name: string, glyph: string, dmgPct: number): ItemDef => ({
  id, name, kind: 'weapon', glyph, desc: `Weapon: +${Math.round(dmgPct * 100)}% damage dealt. +${GEAR_SPEED.weapon}s Speed.`, target: 'self', combat: false, field: false, dmgPct, speed: GEAR_SPEED.weapon,
});
const armor = (id: ItemId, name: string, glyph: string, value: number): ItemDef => ({
  id, name, kind: 'armor', glyph, desc: `Armor: −${value} damage from every hit (min 1). +${GEAR_SPEED.armor}s Speed.`, target: 'self', combat: false, field: false, armor: value, speed: GEAR_SPEED.armor,
});

export const ITEMS: Record<ItemId, ItemDef> = {
  bandage: { id: 'bandage', name: 'Bandage', kind: 'consumable', glyph: '✚', desc: 'Heal 12 and stop bleeding.', target: 'ally', combat: true, field: true },
  torch: { id: 'torch', name: 'Torch', kind: 'consumable', glyph: '🔥', desc: '+50 light.', target: 'self', combat: true, field: true },
  tonic: { id: 'tonic', name: 'Tonic', kind: 'consumable', glyph: '⚗', desc: '−25 stress.', target: 'self', combat: true, field: true },
  firebomb: { id: 'firebomb', name: 'Firebomb', kind: 'consumable', glyph: '✹', desc: '8 damage to every enemy.', target: 'enemies', combat: true, field: false },
  salts: { id: 'salts', name: 'Smelling Salts', kind: 'consumable', glyph: '❖', desc: 'Revive a downed ally at 50% HP — even from the next room.', target: 'downed', combat: true, field: true },
  coin: { id: 'coin', name: 'Lucky Coin', kind: 'trinket', glyph: '◉', desc: 'Passive: +10% on every gold share. +0.1s Speed.', target: 'self', combat: false, field: false, speed: GEAR_SPEED.trinket },
  locket: { id: 'locket', name: 'Iron Locket', kind: 'trinket', glyph: '♡', desc: 'Passive: +8 max HP. +0.1s Speed.', target: 'self', combat: false, field: false, speed: GEAR_SPEED.trinket },
  catseye: { id: 'catseye', name: "Cat's-Eye", kind: 'trinket', glyph: '◈', desc: 'Passive: being Dim no longer hides neighbouring rooms. +0.1s Speed.', target: 'self', combat: false, field: false, speed: GEAR_SPEED.trinket },
  ward: { id: 'ward', name: 'Ward Charm', kind: 'trinket', glyph: '☥', desc: 'Passive: −25% stress taken. +0.1s Speed.', target: 'self', combat: false, field: false, speed: GEAR_SPEED.trinket },
  shortsword: weapon('shortsword', 'Rusty Shortsword', '🗡', 0.1),
  hatchet: weapon('hatchet', 'Hatchet', '🪓', 0.1),
  mace: weapon('mace', 'Flanged Mace', '⚒', 0.2),
  spear: weapon('spear', 'Hunting Spear', '↟', 0.2),
  runeblade: weapon('runeblade', 'Runed Blade', '⚔', 0.35),
  emberaxe: weapon('emberaxe', 'Ember Axe', '⚚', 0.35),
  jerkin: armor('jerkin', 'Padded Jerkin', '▤', 1),
  leathercoat: armor('leathercoat', 'Leather Coat', '▥', 1),
  chainshirt: armor('chainshirt', 'Chain Shirt', '▦', 2),
  brigandine: armor('brigandine', 'Brigandine', '▧', 2),
  cuirass: armor('cuirass', 'Plate Cuirass', '▣', 3),
  wardmail: armor('wardmail', 'Warded Mail', '◘', 3),
};

export function isGear(item: ItemId): boolean {
  const k = ITEMS[item].kind;
  return k === 'weapon' || k === 'armor';
}

/** How much better `item` is than what's in that slot now (0 or less = not an upgrade). */
export function gearGain(item: ItemId, current: ItemId | null): number {
  const value = (id: ItemId | null) => (id ? (ITEMS[id].dmgPct ?? 0) * 10 + (ITEMS[id].armor ?? 0) : 0);
  return value(item) - value(current);
}

export const INVENTORY_SLOTS = 4;

/** rarity: 1 common · 2 uncommon · 3 rare. Better loot (tougher kills, vaults) leans toward rarer items. */
export const LOOT_TABLE: { item: ItemId; weight: number; rarity: 1 | 2 | 3 }[] = [
  { item: 'bandage', weight: 7, rarity: 1 },
  { item: 'torch', weight: 4, rarity: 1 },
  { item: 'tonic', weight: 3, rarity: 1 },
  { item: 'firebomb', weight: 3, rarity: 2 },
  { item: 'salts', weight: 2, rarity: 2 },
  { item: 'coin', weight: 1, rarity: 3 },
  { item: 'locket', weight: 1, rarity: 3 },
  { item: 'catseye', weight: 1, rarity: 3 },
  { item: 'ward', weight: 1, rarity: 3 },
  { item: 'shortsword', weight: 1.5, rarity: 1 },
  { item: 'hatchet', weight: 1.5, rarity: 1 },
  { item: 'jerkin', weight: 1.5, rarity: 1 },
  { item: 'leathercoat', weight: 1.5, rarity: 1 },
  { item: 'mace', weight: 1, rarity: 2 },
  { item: 'spear', weight: 1, rarity: 2 },
  { item: 'chainshirt', weight: 1, rarity: 2 },
  { item: 'brigandine', weight: 1, rarity: 2 },
  { item: 'runeblade', weight: 0.5, rarity: 3 },
  { item: 'emberaxe', weight: 0.5, rarity: 3 },
  { item: 'cuirass', weight: 0.5, rarity: 3 },
  { item: 'wardmail', weight: 0.5, rarity: 3 },
];

/** An item's tier (its loot rarity): 1 common · 2 uncommon · 3 rare. */
export function itemTier(item: ItemId): 1 | 2 | 3 {
  return LOOT_TABLE.find((e) => e.item === item)?.rarity ?? 1;
}

/** Loot seeding per room, and what monsters drop. */
export const LOOT = {
  guardedChance: 0.75,
  guardedGold: [12, 30] as const,
  lairGold: [35, 70] as const,
  /** Extra drop points a lair is worth on top of its monsters (more and better items). */
  lairBounty: 40,
  emptyChance: 0.35,
  emptyGold: [4, 12] as const,
  /** Rooms without monsters: chance of an item lying around (rolled separately from gold). */
  emptyItemChance: 0.35,
  deadEndBonusItemChance: 0.6,
  /** Clearing a room drops 1 item, +1 per this many points of monster (base HP × tier scaling) slain there. */
  dropPointsPerItem: 40,
  /** Drop quality: points at or above these give quality 2 / 3. */
  dropQuality2: 20,
  dropQuality3: 45,
  /** Weight multiplier for items of exactly the rolled quality, and per step above it. */
  qualityMatchBonus: 3,
  qualityAbovePenalty: 0.3,
};
