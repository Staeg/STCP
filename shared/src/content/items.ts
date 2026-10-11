export type ItemId =
  | 'bandage' | 'torch' | 'tonic' | 'firebomb' | 'salts'
  | 'coin' | 'locket' | 'ward' | 'ember' | 'harefoot' | 'fever'
  | 'catseye' | 'bloodstone' | 'thorns' | 'quickblood' | 'ashen'
  | 'effigy' | 'gem' | 'tome' | 'relic'
  | 'satchel'
  | 'dirk' | 'knife' | 'stiletto' | 'kris' | 'misericorde' | 'whisperblade'
  | 'cudgel' | 'sledge' | 'warhammer' | 'ironmaul' | 'bonebreaker' | 'giantmaul'
  | 'crook' | 'censer' | 'rowan' | 'wardstaff' | 'witchwood' | 'twinned' | 'evergreen' | 'hourglass'
  | 'jerkin' | 'studded' | 'drakehide' | 'shadowskin'
  | 'ringmail' | 'scaleshirt' | 'hauberk' | 'brigandine' | 'wardmail' | 'bulwark'
  | 'patchwork' | 'hastening' | 'wayfarer' | 'sackcloth' | 'gravecloth' | 'softstep' | 'blinkcloth' | 'gossamer';

/** Gear types (user 2026-10-11). Daggers, Leather and Cloth are light (never slower); the rest are heavy. */
export type GearType = 'dagger' | 'hammer' | 'staff' | 'leather' | 'mail' | 'cloth';
export const GEAR_TYPE_NAMES: Record<GearType, string> = {
  dagger: 'Dagger', hammer: 'Hammer', staff: 'Staff', leather: 'Leather', mail: 'Mail', cloth: 'Cloth',
};

/** Worn things go in their own slot (one of each), not the pack. */
export type GearSlot = 'weapon' | 'armor' | 'amulet' | 'ring';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'amulet', 'ring'];

/** self: only on you · ally: a conscious hero in your room/fight · downed: a downed ally · enemies: all enemies */
export type ItemTarget = 'self' | 'ally' | 'downed' | 'enemies';

export interface ItemDef {
  id: ItemId;
  name: string;
  /**
   * resource: Effigies, Gems, Tomes and Relics, carried home to the Village (they stack in the pack). valuable: worth
   * `value` gold (× the CR's gold bonus) if carried out.
   */
  kind: 'consumable' | 'resource' | 'valuable' | GearSlot;
  /** Valuables: gold it's worth once carried out of the dungeon. */
  value?: number;
  glyph: string;
  desc: string;
  target: ItemTarget;
  /** Usable as a combat action. */
  combat: boolean;
  /** Usable while exploring. */
  field: boolean;
  /** Weapons and armor: which kind of weapon or armor it is. */
  gearType?: GearType;
  /** Weapons: fraction added to all damage you deal (0.1 = +10%). */
  dmgPct?: number;
  /** Hammers: added to every direct hit you deal, before `dmgPct` (not to Poison ticks). */
  flatDmg?: number;
  /** Staves: what it does for the one who carries it (numbers in STAFF). */
  staff?: StaffEffect;
  /** Cloth: what sets it off and how often it can (numbers in CLOTH). Its charge belongs to the copy. */
  cloth?: ClothDef;
  /** Goes off by itself while worn; clicking the worn piece turns it off and on again. */
  auto?: true;
  /** Cloth with a drawback while worn (like cursed amulets and rings, but no quicker for it). */
  cursed?: true;
  /** Armor: subtracted from every hit you take (never below 1). */
  armor?: number;
  /** Seconds added to your Speed while you wear it (negative = faster: cursed amulets and rings, a few light rares). */
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

/** The pack: this many slots; Effigies, Gems, Tomes and Relics stack up to STACK_SIZE in one. */
export const INVENTORY_SLOTS = 14;
export const STACK_SIZE = 3;
/** Carried gold fills pack slots too, this much to a slot (user, 2026-10-11). */
export const GOLD_PER_SLOT = 50;
/** Only the first this-many consumables (which always sort to the top of the pack) get number keys. */
export const HOTKEY_ITEMS = 4;

/** " +0.5s Speed." / " −0.5s Speed (faster)." / "" */
const speedNote = (speed: number) => (speed > 0 ? ` +${speed}s Speed.` : speed < 0 ? ` −${-speed}s Speed (faster).` : '');
const pct = (f: number) => `+${Math.round(f * 100)}%`;
const GLYPHS: Record<GearType, string> = { dagger: '🗡', hammer: '⚒', staff: '⚚', leather: '▥', mail: '▦', cloth: '≋' };

const dagger = (id: ItemId, name: string, dmgPct: number, speed = 0): ItemDef => ({
  id, name, kind: 'weapon', gearType: 'dagger', glyph: GLYPHS.dagger, target: 'self', combat: false, field: false, dmgPct, speed,
  desc: `Dagger: ${pct(dmgPct)} damage dealt.${speedNote(speed)}`,
});
const hammer = (id: ItemId, name: string, flatDmg: number, dmgPct: number, speed: number): ItemDef => ({
  id, name, kind: 'weapon', gearType: 'hammer', glyph: GLYPHS.hammer, target: 'self', combat: false, field: false, dmgPct, flatDmg, speed,
  desc: `Hammer: +${flatDmg} to every hit, then ${pct(dmgPct)} damage dealt.${speedNote(speed)}`,
});
/**
 * Staves (user 2026-10-11): no damage, for those who help, hinder or hurry. heal: healing you give · relief: stress
 * you take off others (and Take Their Sins) · linger: your debuffs last longer · ward: Shield on whoever you heal,
 * buff or relieve, in a fight or out · witch: what carries your debuffs takes more from everyone · twin: your debuffs
 * land twice · evergreen: your buffs last twice as long · hourglass: shorter cooldowns, down to 0.
 */
export type StaffEffect = 'heal' | 'relief' | 'linger' | 'ward' | 'witch' | 'twin' | 'evergreen' | 'hourglass';
export const STAFF = {
  healMult: 1.5,
  reliefMult: 1.5,
  lingerTurns: 1,
  wardShield: 2,
  witchMult: 1.15,
  evergreenMult: 2,
  hourglassCut: 1,
};
const staff = (id: ItemId, name: string, effect: StaffEffect, text: string, speed = 0.5): ItemDef => ({
  id, name, kind: 'weapon', gearType: 'staff', glyph: GLYPHS.staff, target: 'self', combat: false, field: false, staff: effect, speed,
  desc: `Staff: ${text}${speedNote(speed)}`,
});

/**
 * Cloth (user 2026-10-11): no protection, but something that goes off by itself while worn, limited by a cooldown
 * (seconds, counted only while worn), uses per run, or once a fight. Each copy keeps its own charge.
 */
export type ClothEffect = 'patchwork' | 'hasten' | 'wayfarer' | 'penitent' | 'grave' | 'softstep' | 'blink' | 'gossamer';
export interface ClothDef {
  effect: ClothEffect;
  /** Seconds before it can go off again (counted only while worn). */
  cooldown?: number;
  /** Times it can go off in a run (this copy). */
  usesPerRun?: number;
  /** Once in each fight. */
  perFight?: boolean;
}
export const CLOTH = {
  patchworkMult: 0.5,
  hastenSecs: 3,
  wayfarerSecs: 1,
  penitentBelow: 0.3,
  penitentHeal: 15,
  graveTurns: 2,
  graveHp: 0.25,
  blinkStress: 13, // 20 until the stress rework (×⅔)
};
const cloth = (id: ItemId, name: string, def: ClothDef, text: string, extra: Partial<ItemDef> = {}): ItemDef => {
  const limit = def.perFight ? 'Once a fight.' : def.cooldown ? `Every ${def.cooldown}s worn.` : def.usesPerRun ? `${def.usesPerRun === 1 ? 'Once' : `${def.usesPerRun}×`} a run.` : '';
  const speed = extra.speed ?? 0;
  return {
    id, name, kind: 'armor', gearType: 'cloth', glyph: GLYPHS.cloth, target: 'self', combat: false, field: false, cloth: def, auto: true, speed, ...extra,
    desc: `Cloth: ${text} ${limit}${speedNote(speed)} Click it while worn to turn it off or on.`,
  };
};

const armor = (type: 'leather' | 'mail', id: ItemId, name: string, value: number, speed: number): ItemDef => ({
  id, name, kind: 'armor', gearType: type, glyph: GLYPHS[type], target: 'self', combat: false, field: false, armor: value, speed,
  desc: `${GEAR_TYPE_NAMES[type]}: −${value} damage from every hit (min 1).${speedNote(speed)}`,
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
  tonic: { id: 'tonic', name: 'Tonic', kind: 'consumable', glyph: '⚗', desc: '−17 stress.', target: 'self', combat: true, field: true },
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
  // Valuables: gold once carried out (they slow you while carried: put one down to run).
  satchel: { id: 'satchel', name: "Courier's Satchel", kind: 'valuable', glyph: '⚖', value: 150, speed: 1.5, target: 'self', combat: false, field: false,
    desc: 'Valuable: worth 150 gold if you carry it out. +1.5s Speed while you carry it.' },
  // Gear types (user 2026-10-11): no two pieces share a rarity and an effect.
  dirk: dagger('dirk', 'Rusty Dirk', 0.1),
  knife: dagger('knife', 'Skinning Knife', 0.15),
  stiletto: dagger('stiletto', 'Stiletto', 0.2),
  kris: dagger('kris', 'Kris', 0.25),
  misericorde: dagger('misericorde', 'Misericorde', 0.35),
  whisperblade: dagger('whisperblade', 'Whisperblade', 0.1, -0.5),
  cudgel: hammer('cudgel', 'Cudgel', 1, 0.2, 0.5),
  sledge: hammer('sledge', 'Sledge', 2, 0.3, 1),
  warhammer: hammer('warhammer', 'Warhammer', 2, 0.35, 0.5),
  ironmaul: hammer('ironmaul', 'Iron Maul', 3, 0.5, 1),
  bonebreaker: hammer('bonebreaker', 'Bonebreaker', 3, 0.5, 0.5),
  giantmaul: hammer('giantmaul', "Giant's Maul", 5, 0.75, 1),
  crook: staff('crook', "Shepherd's Crook", 'heal', 'healing you give +50%.'),
  censer: staff('censer', 'Censer Staff', 'relief', 'stress you relieve +50% (Take Their Sins moves 50% more).'),
  rowan: staff('rowan', 'Rowan Staff', 'linger', 'debuffs you place last 1 turn longer.'),
  wardstaff: staff('wardstaff', 'Warding Staff', 'ward', 'whoever you heal, buff or relieve also gains +2 Shield, in a fight or out of one.'),
  witchwood: staff('witchwood', 'Witchwood Staff', 'witch', 'enemies carrying your debuffs take +15% damage from everyone.'),
  twinned: staff('twinned', 'Twinned Staff', 'twin', 'every debuff you place lands twice (two stacks; Stun chances roll twice).'),
  evergreen: staff('evergreen', 'Evergreen Staff', 'evergreen', 'buffs you place last twice as long.'),
  hourglass: staff('hourglass', 'Hourglass Staff', 'hourglass', 'all your cooldowns are 1 turn shorter, down to 0.', 1),
  jerkin: armor('leather', 'jerkin', 'Padded Jerkin', 1, 0),
  studded: armor('leather', 'studded', 'Studded Leather', 2, 0),
  drakehide: armor('leather', 'drakehide', 'Drakehide', 3, 0),
  shadowskin: armor('leather', 'shadowskin', 'Shadowskin', 1, -0.5),
  ringmail: armor('mail', 'ringmail', 'Ring Mail', 2, 0.5),
  scaleshirt: armor('mail', 'scaleshirt', 'Scale Shirt', 3, 1),
  hauberk: armor('mail', 'hauberk', 'Chain Hauberk', 3, 0.5),
  brigandine: armor('mail', 'brigandine', 'Brigandine', 4, 1),
  wardmail: armor('mail', 'wardmail', 'Warded Mail', 4, 0.5),
  bulwark: armor('mail', 'bulwark', 'Bulwark Plate', 5, 1),
  patchwork: cloth('patchwork', 'Patchwork Coat', { effect: 'patchwork', perFight: true }, 'the first blow you take in a fight is halved (before armor and Shield).'),
  hastening: cloth('hastening', 'Hastening Robe', { effect: 'hasten', cooldown: 60 }, `Swiftwork: the next event you start is done in ${CLOTH.hastenSecs}s, however long it usually takes.`),
  wayfarer: cloth('wayfarer', "Wayfarer's Cloak", { effect: 'wayfarer', cooldown: 12 }, `the next tunnel you set out on takes ${CLOTH.wayfarerSecs}s.`),
  sackcloth: cloth('sackcloth', "Penitent's Sackcloth", { effect: 'penitent', cooldown: 120 },
    `Cursed: +25% stress taken. Dropping below ${CLOTH.penitentBelow * 100}% HP heals you ${CLOTH.penitentHeal}.`, { cursed: true, stressMult: 1.25 }),
  gravecloth: cloth('gravecloth', 'Gravecloth', { effect: 'grave', usesPerRun: 1 },
    `Cursed: −8 max HP. When you go down, you get back up by yourself after ${CLOTH.graveTurns} of your turns at ${CLOTH.graveHp * 100}% HP, and again each time you fall in that room, until you leave it.`, { cursed: true, maxHp: -8 }),
  softstep: cloth('softstep', 'Softstep Cloak', { effect: 'softstep', cooldown: 90 },
    'Unnoticed: walking in on monsters, or monsters wandering in on you, starts no fight for you. If an ally starts one there, you are drawn in.'),
  blinkcloth: cloth('blinkcloth', 'Blinkcloth Mantle', { effect: 'blink', usesPerRun: 1 },
    `Slip: instead of going down, you leave at 1 HP for a random room next door (+${CLOTH.blinkStress} stress).`),
  gossamer: cloth('gossamer', 'Gossamer Shroud', { effect: 'gossamer', perFight: true }, 'the first attack aimed at you in a fight misses.', { speed: -0.5 }),
};

/** Weapons and armor from before gear types (2026-10-11): stashes and kits load them as the new piece of the same rarity. */
export const OLD_GEAR_IDS: Record<string, ItemId> = {
  shortsword: 'dirk', hatchet: 'knife', mace: 'stiletto', spear: 'kris', runeblade: 'misericorde', emberaxe: 'misericorde',
  leathercoat: 'jerkin', chainshirt: 'studded', cuirass: 'drakehide',
};

/** An id as saved before gear types, read as today's. */
export function migrateItemId(id: string): ItemId {
  return OLD_GEAR_IDS[id] ?? (id as ItemId);
}

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

/** Weapons and armor. */
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
  return k === 'consumable' || k === 'resource' || k === 'valuable' ? null : k;
}

/** Cursed amulets and rings (they hurt you, and quicken you), and cursed Cloth (a drawback while worn). */
export function isCursed(item: ItemId): boolean {
  return (isJewel(item) && (ITEMS[item].speed ?? 0) < 0) || !!ITEMS[item].cursed;
}

/** Pack slots this much gold fills. */
export function goldSlots(gold: number): number {
  return Math.ceil(Math.max(0, gold) / GOLD_PER_SLOT);
}

/** Pack slots these items (and this much gold) fill: consumables one each, resources in stacks of STACK_SIZE. */
export function packSlotsUsed(items: readonly ItemId[], gold = 0): number {
  const stacks = new Map<ItemId, number>();
  let n = goldSlots(gold);
  for (const it of items) {
    if (ITEMS[it].kind === 'resource') stacks.set(it, (stacks.get(it) ?? 0) + 1);
    else n++;
  }
  for (const c of stacks.values()) n += Math.ceil(c / STACK_SIZE);
  return n;
}

/** Could one more of this go in the pack (a free slot, or room on a stack of the same)? */
export function packFits(items: readonly ItemId[], item: ItemId, gold = 0): boolean {
  if (ITEMS[item].kind === 'resource' && items.filter((x) => x === item).length % STACK_SIZE !== 0) return true;
  return packSlotsUsed(items, gold) < INVENTORY_SLOTS;
}

/** How much more gold fits: the rest of a part-filled gold slot, plus GOLD_PER_SLOT per free slot. */
export function goldRoom(items: readonly ItemId[], gold: number): number {
  return Math.max(0, (INVENTORY_SLOTS - packSlotsUsed(items)) * GOLD_PER_SLOT - gold);
}

/** Carried gold as it's drawn in the pack: full slots of GOLD_PER_SLOT, the odd remainder last. */
export function goldStacks(gold: number): number[] {
  const out: number[] = [];
  for (let left = gold; left > 0; left -= GOLD_PER_SLOT) out.push(Math.min(GOLD_PER_SLOT, left));
  return out;
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
export function packFree(items: readonly ItemId[], gold = 0): number {
  return INVENTORY_SLOTS - packSlotsUsed(items, gold);
}

/**
 * Consumables first, then carried Gear, then resources (commonest first); within a rank, the order they were
 * picked up in.
 */
export function packRank(item: ItemId): number {
  if (isResource(item)) return 2 + RESOURCE_IDS.indexOf(item);
  if (ITEMS[item].kind === 'valuable') return 1.5;
  return isGear(item) ? 1 : 0;
}

/** Who it's for (bots): supports get the most from Staves; the quick feel every second of Speed more. */
export interface GearFit {
  support: boolean;
  /** Class base Speed. */
  speed: number;
}

/** How much better `item` is than what's in that slot now (0 or less = not an upgrade). */
export function gearGain(item: ItemId, current: ItemId | null, fit?: GearFit): number {
  const speedWeight = !fit ? 1 : fit.speed <= 4 ? 2 : fit.speed >= 6 ? 0.5 : 1;
  const value = (id: ItemId | null) => {
    if (!id) return 0;
    const d = ITEMS[id];
    const staff = d.staff && fit?.support ? itemTier(id) * 1.5 : 0;
    const cloth = d.cloth ? itemTier(id) - (d.cursed ? 0.5 : 0) : 0;
    return staff + cloth + (d.dmgPct ?? 0) * 10 + (d.flatDmg ?? 0) * 0.5 + (d.armor ?? 0) - (isArms(id) ? (d.speed ?? 0) * speedWeight : 0);
  };
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
  ...gearLoot('weapon', {
    1: ['dirk', 'knife', 'cudgel', 'sledge', 'crook', 'censer'],
    2: ['stiletto', 'kris', 'warhammer', 'ironmaul', 'rowan', 'wardstaff', 'witchwood'],
    3: ['misericorde', 'whisperblade', 'bonebreaker', 'giantmaul', 'twinned', 'evergreen', 'hourglass'],
  }),
  ...gearLoot('armor', {
    1: ['jerkin', 'ringmail', 'scaleshirt', 'patchwork'],
    2: ['studded', 'hauberk', 'brigandine', 'hastening', 'wayfarer', 'sackcloth'],
    3: ['drakehide', 'shadowskin', 'wardmail', 'bulwark', 'gravecloth', 'softstep', 'blinkcloth', 'gossamer'],
  }),
];

/**
 * Each slot finds about as much gear of each rarity as it did with 2 pieces per rarity (weights 1.5 / 1 / 0.5 each),
 * shared evenly by however many pieces that rarity has now.
 */
function gearLoot(_slot: 'weapon' | 'armor', tiers: Record<1 | 2 | 3, ItemId[]>): { item: ItemId; weight: number; rarity: 1 | 2 | 3 }[] {
  const total = { 1: 3, 2: 2, 3: 1 } as const;
  return ([1, 2, 3] as const).flatMap((r) => tiers[r].map((item) => ({ item, weight: total[r] / tiers[r].length, rarity: r })));
}

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
