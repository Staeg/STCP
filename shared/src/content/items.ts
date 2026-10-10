export type ItemId =
  | 'bandage' | 'torch' | 'tonic' | 'firebomb' | 'salts'
  | 'coin' | 'locket' | 'ward' | 'ember' | 'harefoot' | 'fever'
  | 'catseye' | 'bloodstone' | 'thorns' | 'quickblood' | 'ashen'
  | 'effigy' | 'gem' | 'tome' | 'relic'
  | 'shortsword' | 'hatchet' | 'mace' | 'spear' | 'runeblade' | 'emberaxe'
  | 'jerkin' | 'leathercoat' | 'chainshirt' | 'brigandine' | 'cuirass' | 'wardmail';

/** Worn things go in their own slot (one of each), not the pack. */
export type GearSlot = 'weapon' | 'armor' | 'amulet' | 'ring';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'amulet', 'ring'];

/** self: only on you · ally: a conscious hero in your room/fight · downed: a downed ally · enemies: all enemies */
export type ItemTarget = 'self' | 'ally' | 'downed' | 'enemies';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** resource: Effigies, Gems, Tomes and Relics, carried home to the Village (they stack in the pack). */
  kind: 'consumable' | 'resource' | GearSlot;
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
  /** Seconds added to your Speed while you wear it (negative = faster: only cursed amulets and rings). */
  speed?: number;
  // ---- Amulets and rings, while worn ----
  /** Added to max HP. */
  maxHp?: number;
  /** Multiplies stress you take. */
  stressMult?: number;
  /** Multiplies your gold shares. */
  goldMult?: number;
  /** Multiplies how fast your torch burns down. */
  lightDrainMult?: number;
  /** Added to every hit you take (after armor). */
  hurt?: number;
  /** Damage a monster takes back when it hits you. */
  thorns?: number;
  /** Seconds per HP regained while exploring. */
  regen?: number;
  /** Being Dim no longer hides neighbouring rooms. */
  seeDim?: boolean;
}

/** Seconds of Speed that worn weapons and armor cost. */
export const GEAR_SPEED = { weapon: 0.5, armor: 0.5 };

/** The pack: this many slots; Effigies, Gems, Tomes and Relics stack up to STACK_SIZE in one. */
export const INVENTORY_SLOTS = 14;
export const STACK_SIZE = 3;
/** Only the first this-many consumables (which always sort to the top of the pack) get number keys. */
export const HOTKEY_ITEMS = 4;

const weapon = (id: ItemId, name: string, glyph: string, dmgPct: number): ItemDef => ({
  id, name, kind: 'weapon', glyph, desc: `Weapon: +${Math.round(dmgPct * 100)}% damage dealt. +${GEAR_SPEED.weapon}s Speed.`, target: 'self', combat: false, field: false, dmgPct, speed: GEAR_SPEED.weapon,
});
const armor = (id: ItemId, name: string, glyph: string, value: number): ItemDef => ({
  id, name, kind: 'armor', glyph, desc: `Armor: −${value} damage from every hit (min 1). +${GEAR_SPEED.armor}s Speed.`, target: 'self', combat: false, field: false, armor: value, speed: GEAR_SPEED.armor,
});

const jewel = (id: ItemId, kind: 'amulet' | 'ring', name: string, glyph: string, effect: string, stats: Partial<ItemDef>): ItemDef => ({
  id, name, kind, glyph, target: 'self', combat: false, field: false, ...stats,
  desc: `${kind === 'amulet' ? 'Amulet' : 'Ring'}: ${effect}${stats.speed ? ` −${-stats.speed}s Speed (faster).` : ''}`,
});
const resource = (id: ItemId, name: string, glyph: string, rite: string): ItemDef => ({
  id, name, kind: 'resource', glyph, desc: `Resource: carry it home to your Village Stash. 5 power a Rite for your next run: ${rite} Stacks to ${STACK_SIZE}.`, target: 'self', combat: false, field: false,
});

export const ITEMS: Record<ItemId, ItemDef> = {
  bandage: { id: 'bandage', name: 'Bandage', kind: 'consumable', glyph: '✚', desc: 'Heal 12 and cure Poison.', target: 'ally', combat: true, field: true },
  torch: { id: 'torch', name: 'Torch', kind: 'consumable', glyph: '🔥', desc: '+50 light.', target: 'self', combat: true, field: true },
  tonic: { id: 'tonic', name: 'Tonic', kind: 'consumable', glyph: '⚗', desc: '−25 stress.', target: 'self', combat: true, field: true },
  firebomb: { id: 'firebomb', name: 'Firebomb', kind: 'consumable', glyph: '✹', desc: '8 damage to every enemy.', target: 'enemies', combat: true, field: false },
  salts: { id: 'salts', name: 'Smelling Salts', kind: 'consumable', glyph: '❖', desc: 'Revive a downed ally at 50% HP — even from the next room.', target: 'downed', combat: true, field: true },
  // Amulets and rings: blessed ones only help; cursed ones hurt you but quicken your step.
  locket: jewel('locket', 'amulet', 'Iron Locket', '♡', '+8 max HP.', { maxHp: 8 }),
  ward: jewel('ward', 'amulet', 'Ward Charm', '☥', '−25% stress taken.', { stressMult: 0.75 }),
  coin: jewel('coin', 'amulet', 'Lucky Coin', '◉', '+10% on every gold share.', { goldMult: 1.1 }),
  ember: jewel('ember', 'amulet', 'Ember Pendant', '♨', 'Your torch burns 40% slower.', { lightDrainMult: 0.6 }),
  harefoot: jewel('harefoot', 'amulet', "Hare's Foot", '⚘', 'Cursed: −10 max HP.', { maxHp: -10, speed: -1 }),
  fever: jewel('fever', 'amulet', 'Fever Charm', '♆', 'Cursed: +50% stress taken.', { stressMult: 1.5, speed: -1 }),
  catseye: jewel('catseye', 'ring', "Cat's-Eye", '◈', 'Being Dim no longer hides neighbouring rooms or adds stress.', { seeDim: true }),
  bloodstone: jewel('bloodstone', 'ring', 'Bloodstone Ring', '◍', 'Regain 1 HP every 6s while exploring.', { regen: 6 }),
  thorns: jewel('thorns', 'ring', 'Thorn Ring', '✣', 'Monsters that hit you take 2 damage back.', { thorns: 2 }),
  quickblood: jewel('quickblood', 'ring', 'Quickblood Ring', '◌', 'Cursed: +1 damage from every hit you take.', { hurt: 1, speed: -1 }),
  ashen: jewel('ashen', 'ring', 'Ashen Band', '○', 'Cursed: your torch burns 60% faster.', { lightDrainMult: 1.6, speed: -0.75 }),
  // Resources (user 2026-10-10): worth nothing down here; carried home, they power Village Rites (village.ts RITES).
  effigy: resource('effigy', 'Effigy', '♙', 'CR +1; +20% damage and HP, −1s Speed.'),
  gem: resource('gem', 'Gem', '◆', 'CR −0.5, but you can’t pick up or use consumables.'),
  tome: resource('tome', 'Tome', '▯', '−20% damage and HP, but your gold comes home even if you die.'),
  relic: resource('relic', 'Relic', '♛', 'the whole run starts at Escalation 5.'),
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

/**
 * Gear (user 2026-10-10): weapons, armor, amulets and rings, everything worn in a slot of its own. Brought in from
 * the Village Stash, each piece adds 0.1 CR per level (its tier: 1 common, 2 uncommon, 3 rare).
 */
export function isGear(item: ItemId): boolean {
  return slotOf(item) !== null;
}

/** Resources (user 2026-10-10): Effigies, Gems, Tomes and Relics. They accumulate in the Village. */
export const RESOURCE_IDS = ['effigy', 'gem', 'tome', 'relic'] as const satisfies readonly ItemId[];
export type ResourceId = (typeof RESOURCE_IDS)[number];

export function isResource(item: ItemId): item is ResourceId {
  return ITEMS[item].kind === 'resource';
}

/** "Effigies", "Bandages": an item's name, for more than one. */
export function pluralName(item: ItemId): string {
  const n = ITEMS[item].name;
  return /[^aeiou]y$/.test(n) ? `${n.slice(0, -1)}ies` : `${n}s`;
}

/** Weapons and armor: tiered, and only ever swapped for something at least as good. */
export function isArms(item: ItemId): boolean {
  const k = ITEMS[item].kind;
  return k === 'weapon' || k === 'armor';
}

/** Amulets and rings. */
export function isJewel(item: ItemId): boolean {
  const k = ITEMS[item].kind;
  return k === 'amulet' || k === 'ring';
}

/** The slot it's worn in, or null for pack items. */
export function slotOf(item: ItemId): GearSlot | null {
  const k = ITEMS[item].kind;
  return k === 'consumable' || k === 'resource' ? null : k;
}

/** Cursed amulets and rings: they hurt you, and quicken you. */
export function isCursed(item: ItemId): boolean {
  return isJewel(item) && (ITEMS[item].speed ?? 0) < 0;
}

/** Pack slots these items fill: consumables one each, resources in stacks of STACK_SIZE. */
export function packSlotsUsed(items: readonly ItemId[]): number {
  const stacks = new Map<ItemId, number>();
  let n = 0;
  for (const it of items) {
    if (ITEMS[it].kind === 'resource') stacks.set(it, (stacks.get(it) ?? 0) + 1);
    else n++;
  }
  for (const c of stacks.values()) n += Math.ceil(c / STACK_SIZE);
  return n;
}

/** Could one more of this go in the pack (a free slot, or room on a stack of the same)? */
export function packFits(items: readonly ItemId[], item: ItemId): boolean {
  if (ITEMS[item].kind === 'resource' && items.filter((x) => x === item).length % STACK_SIZE !== 0) return true;
  return packSlotsUsed(items) < INVENTORY_SLOTS;
}

/**
 * The pack as it's drawn: one slot per consumable (they're always first), then resources in stacks of
 * STACK_SIZE. `indices` are the items' places in the hero's `items`.
 */
export function packSlots(items: readonly ItemId[]): { item: ItemId; indices: number[] }[] {
  const slots: { item: ItemId; indices: number[] }[] = [];
  items.forEach((item, i) => {
    const last = slots.at(-1);
    if (ITEMS[item].kind === 'resource' && last?.item === item && last.indices.length < STACK_SIZE) last.indices.push(i);
    else slots.push({ item, indices: [i] });
  });
  return slots;
}

/** Free pack slots. */
export function packFree(items: readonly ItemId[]): number {
  return INVENTORY_SLOTS - packSlotsUsed(items);
}

/** Resources sort after consumables, commonest first; consumables keep the order they were picked up in. */
export function packRank(item: ItemId): number {
  return isResource(item) ? 1 + RESOURCE_IDS.indexOf(item) : 0;
}

/** How much better `item` is than what's in that slot now (0 or less = not an upgrade). */
export function gearGain(item: ItemId, current: ItemId | null): number {
  const value = (id: ItemId | null) => (id ? (ITEMS[id].dmgPct ?? 0) * 10 + (ITEMS[id].armor ?? 0) : 0);
  return value(item) - value(current);
}

/** rarity: 1 common · 2 uncommon · 3 rare. Better loot (tougher kills, vaults) leans toward rarer items. */
export const LOOT_TABLE: { item: ItemId; weight: number; rarity: 1 | 2 | 3 }[] = [
  { item: 'bandage', weight: 7, rarity: 1 },
  { item: 'torch', weight: 4, rarity: 1 },
  { item: 'tonic', weight: 3, rarity: 1 },
  { item: 'firebomb', weight: 3, rarity: 2 },
  { item: 'salts', weight: 2, rarity: 2 },
  { item: 'coin', weight: 0.6, rarity: 3 },
  { item: 'locket', weight: 0.6, rarity: 3 },
  { item: 'ward', weight: 0.6, rarity: 3 },
  { item: 'ember', weight: 0.6, rarity: 3 },
  { item: 'catseye', weight: 0.6, rarity: 3 },
  { item: 'bloodstone', weight: 0.6, rarity: 3 },
  { item: 'thorns', weight: 0.6, rarity: 3 },
  { item: 'harefoot', weight: 0.5, rarity: 2 },
  { item: 'fever', weight: 0.5, rarity: 2 },
  { item: 'quickblood', weight: 0.5, rarity: 2 },
  { item: 'ashen', weight: 0.5, rarity: 2 },
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

/** Resources, rolled apart from the loot table: Effigies are common, Tomes rare; Relics are only ever found in lairs. */
export const RESOURCE_TABLE: { item: ItemId; weight: number; rarity: 1 | 2 | 3 }[] = [
  { item: 'effigy', weight: 6, rarity: 1 },
  { item: 'gem', weight: 3, rarity: 2 },
  { item: 'tome', weight: 1, rarity: 3 },
];

/** An item's tier (its loot rarity): 1 common · 2 uncommon · 3 rare. Relics count as rare. */
export function itemTier(item: ItemId): 1 | 2 | 3 {
  if (item === 'relic') return 3;
  return (LOOT_TABLE.find((e) => e.item === item) ?? RESOURCE_TABLE.find((e) => e.item === item))?.rarity ?? 1;
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
  /** Clearing a room drops 1 item, +1 per this many points of monster (base HP × Escalation scaling) slain there. */
  dropPointsPerItem: 40,
  /** Drop quality: points at or above these give quality 2 / 3. */
  dropQuality2: 20,
  dropQuality3: 45,
  /** Weight multiplier for items of exactly the rolled quality, and per step above it. */
  qualityMatchBonus: 3,
  qualityAbovePenalty: 0.3,
  /** Chance of a resource (Effigy, Gem or Tome) in any room, and in a dead end on top of that. */
  resourceChance: 0.25,
  deadEndResourceChance: 0.25,
  /** Clearing a room of monsters: chance the drop includes a resource. */
  dropResourceChance: 0.3,
  /** Lairs: chance of a Relic (the only place they're found). */
  relicChance: 0.75,
  /** Most items a room's floor holds from finds (the loot panel lays out up to this many cards). */
  maxDrops: 6,
};
