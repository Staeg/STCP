export type ItemId =
  | 'bandage' | 'torch' | 'firebomb' | 'salts' | 'flask'
  | 'locket' | 'ward' | 'ember' | 'harefoot' | 'fever'
  | 'catseye' | 'bloodstone' | 'thorns' | 'quickblood' | 'ashen'
  | 'effigy' | 'gem' | 'tome' | 'relic'
  | 'satchel'
  | 'dirk' | 'knife' | 'stiletto' | 'kris' | 'misericorde' | 'whisperblade'
  | 'cudgel' | 'sledge' | 'warhammer' | 'ironmaul' | 'bonebreaker' | 'giantmaul'
  | 'crook' | 'censer' | 'rowan' | 'wardstaff' | 'witchwood' | 'twinned' | 'evergreen' | 'hourglass'
  | 'jerkin' | 'studded' | 'drakehide' | 'shadowskin'
  | 'ringmail' | 'scaleshirt' | 'hauberk' | 'brigandine' | 'wardmail' | 'bulwark'
  | 'patchwork' | 'hastening' | 'wayfarer' | 'sackcloth' | 'gravecloth' | 'softstep' | 'blinkcloth' | 'gossamer'
  | 'alastor' | 'earthsplitter' | 'hollowrod' | 'daystar' | 'durance' | 'pilgrim' | 'fenrir' | 'silva'
  | 'tincharm' | 'copperband';

/** Gear types (user 2026-10-11). Daggers, Leather and Cloth are light (never slower); the rest are heavy. */
import { legendNote, type LegendId } from './legends';
import { cardText, CLASS_CARDS, TYPE_CARDS, type CardId, type CardKind } from './cards';
import type { ClassId } from './classes';

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
  /** Block: subtracted from every hit you take (never below 1). Negative (cursed rings) adds to every hit. */
  block?: number;
  /** Seconds added to your Speed while you wear it (negative = faster: cursed amulets and rings, a few light rares). */
  speed?: number;
  // ---- Amulets and rings, while worn ----
  /** Added to max HP. */
  maxHp?: number;
  /** Multiplies light the dungeon takes from you (monsters, events, allies falling; not your own spending or the burn). */
  lightLossMult?: number;
  /** Multiplies how fast your torch burns down. */
  lightDrainMult?: number;
  /** Damage a monster takes back when it hits you, on top of your Block. */
  thorns?: number;
  /** Seconds per HP regained while exploring. */
  regen?: number;
  /** Being Dim no longer hides neighbouring rooms, and you never forget paths. */
  seeDim?: boolean;
  /** Legendary (tier 4): the active ability it gives whoever wears it. */
  legend?: LegendId;
  /** Rares: the card it puts in its wearer's deck (Commons and Uncommons use their kind's, Legendaries their legend's). */
  card?: CardId;
  /** Given free at the start of a run (M15): never found, worth no CR, and it doesn't go home. */
  issued?: true;
  // ---- Card passives (M15), while worn ----
  /** Seconds added to every card you play (negative = quicker). */
  tempo?: number;
  /** Seconds added to every Delay you deal. */
  delayBonus?: number;
  /** Turns added to every Poison you place. */
  poisonTurns?: number;
  /** Your Strike cards deal this much more to a Poisoned enemy. */
  poisonedBonus?: number;
  /** Your hits crit (×2) on an enemy below this fraction of its HP. */
  lowCrit?: number;
  /** Your Venom cards take this many seconds less. */
  venomCut?: number;
  /** Your Hinder cards deal this much more damage. */
  hinderDmg?: number;
  /** Stunned enemies take this much more (0.5 = +50%) from your hits. */
  stunnedMult?: number;
  /** Your first card in each fight takes this many seconds less. */
  firstCardCut?: number;
  /** Poison and Bleed on you deal this fraction of their damage. */
  dotMult?: number;
  /** Always this chance to dodge an attack. */
  dodge?: number;
  /** Your Guard cards give this much more Shield. */
  guardShield?: number;
  /** Shield you start every fight with. */
  startShield?: number;
  /** Debuffs on you last this many turns (or twice as many seconds) less. */
  debuffResist?: number;
  /** Block added while you stand nearest the enemy. */
  frontBlock?: number;
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
 * Staves (user 2026-10-11): no damage, for those who help, hinder or hurry. heal: healing you give · relief: light
 * you give others (Vigil, Take Their Sins…; was stress relief until 2026-10-14) · linger: your debuffs last longer · ward: Shield on whoever you heal,
 * buff or relieve, in a fight or out · witch: what carries your debuffs takes more from everyone · twin: your debuffs
 * land twice · evergreen: your buffs last twice as long · hourglass: shorter cooldowns, down to 0.
 */
export type StaffEffect = 'heal' | 'relief' | 'linger' | 'ward' | 'witch' | 'twin' | 'evergreen' | 'hourglass';
export const STAFF = {
  healMult: 2,
  reliefMult: 2,
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
  /** Blinkcloth's slip costs this much light (was 13 stress). */
  blinkLight: 13,
};
const cloth = (id: ItemId, name: string, def: ClothDef, text: string, extra: Partial<ItemDef> = {}): ItemDef => {
  const limit = def.perFight ? 'Once a fight.' : def.cooldown ? `Every ${def.cooldown}s worn.` : def.usesPerRun ? `${def.usesPerRun === 1 ? 'Once' : `${def.usesPerRun}×`} a run.` : '';
  const speed = extra.speed ?? 0;
  return {
    id, name, kind: 'armor', gearType: 'cloth', glyph: GLYPHS.cloth, target: 'self', combat: false, field: false, cloth: def, auto: true, speed, ...extra,
    desc: `Cloth: ${text} ${limit}${speedNote(speed)} Click it while worn to turn it off or on.`,
  };
};

/** Block, as item text: "+3 Block (every hit you take does 3 less, min 1)." */
export const blockNote = (block: number) =>
  block >= 0 ? `+${block} Block (every hit you take does ${block} less, min 1).` : `−${-block} Block (every hit you take does ${-block} more).`;

const armor = (type: 'leather' | 'mail', id: ItemId, name: string, block: number, speed: number): ItemDef => ({
  id, name, kind: 'armor', gearType: type, glyph: GLYPHS[type], target: 'self', combat: false, field: false, block, speed,
  desc: `${GEAR_TYPE_NAMES[type]}: ${blockNote(block)}${speedNote(speed)}`,
});

const jewel = (id: ItemId, kind: 'amulet' | 'ring', name: string, glyph: string, effect: string, stats: Partial<ItemDef>): ItemDef => ({
  id, name, kind, glyph, target: 'self', combat: false, field: false, ...stats,
  desc: `${kind === 'amulet' ? 'Amulet' : 'Ring'}: ${effect}${stats.speed ? ` −${-stats.speed}s Speed (faster).` : ''}`,
});
const resource = (id: ItemId, name: string, glyph: string, rite: string, cost = '5 power'): ItemDef => ({
  id, name, kind: 'resource', glyph, desc: `Resource: carry it home to your Village Stash. ${cost} a Rite for your next run: ${rite} Stacks to ${STACK_SIZE}.`, target: 'self', combat: false, field: false,
});

export const ITEMS: Record<ItemId, ItemDef> = {
  bandage: { id: 'bandage', name: 'Bandage', kind: 'consumable', glyph: '✚', desc: 'Heal 12 and cure Poison.', target: 'ally', combat: true, field: true },
  torch: { id: 'torch', name: 'Torch', kind: 'consumable', glyph: '🔥', desc: '+50 light.', target: 'self', combat: true, field: true },

  firebomb: { id: 'firebomb', name: 'Firebomb', kind: 'consumable', glyph: '✹', desc: '8 damage to every enemy.', target: 'enemies', combat: true, field: false },
  // Only from the Quicksilver Pool (user, 2026-10-16): never in the loot table.
  flask: { id: 'flask', name: 'Quicksilver Flask', kind: 'consumable', glyph: '☿', desc: '−1s Speed for 60s.', target: 'self', combat: true, field: true },
  salts: { id: 'salts', name: 'Smelling Salts', kind: 'consumable', glyph: '❖', desc: 'Revive a downed ally at 50% HP — even from the next room.', target: 'downed', combat: true, field: true },
  // Amulets and rings: blessed ones only help; cursed ones hurt you but quicken your step.
  locket: jewel('locket', 'amulet', 'Iron Locket', '♡', '+20 max HP.', { maxHp: 20 }),
  ward: jewel('ward', 'amulet', 'Ward Charm', '☥', '−67% light lost to monsters and events.', { lightLossMult: 0.33 }),
  ember: jewel('ember', 'amulet', 'Ember Pendant', '♨', 'Your torch never burns down.', { lightDrainMult: 0 }),
  harefoot: jewel('harefoot', 'amulet', "Hare's Foot", '⚘', 'Cursed: −10 max HP.', { maxHp: -10, speed: -1 }),
  fever: jewel('fever', 'amulet', 'Fever Charm', '♆', 'Cursed: +67% light lost to monsters and events.', { lightLossMult: 1.67, speed: -1 }),
  catseye: jewel('catseye', 'ring', "Cat's-Eye", '◈', 'You never forget paths, and being Dim no longer hides neighbouring rooms.', { seeDim: true }),
  bloodstone: jewel('bloodstone', 'ring', 'Bloodstone Ring', '◍', 'Regain 1 HP every 4s while exploring.', { regen: 4 }),
  thorns: jewel('thorns', 'ring', 'Thorn Ring', '✣', 'Monsters that hit you take your Block + 1 damage back.', { thorns: 1 }),
  quickblood: jewel('quickblood', 'ring', 'Quickblood Ring', '◌', `Cursed: ${blockNote(-2)}`, { block: -2, speed: -1 }),
  ashen: jewel('ashen', 'ring', 'Ashen Band', '○', 'Cursed: your torch burns 150% faster.', { lightDrainMult: 2.5, speed: -1 }),
  // Resources (user 2026-10-10): worth nothing down here; carried home, they power Village Rites (village.ts RITES).
  effigy: resource('effigy', 'Effigy', '♙', 'CR +1; +20% damage and HP, −1s Speed.'),
  gem: resource('gem', 'Gem', '◆', 'CR −0.5, but you can’t pick up or use consumables.'),
  tome: resource('tome', 'Tome', '▯', '−20% damage and HP, but your gold comes home even if you die.'),
  relic: resource('relic', 'Relic', '♛', 'the whole run starts at Escalation 5, and the Dead King wakes.', 'One powers'),
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
  crook: staff('crook', "Shepherd's Crook", 'heal', `healing you give ×${STAFF.healMult}.`),
  censer: staff('censer', 'Censer Staff', 'relief', `light you give others ×${STAFF.reliefMult}.`),
  rowan: staff('rowan', 'Rowan Staff', 'linger', 'debuffs you place last 1 turn longer.'),
  wardstaff: staff('wardstaff', 'Warding Staff', 'ward', 'whoever you heal, buff or relieve also gains +2 Shield, in a fight or out of one.'),
  witchwood: staff('witchwood', 'Witchwood Staff', 'witch', 'enemies carrying your debuffs take +15% damage from everyone.'),
  twinned: staff('twinned', 'Twinned Staff', 'twin', 'every debuff you place lands twice (two stacks; Stun chances roll twice).'),
  evergreen: staff('evergreen', 'Evergreen Staff', 'evergreen', 'buffs you place last twice as long.'),
  hourglass: staff('hourglass', 'Hourglass Staff', 'hourglass', 'every card you play takes 0.5s less.', 1),
  jerkin: armor('leather', 'jerkin', 'Padded Jerkin', 1, 0),
  studded: armor('leather', 'studded', 'Studded Leather', 2, 0),
  drakehide: armor('leather', 'drakehide', 'Drakehide', 3, 0),
  shadowskin: armor('leather', 'shadowskin', 'Shadowskin', 1, -0.5),
  ringmail: armor('mail', 'ringmail', 'Ring Mail', 2, 0.5),
  scaleshirt: armor('mail', 'scaleshirt', 'Scale Shirt', 4, 1),
  hauberk: armor('mail', 'hauberk', 'Chain Hauberk', 3, 0.5),
  brigandine: armor('mail', 'brigandine', 'Brigandine', 5, 1),
  wardmail: armor('mail', 'wardmail', 'Warded Mail', 4, 0.5),
  bulwark: armor('mail', 'bulwark', 'Bulwark Plate', 6, 1),
  patchwork: cloth('patchwork', 'Patchwork Coat', { effect: 'patchwork', perFight: true }, 'the first blow you take in a fight is halved (before Block and Shield).'),
  hastening: cloth('hastening', 'Hastening Robe', { effect: 'hasten', cooldown: 60 }, `Swiftwork: the next event you start is done in ${CLOTH.hastenSecs}s, however long it usually takes.`),
  wayfarer: cloth('wayfarer', "Wayfarer's Cloak", { effect: 'wayfarer', cooldown: 12 }, `the next tunnel you set out on takes ${CLOTH.wayfarerSecs}s.`),
  sackcloth: cloth('sackcloth', "Penitent's Sackcloth", { effect: 'penitent', cooldown: 120 },
    `Cursed: +25% light lost to monsters and events. Dropping below ${CLOTH.penitentBelow * 100}% HP heals you ${CLOTH.penitentHeal}.`, { cursed: true, lightLossMult: 1.25 }),
  gravecloth: cloth('gravecloth', 'Gravecloth', { effect: 'grave', usesPerRun: 1 },
    `Cursed: −8 max HP. When you go down, you get back up by yourself after ${CLOTH.graveTurns} of your turns at ${CLOTH.graveHp * 100}% HP, and again each time you fall in that room, until you leave it.`, { cursed: true, maxHp: -8 }),
  softstep: cloth('softstep', 'Softstep Cloak', { effect: 'softstep', cooldown: 60 },
    'Unnoticed: walking in on monsters, or monsters wandering in on you, starts no fight for you. If an ally starts one there, you are drawn in.'),
  blinkcloth: cloth('blinkcloth', 'Blinkcloth Mantle', { effect: 'blink', perFight: true },
    `Slip: instead of going down, you leave at 1 HP for a random room next door (−${CLOTH.blinkLight} light).`),
  gossamer: cloth('gossamer', 'Gossamer Shroud', { effect: 'gossamer', perFight: true }, 'the first attack aimed at you in a fight misses.', { speed: -0.5 }),
  // Legendaries (user 2026-10-11): only from the Dead King's treasure. Stats like any piece, plus an ability.
  alastor: legendary('alastor', 'weapon', 'dagger', 'Oath of Alastor', 'promise', `${pct(0.35)} damage dealt.`, { dmgPct: 0.35, speed: -0.5 }),
  earthsplitter: legendary('earthsplitter', 'weapon', 'hammer', "Smough's Earthsplitter", 'quake', `+5 to every hit, then ${pct(0.75)} damage dealt.`, { flatDmg: 5, dmgPct: 0.75, speed: 0.5 }),
  hollowrod: legendary('hollowrod', 'weapon', 'staff', "Magister Ilya's Hollow Rod", 'unmake', '', { speed: 0.5 }),
  daystar: legendary('daystar', 'armor', 'leather', "Day Star's Embrace", 'redeem', blockNote(3), { block: 3, speed: -0.5 }),
  durance: legendary('durance', 'armor', 'mail', "Tal's Durance", 'bastion', blockNote(6), { block: 6, speed: 0.5 }),
  pilgrim: legendary('pilgrim', 'armor', 'cloth', 'Gray Shroud of the Pilgrim', 'forgive', '', { speed: -1 }),
  fenrir: legendary('fenrir', 'amulet', null, "Fenrir's Tooth", 'howl', '+20 max HP.', { maxHp: 20 }),
  silva: legendary('silva', 'ring', null, 'Signet of Saint Silva', 'waystep', '', { speed: -0.5 }),
  // Issued (M15): the plain amulet and ring every hero gets for free if they bring nothing better.
  tincharm: jewel('tincharm', 'amulet', 'Tin Charm', '○', 'Issued: nothing special.', { issued: true }),
  copperband: jewel('copperband', 'ring', 'Copper Band', '◦', 'Issued: nothing special.', { issued: true }),
};

/** Rares' own cards (M15). */
const RARE_CARDS: Partial<Record<ItemId, CardId>> = {
  misericorde: 'mercy', whisperblade: 'whispercut', bonebreaker: 'shatter', giantmaul: 'earthblow',
  twinned: 'doublehex', evergreen: 'bloom', hourglass: 'glass',
  drakehide: 'scaleward', shadowskin: 'fade', wardmail: 'runeward', bulwark: 'bulwark',
  gravecloth: 'liestill', softstep: 'slipaway', blinkcloth: 'blink', gossamer: 'veil',
  harefoot: 'luckybreak', fever: 'feverdream', quickblood: 'bloodrush', ashen: 'ashes',
};
for (const [id, c] of Object.entries(RARE_CARDS)) ITEMS[id as ItemId].card = c;

/** Card passives (M15) for the Uncommons and Rares that only had numbers. */
const PASSIVES: Partial<Record<ItemId, { stats: Partial<ItemDef>; text: string }>> = {
  stiletto: { stats: { poisonTurns: 1 }, text: 'Poison you place lasts 1 turn longer.' },
  kris: { stats: { poisonedBonus: 2 }, text: 'Your Strike cards deal +2 to Poisoned enemies.' },
  misericorde: { stats: { lowCrit: 0.25 }, text: 'Your hits crit (×2) on enemies below 25% HP.' },
  whisperblade: { stats: { venomCut: 1 }, text: 'Your Venom cards take 1s less.' },
  warhammer: { stats: { delayBonus: 1 }, text: '+1s on every Delay you deal.' },
  ironmaul: { stats: { hinderDmg: 2 }, text: 'Your Hinder cards deal +2 damage.' },
  bonebreaker: { stats: { delayBonus: 2 }, text: '+2s on every Delay you deal.' },
  giantmaul: { stats: { stunnedMult: 0.5 }, text: 'Stunned enemies take +50% from your hits.' },
  studded: { stats: { firstCardCut: 1 }, text: 'Your first card in each fight takes 1s less.' },
  drakehide: { stats: { dotMult: 0.5 }, text: 'Poison and Bleed on you deal half damage.' },
  shadowskin: { stats: { dodge: 0.1 }, text: 'Always 10% Dodge.' },
  hauberk: { stats: { guardShield: 1 }, text: 'Your Guard cards give +1 Shield.' },
  brigandine: { stats: { startShield: 3 }, text: 'You start every fight with 3 Shield.' },
  wardmail: { stats: { debuffResist: 1 }, text: 'Debuffs on you last 1 turn (or 2s) less.' },
  bulwark: { stats: { frontBlock: 2 }, text: '+2 Block while you stand nearest the enemy.' },
  hourglass: { stats: { tempo: -0.5 }, text: '' },
};
for (const [id, p] of Object.entries(PASSIVES)) {
  const def = ITEMS[id as ItemId];
  Object.assign(def, p.stats);
  if (p.text) def.desc += ` ${p.text}`;
}

/** Issued Gear (M15): each class's free weapon and armor; everyone gets the Tin Charm and the Copper Band. */
export const ISSUED_KIT: Record<ClassId, Record<GearSlot, ItemId>> = {
  warden: { weapon: 'cudgel', armor: 'ringmail', amulet: 'tincharm', ring: 'copperband' },
  cutthroat: { weapon: 'dirk', armor: 'jerkin', amulet: 'tincharm', ring: 'copperband' },
  lampbearer: { weapon: 'crook', armor: 'patchwork', amulet: 'tincharm', ring: 'copperband' },
  sorceress: { weapon: 'censer', armor: 'patchwork', amulet: 'tincharm', ring: 'copperband' },
  undertaker: { weapon: 'cudgel', armor: 'jerkin', amulet: 'tincharm', ring: 'copperband' },
  bellwright: { weapon: 'sledge', armor: 'ringmail', amulet: 'tincharm', ring: 'copperband' },
  zealot: { weapon: 'knife', armor: 'patchwork', amulet: 'tincharm', ring: 'copperband' },
  alchemist: { weapon: 'knife', armor: 'jerkin', amulet: 'tincharm', ring: 'copperband' },
};
/** Issued Gear: each piece worn adds this much Speed, whatever it would weigh if found (so going without is a little quicker). */
export const ISSUED_WEIGHT = 0.15;

/** An Issued piece's text: its own, but with the Speed it really costs (ISSUED_WEIGHT, whatever it would weigh if found). */
export function issuedDesc(item: ItemId): string {
  const def = ITEMS[item];
  const own = speedNote(def.speed ?? 0);
  const real = speedNote(ISSUED_WEIGHT);
  const card = ` ${gearCardNote(item)}`;
  if (own && def.desc.includes(own)) return def.desc.replace(own, real);
  // No Speed of its own: put the Issued weight before the card it adds.
  return def.desc.endsWith(card) ? `${def.desc.slice(0, -card.length)}${real}${card}` : `${def.desc}${real}`;
}

/** Commons and Uncommons share their kind's card; Rares and Legendaries bring their own. */
export function gearCard(item: ItemId): CardId {
  const def = ITEMS[item];
  if (def.legend) return def.legend;
  if (def.card) return def.card;
  const kind: CardKind = def.gearType ?? (def.kind === 'amulet' ? 'amulet' : 'ring');
  return TYPE_CARDS[kind][itemTier(item) >= 2 ? 1 : 0];
}

/** "Card: Stab · 2s · ⚔: 3 dmg." — what a piece of Gear adds to the deck, for its text. */
export function gearCardNote(item: ItemId): string {
  return `Card: ${cardText(gearCard(item))}`;
}

/** Every Legendary, in slot order (the Dead King's treasure holds one at random). */
export const LEGENDARY_IDS: readonly ItemId[] = ['alastor', 'earthsplitter', 'hollowrod', 'daystar', 'durance', 'pilgrim', 'fenrir', 'silva'];

/** Legendary Gear: a stat line (`text`), Speed, and the ability it gives. */
function legendary(id: ItemId, kind: GearSlot, gearType: GearType | null, name: string, legend: LegendId, text: string, stats: Partial<ItemDef>): ItemDef {
  const type = gearType ? GEAR_TYPE_NAMES[gearType] : kind === 'amulet' ? 'Amulet' : 'Ring';
  return {
    id, name, kind, glyph: gearType ? GLYPHS[gearType] : kind === 'amulet' ? '❂' : '⊛', target: 'self', combat: false, field: false, legend, ...stats,
    ...(gearType ? { gearType } : {}),
    desc: `Legendary ${type}: ${[text, speedNote(stats.speed ?? 0).trim(), legendNote(legend)].filter(Boolean).join(' ')}`,
  };
}

/** Gear that no longer exists (weapons and armor from before gear types, Lucky Coin): stashes and kits load it as this. */
export const OLD_GEAR_IDS: Record<string, ItemId> = {
  shortsword: 'dirk', hatchet: 'knife', mace: 'stiletto', spear: 'kris', runeblade: 'misericorde', emberaxe: 'misericorde',
  leathercoat: 'jerkin', chainshirt: 'studded', cuirass: 'drakehide',
  // Lucky Coin, removed 2026-10-11: loads as the other plain amulet bonus.
  coin: 'locket',
  // The Tonic went with Stress (2026-10-14): loads as a Torch.
  tonic: 'torch',
  // Legendaries renamed 2026-10-11 (user).
  nightfang: 'alastor', lethehide: 'daystar', halvard: 'durance', elowen: 'pilgrim', ashkar: 'silva',
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
  if (ITEMS[item].legend) return false;
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
    return staff + cloth + (d.dmgPct ?? 0) * 10 + (d.flatDmg ?? 0) * 0.5 + (d.block ?? 0) - (isArms(id) ? (d.speed ?? 0) * speedWeight : 0);
  };
  return value(item) - value(current);
}

/** rarity: 1 common · 2 uncommon · 3 rare. Better loot (tougher kills, vaults) leans toward rarer items. */
export const LOOT_TABLE: { item: ItemId; weight: number; rarity: 1 | 2 | 3 }[] = [
  // The Tonic's weight went to Torches and Bandages when Stress went (2026-10-14; was 7 / 4 / 3).
  { item: 'bandage', weight: 8, rarity: 1 },
  { item: 'torch', weight: 6, rarity: 1 },
  { item: 'firebomb', weight: 3, rarity: 2 },
  { item: 'salts', weight: 2, rarity: 2 },
  // Amulets and rings (user 2026-10-11): the cursed ones (they quicken you) are rare, the blessed uncommon.
  { item: 'locket', weight: 0.6, rarity: 2 },
  { item: 'ward', weight: 0.6, rarity: 2 },
  { item: 'ember', weight: 0.6, rarity: 2 },
  { item: 'catseye', weight: 0.6, rarity: 2 },
  { item: 'bloodstone', weight: 0.6, rarity: 2 },
  { item: 'thorns', weight: 0.6, rarity: 2 },
  { item: 'harefoot', weight: 0.5, rarity: 3 },
  { item: 'fever', weight: 0.5, rarity: 3 },
  { item: 'quickblood', weight: 0.5, rarity: 3 },
  { item: 'ashen', weight: 0.5, rarity: 3 },
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

/** An item's tier (its loot rarity): 1 common · 2 uncommon · 3 rare · 4 legendary. Relics count as rare. */
export type ItemTier = 1 | 2 | 3 | 4;
export function itemTier(item: ItemId): ItemTier {
  if (ITEMS[item].legend) return 4;
  if (item === 'relic') return 3;
  return (LOOT_TABLE.find((e) => e.item === item) ?? RESOURCE_TABLE.find((e) => e.item === item))?.rarity ?? 1;
}

/**
 * Where a card comes from, for its frame (user, 2026-10-13): 'class' for a class's own cards, otherwise the tier of the
 * Gear that brings it (a Common and an Uncommon share their kind's card; 0 is an empty slot's Fumble).
 */
export function cardSource(card: CardId): 'class' | ItemTier | 0 {
  if (Object.values(CLASS_CARDS).some((cards) => cards.includes(card))) return 'class';
  if (card === 'fumble') return 0;
  for (const pair of Object.values(TYPE_CARDS)) if (pair.includes(card)) return pair[0] === card ? 1 : 2;
  const item = (Object.keys(ITEMS) as ItemId[]).find((id) => ITEMS[id].card === card || ITEMS[id].legend === card);
  return item ? itemTier(item) : 3;
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

// Every piece of Gear says which card it puts in the deck (Legendaries already do).
for (const def of Object.values(ITEMS)) if (slotOf(def.id) && !def.legend) def.desc += ` ${gearCardNote(def.id)}`;
