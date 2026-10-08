export type ItemId = 'bandage' | 'torch' | 'tonic' | 'firebomb' | 'salts' | 'coin' | 'locket' | 'catseye' | 'ward';

/** self: only on you · ally: a conscious hero in your room/fight · downed: a downed ally · enemies: all enemies */
export type ItemTarget = 'self' | 'ally' | 'downed' | 'enemies';

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'consumable' | 'trinket';
  glyph: string;
  desc: string;
  target: ItemTarget;
  /** Usable as a combat action. */
  combat: boolean;
  /** Usable while exploring. */
  field: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  bandage: { id: 'bandage', name: 'Bandage', kind: 'consumable', glyph: '✚', desc: 'Heal 12 and stop bleeding.', target: 'ally', combat: true, field: true },
  torch: { id: 'torch', name: 'Torch', kind: 'consumable', glyph: '🔥', desc: '+50 light.', target: 'self', combat: true, field: true },
  tonic: { id: 'tonic', name: 'Tonic', kind: 'consumable', glyph: '⚗', desc: '−25 stress.', target: 'self', combat: true, field: true },
  firebomb: { id: 'firebomb', name: 'Firebomb', kind: 'consumable', glyph: '✹', desc: '8 damage to every enemy.', target: 'enemies', combat: true, field: false },
  salts: { id: 'salts', name: 'Smelling Salts', kind: 'consumable', glyph: '❖', desc: 'Revive a downed ally at 50% HP — even from the next room.', target: 'downed', combat: true, field: true },
  coin: { id: 'coin', name: 'Lucky Coin', kind: 'trinket', glyph: '◉', desc: 'Passive: +10% on every gold share.', target: 'self', combat: false, field: false },
  locket: { id: 'locket', name: 'Iron Locket', kind: 'trinket', glyph: '♡', desc: 'Passive: +8 max HP.', target: 'self', combat: false, field: false },
  catseye: { id: 'catseye', name: "Cat's-Eye", kind: 'trinket', glyph: '◈', desc: 'Passive: being Dim no longer hides neighbouring rooms.', target: 'self', combat: false, field: false },
  ward: { id: 'ward', name: 'Ward Charm', kind: 'trinket', glyph: '☥', desc: 'Passive: −25% stress taken.', target: 'self', combat: false, field: false },
};

export const INVENTORY_SLOTS = 4;

export const LOOT_TABLE: { item: ItemId; weight: number }[] = [
  { item: 'bandage', weight: 7 },
  { item: 'torch', weight: 4 },
  { item: 'tonic', weight: 3 },
  { item: 'firebomb', weight: 3 },
  { item: 'salts', weight: 2 },
  { item: 'coin', weight: 1 },
  { item: 'locket', weight: 1 },
  { item: 'catseye', weight: 1 },
  { item: 'ward', weight: 1 },
];

/** Loot seeding per room. Guarded rooms and dead ends are richer. */
export const LOOT = {
  guardedChance: 0.75,
  guardedGold: [12, 30] as const,
  guardedItemChance: 0.6,
  emptyChance: 0.3,
  emptyGold: [4, 12] as const,
  emptyItemChance: 0.3,
  deadEndBonusItemChance: 0.5,
};
