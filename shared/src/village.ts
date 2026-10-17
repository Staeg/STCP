import { CLASSES, CLASS_IDS, type ClassId } from './content/classes';
import { CARDS, CLASS_CARDS, deckError, LEVEL_RULES, LEVELUP_CARDS, type CardId } from './content/cards';
import { GEAR_SLOTS, isGear, itemTier, ITEMS, pluralName, RESOURCE_IDS, slotOf, type GearSlot, type ItemId, type ResourceId } from './content/items';
import type { Rng } from './rng';
import { gearKind, type GearKind } from './content/forge';
import { EMERGENCIES, emergencyBans, type EmergencyId } from './content/emergencies';
import { REGALIA_RULES, SEASONED_HAND, SPECS, specFits, specsUnlocked, type ShardId, type SpecId } from './content/regalia';

/**
 * The Village (M12): every player keeps a roster of Characters, one per class for now (stored as a list so
 * there can be more later). Characters gain XP by surviving runs, learn a level-up card for each, and carry lasting injuries
 * home, which only the Village Elder can heal. Bots borrow Characters but leave no mark on them.
 */
export type Injury = 'minor' | 'major';

export interface Character {
  id: string;
  name: string;
  cls: ClassId;
  /** XP earned (0..LEVEL_RULES.maxLevel): one per run survived. Each is a level, once its card is learned. */
  xp: number;
  /** Runs survived in total, for the record. */
  survived: number;
  /** Level-up cards learned (user, 2026-10-17), in the order learned: the Character's level is how many. */
  learned: CardId[];
  /** The class cards in their deck: always LEVEL_RULES.deckSize, from their class's six and what they've learned. */
  deck: CardId[];
  /** The level-up cards on offer for their next level (rolled when the XP comes in; null when none is waiting). */
  offer: CardId[] | null;
  /** Their Specialization (bought in the Village once Shards unlock it; needs a level; for good). */
  spec?: SpecId | null;
  injuries: Injury[];
  /** The Elder blessed them (Journeyman Elder's Bless; user, 2026-10-14): Elder's Oil in their deck next run. */
  blessed?: boolean;
}

export const VILLAGE_RULES = {
  /** XP per run survived (each XP is a level, up to LEVEL_RULES.maxLevel). */
  xpPerRun: 1,
  /** A run where HP ever dropped below these fractions of max leaves a Minor / a Major Injury (the worse one only). */
  minorBelow: 0.5,
  majorBelow: 0.25,
  /** Max HP lost per injury (fractions of the class's base), and the most it can fall to. */
  minorHpLoss: 0.1,
  majorHpLoss: 0.2,
  hpFloor: 0.4,
  /** Speed (seconds) added per Major Injury. */
  majorSpeed: 0.5,
};

export const INJURY_NAMES: Record<Injury, string> = { minor: 'Minor Injury', major: 'Major Injury' };

/**
 * Buildings (user, 2026-10-11). Each has an Apprentice, a Journeyman and a Master level. A level costs Resources to
 * build and gold upkeep after every run (on top of the levels below it, and the Village's own `VILLAGE_UPKEEP`); it can
 * be torn down for free, Resources lost. A Village that can't pay its upkeep from its purse, after the run's haul, loses
 * levels at random until it can; if even the Village's own upkeep is more than the purse, it pays what it has and
 * loses 1 Wellbeing.
 * Every level adds one service, each usable once between runs.
 */
export type BuildingId = 'blacksmith' | 'seer' | 'elder';
export const BUILDING_IDS: readonly BuildingId[] = ['blacksmith', 'seer', 'elder'];
export const LEVEL_NAMES = ['None', 'Apprentice', 'Journeyman', 'Master'] as const;

/** One service per level: Blacksmith forge/reroll/upgrade, Seer sightings, Elder heal/bless/train. */
export type ServiceId = 'forge' | 'reroll' | 'upgrade' | 'seeConsumable' | 'seeResource' | 'seeGear' | 'heal' | 'bless' | 'train';

export interface BuildingLevel {
  /** Resources to build this level. */
  cost: Partial<Record<ResourceId, number>>;
  /** Gold paid after every run while it stands (added to the levels below). */
  upkeep: number;
  service: ServiceId;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  glyph: string;
  levels: [BuildingLevel, BuildingLevel, BuildingLevel];
}

/** Services: name, what it does, and what it costs on top (the Master's take a Relic). */
export const SERVICES: Record<ServiceId, { name: string; desc: string; relic?: true }> = {
  forge: { name: 'Forge', desc: 'Make a random common piece of Gear for the Stash.' },
  reroll: { name: 'Reforge', desc: 'Turn a piece of Gear in the Stash into another of the same type and rarity.' },
  upgrade: { name: 'Masterwork', desc: 'Better a piece of Gear in the Stash: the next piece up of its kind (a rarity up).', relic: true },
  seeConsumable: { name: 'Read the Smoke', desc: 'Pick a consumable: next run, every room where one lies at the start shows on your map.' },
  seeResource: { name: 'Read the Bones', desc: 'Pick a Resource: next run, every room where one lies at the start shows on your map.' },
  seeGear: { name: 'Read the Stars', desc: 'Pick a type of Gear: next run, every room where a piece lies at the start shows on your map.', relic: true },
  heal: { name: 'Mend', desc: 'Heal one Injury of a Character.' },
  bless: { name: 'Bless', desc: 'Bless a Character: next run, Elder’s Oil is in their deck (Burn, 1s: your light to full).' },
  train: { name: 'Teach', desc: '+1 XP for a Character.', relic: true },
};

/**
 * Upkeep is per level, so a Master Elder costs 75 + 100 + 125 = 300 gold a run (user, 2026-10-12: ×5). Building costs (user, 2026-10-11): Blacksmith
 * Effigies and Gems, Seer Effigies and Tomes, Elder Gems and Tomes; more of each per level, more of the commoner one.
 * Relics are never a building cost, only the Master services'.
 */
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  blacksmith: { id: 'blacksmith', name: 'Blacksmith', glyph: '⚒', levels: [
    { cost: { effigy: 3, gem: 1 }, upkeep: 50, service: 'forge' },
    { cost: { effigy: 5, gem: 2 }, upkeep: 75, service: 'reroll' },
    { cost: { effigy: 8, gem: 4 }, upkeep: 100, service: 'upgrade' },
  ] },
  seer: { id: 'seer', name: 'Seer', glyph: '◎', levels: [
    { cost: { effigy: 3, tome: 1 }, upkeep: 25, service: 'seeConsumable' },
    { cost: { effigy: 5, tome: 2 }, upkeep: 50, service: 'seeResource' },
    { cost: { effigy: 8, tome: 3 }, upkeep: 100, service: 'seeGear' },
  ] },
  elder: { id: 'elder', name: 'Elder', glyph: '⚕', levels: [
    { cost: { gem: 2, tome: 1 }, upkeep: 75, service: 'heal' },
    { cost: { gem: 4, tome: 2 }, upkeep: 100, service: 'bless' },
    { cost: { gem: 6, tome: 3 }, upkeep: 125, service: 'train' },
  ] },
};

/** Relics a Master's service costs. */
export const SERVICE_RELICS = 1;

export type Buildings = Record<BuildingId, number>;

export function noBuildings(): Buildings {
  return { blacksmith: 0, seer: 0, elder: 0 };
}

/** Gold every Village pays after each run, built up or not (user, 2026-10-12). */
export const VILLAGE_UPKEEP = 100;

/** Gold a Village pays after each run: its own upkeep plus what it has built. */
export function upkeepOf(b: Buildings): number {
  return VILLAGE_UPKEEP + BUILDING_IDS.reduce((s, id) => s + BUILDINGS[id].levels.slice(0, b[id]).reduce((t, l) => t + l.upkeep, 0), 0);
}

/** The building a service belongs to, and the level it needs. */
export function serviceHome(service: ServiceId): { building: BuildingId; level: number } {
  for (const id of BUILDING_IDS) {
    const i = BUILDINGS[id].levels.findIndex((l) => l.service === service);
    if (i >= 0) return { building: id, level: i + 1 };
  }
  throw new Error(`no such service ${service}`);
}

/** What the Seer will show you next run: one consumable, one Resource, one kind of Gear (each optional). */
export interface Sight {
  consumable?: ItemId;
  resource?: ResourceId;
  gear?: GearKind;
}

/** Does this item answer the Seer's sight? */
export function sightMatches(sight: Sight | undefined, item: ItemId): boolean {
  if (!sight) return false;
  return item === sight.consumable || item === sight.resource || (!!sight.gear && gearKind(item) === sight.gear);
}

/**
 * Rites (user 2026-10-10): spend 5 of a Resource (1 Relic) in the Village for an effect on your next run only. Effigy, Tome and
 * Gem change your own hero; a Relic changes the whole party's run.
 */
export const RITES: Record<ResourceId, { name: string; desc: string }> = {
  effigy: { name: 'Effigy Rite', desc: 'CR +1. Your hero deals +20% damage and has +20% max HP, and is 1s faster.' },
  gem: { name: 'Gem Rite', desc: 'CR −0.5. Your hero can’t bring, pick up or use consumables.' },
  tome: { name: 'Tome Rite', desc: 'Your hero deals −20% damage and has −20% max HP, but the gold and consumables they carry come home even if they die.' },
  relic: { name: 'Relic Rite', desc: 'The whole party’s run starts at Escalation 5: waves come for the exit at once, and the collapse is 3 minutes away. And the Dead King wakes as it begins: his procession sets out for the exit with his treasure.' },
};

/** Resources this Rite costs: 5, but a Relic Rite only 1. */
export function riteCost(r: ResourceId): number {
  return r === 'relic' ? KIT_RULES.relicRiteCost : KIT_RULES.riteCost;
}

export const KIT_RULES = {
  /** Resources a Rite costs (the Relic Rite: `relicRiteCost`, user 2026-10-11). */
  riteCost: 5,
  relicRiteCost: 1,
  /** Consumables a hero may bring from the Stash at no cost. */
  consumables: 2,
  /** CR added per level (tier) of every piece of Gear brought in; a Legendary adds `legendaryCr` (user, 2026-10-11). */
  crPerGearLevel: 0.1,
  legendaryCr: 1,
  effigyCr: 1,
  gemCr: -0.5,
  /** Effigy / Tome: damage dealt and max HP multipliers; Effigy's Speed change (seconds). */
  effigyMult: 1.2,
  effigySpeed: -1,
  tomeMult: 0.8,
  /** A Relic Rite starts the run at this Escalation. */
  relicEscalation: 5,
};

/** What a player takes from their Village into the next run: worn Gear, a few consumables, and Rites. */
export interface Kit {
  gear: Partial<Record<GearSlot, ItemId>>;
  consumables: ItemId[];
  rites: ResourceId[];
  /** Slots to go without (M15): no Issued Gear there either, so a little quicker, but a Fumble in the deck. */
  bare?: GearSlot[];
}

export function emptyKit(): Kit {
  return { gear: {}, consumables: [], rites: [] };
}

/** The CR one piece of Gear adds when brought in: 0.1 per level, or a whole CR for a Legendary. */
export function gearCr(item: ItemId): number {
  const tier = itemTier(item);
  return tier === 4 ? KIT_RULES.legendaryCr : tier * KIT_RULES.crPerGearLevel;
}

/** The CR a kit adds: 0.1 per Gear level (1 per Legendary), +1 for an Effigy Rite, −0.5 for a Gem Rite. */
export function kitCr(kit: Kit | undefined): number {
  if (!kit) return 0;
  let cr = Object.values(kit.gear).reduce((s, it) => s + (it ? gearCr(it) : 0), 0);
  if (kit.rites.includes('effigy')) cr += KIT_RULES.effigyCr;
  if (kit.rites.includes('gem')) cr += KIT_RULES.gemCr;
  return Math.round(cr * 100) / 100;
}

/** A hero's CR: a third per level (user, 2026-10-17: a level-3 Character adds 1), plus what their kit adds. */
export function heroCr(level: number | undefined, kit: Kit | undefined): number {
  return Math.round(((level ?? 0) / LEVEL_RULES.maxLevel + kitCr(kit)) * 100) / 100;
}

/**
 * The run's CR from the heroes' combined CR (never below 0): a fraction is the chance of the next CR up, so 2.7 is
 * a CR 3 run 70% of the time and CR 2 otherwise.
 */
export function rollCr(total: number, rng: Rng): number {
  const t = Math.max(0, Math.round(total * 100) / 100);
  const base = Math.floor(t);
  return base + (rng.chance(t - base) ? 1 : 0);
}

/** Why this kit can't be brought, given what's in the Stash and the Village's Emergency, or null. */
export function kitError(kit: Kit, stash: readonly ItemId[], resources: Record<ResourceId, number>, emergency: EmergencyId | null = null): string | null {
  const left = [...stash];
  const take = (it: ItemId) => {
    const i = left.indexOf(it);
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  };
  for (const [slot, it] of Object.entries(kit.gear) as [GearSlot, ItemId | undefined][]) {
    if (!it) continue;
    if (!isGear(it) || slotOf(it) !== slot) return `${ITEMS[it].name} isn't worn there.`;
    if (!take(it)) return `Your Stash has no ${ITEMS[it].name}.`;
  }
  if (Object.values(kit.gear).filter((it) => it && ITEMS[it].legend).length > 1) return 'Only one Legendary can be worn at a time.';
  for (const slot of kit.bare ?? []) {
    if (!GEAR_SLOTS.includes(slot)) return 'No such slot.';
    if (kit.gear[slot]) return 'You can’t both wear something there and go without.';
  }
  if (kit.consumables.length > KIT_RULES.consumables) return `At most ${KIT_RULES.consumables} consumables.`;
  if (kit.rites.includes('gem') && kit.consumables.length) return 'The Gem Rite forbids consumables: leave them at home.';
  // What the Emergency needs carried out can't be carried in.
  const banned = emergencyBans(emergency);
  for (const it of [...Object.values(kit.gear), ...kit.consumables]) {
    if (it && banned.includes(it)) return `${EMERGENCIES[emergency!].name}: what the Village needs carried out can't be carried in (${ITEMS[it].name}).`;
  }
  for (const it of kit.consumables) {
    if (ITEMS[it].kind !== 'consumable') return `${ITEMS[it].name} isn't a consumable.`;
    if (!take(it)) return `Your Stash has no more ${pluralName(it)}.`;
  }
  if (new Set(kit.rites).size !== kit.rites.length) return 'One of each Rite at most.';
  for (const r of kit.rites) {
    if (!RESOURCE_IDS.includes(r)) return 'No such Rite.';
    if ((resources[r] ?? 0) < riteCost(r)) return `${RITES[r].name} needs ${riteCost(r)} ${riteCost(r) === 1 ? ITEMS[r].name : pluralName(r)}.`;
  }
  return null;
}

/** What a hero brings into the dungeon from a Village. */
export interface Loadout {
  charId: string;
  charName: string;
  /** The player whose Village it is. */
  owner: string;
  /** The class cards in their deck (their Character's chosen six). */
  deck?: CardId[];
  /** Their level (cards learned): it counts for CR. */
  level?: number;
  /** Cards held in a fight, if not the usual 3 (Seasoned). */
  hand?: number;
  injuries: Injury[];
  /** Blessed by the Elder: Elder's Oil goes in their deck for this run. */
  blessed?: boolean;
  /** The Shards their player's Village already has: a player's hero may carry one Shard it lacks. Bots have none. */
  shards?: ShardId[];
  /** Gear, consumables and Rites taken from the player's Village Stash for this run. */
  kit?: Kit;
  /** The player's Emergency this run (M13); bots have none. */
  emergency?: EmergencyId | null;
  /** What the Village Seer shows this hero at the start. */
  sight?: Sight;
}

/** How a Character's run went, as far as the Village cares. */
export interface RunOutcome {
  escaped: boolean;
  /** Lowest HP reached, as a fraction of max HP. */
  lowestHp: number;
  /** Went down and nobody waived it (Pallbearer): one more Major Injury if they got out. */
  downedMajor: boolean;
}

const NAMES = [
  'Aldric', 'Brynn', 'Corvin', 'Dagny', 'Edda', 'Fenn', 'Gisla', 'Hob', 'Ilse', 'Jory', 'Kesta', 'Lorne', 'Maud', 'Nils',
  'Oswin', 'Perrin', 'Quill', 'Rowan', 'Sabine', 'Tamsin', 'Ulric', 'Vesna', 'Wynn', 'Yorick', 'Agnes', 'Bram', 'Cerys',
  'Dunstan', 'Elric', 'Freya', 'Garrick', 'Hesper', 'Ivo', 'Jutta', 'Kael', 'Liesl', 'Mabyn', 'Odo', 'Petra', 'Rurik',
];

/** A fresh recruit of a class, with a name nobody else in the Village has. */
export function newCharacter(id: string, cls: ClassId, rng: Rng, taken: string[]): Character {
  const free = NAMES.filter((n) => !taken.includes(n));
  const name = free.length ? rng.pick(free) : `${rng.pick(NAMES)} ${taken.length + 1}`;
  return { id, name, cls, xp: 0, survived: 0, learned: [], deck: [...CLASS_CARDS[cls]], offer: null, spec: null, injuries: [] };
}

/**
 * A Character saved before level-up cards (2026-10-17) gets the new fields. Talents are gone without a trace (user):
 * the XP a Talent was bought with is spent, while XP still short of one carries over as levels to come.
 */
export function migrateCharacter(c: Character & { talent?: string | null }, rng: Rng) {
  if (c.talent) c.xp = 0;
  delete c.talent;
  c.learned ??= [];
  c.deck ??= [...CLASS_CARDS[c.cls]];
  c.offer ??= null;
  c.xp = Math.min(LEVEL_RULES.maxLevel, c.xp);
  rollOffer(c, rng);
}

/** What a lobby card shows of a Character. */
export function lobbyCharacter(c: Character) {
  return { name: c.name, xp: c.xp, learned: [...c.learned], deck: [...c.deck], injuries: [...c.injuries], blessed: c.blessed, spec: c.spec ?? null };
}

/** Their level: how many level-up cards they've learned. */
export function levelOf(c: Pick<Character, 'learned'>): number {
  return c.learned.length;
}

/** No injuries: fit to go down. */
export function isHealthy(c: { injuries: Injury[] }): boolean {
  return c.injuries.length === 0;
}

/** Has XP for a level whose card isn't learned yet: a level-up is waiting in the Village. */
export function levelPending(c: Pick<Character, 'xp' | 'learned'>): boolean {
  return c.xp > c.learned.length;
}

/** Deal the next level's offer (the cards of their class they don't know yet, up to LEVEL_RULES.offer), if one is due. */
export function rollOffer(c: Character, rng: Rng) {
  if (!levelPending(c)) {
    c.offer = null;
    return;
  }
  if (c.offer?.length) return;
  const left = LEVELUP_CARDS[c.cls].filter((x) => !c.learned.includes(x));
  c.offer = rng.shuffle(left).slice(0, LEVEL_RULES.offer);
}

/** Learn a card on offer: it joins the cards they can swap into their deck. Returns an error, or null. */
export function learnCard(c: Character, card: CardId, rng: Rng): string | null {
  if (!levelPending(c) || !c.offer) return `${c.name} has no level-up waiting.`;
  if (!c.offer.includes(card)) return `${CARDS[card]?.name ?? 'That card'} isn't on offer.`;
  c.learned.push(card);
  c.offer = null;
  rollOffer(c, rng);
  return null;
}

/** Set the class cards in their deck. Returns an error, or null. */
export function setDeck(c: Character, deck: CardId[]): string | null {
  const err = deckError(c.cls, deck, c.learned);
  if (err) return err;
  c.deck = [...deck];
  return null;
}

/** Max HP with these injuries (never below hpFloor of the class's base). */
export function injuredMaxHp(cls: ClassId, injuries: Injury[]): number {
  const base = CLASSES[cls].maxHp;
  const loss = injuries.reduce((s, i) => s + (i === 'major' ? VILLAGE_RULES.majorHpLoss : VILLAGE_RULES.minorHpLoss), 0);
  return Math.max(Math.ceil(base * VILLAGE_RULES.hpFloor), Math.round(base * (1 - loss)));
}

export function loadoutOf(owner: string, c: Character): Loadout {
  return {
    charId: c.id, charName: c.name, owner, deck: [...c.deck], level: levelOf(c), injuries: [...c.injuries],
    ...(c.spec === 'seasoned' ? { hand: SEASONED_HAND } : {}), ...(c.blessed ? { blessed: true } : {}),
  };
}

/**
 * Apply a finished run to a Character. A death wipes them out: the caller replaces them with a recruit.
 * Returns the story for the results screen.
 */
export function applyRun(c: Character, out: RunOutcome, rng: Rng): { died: boolean; lines: string[] } {
  // The Elder's blessing was for this run, used or not.
  delete c.blessed;
  if (!out.escaped) return { died: true, lines: [`${c.name} the ${CLASSES[c.cls].name} did not come back.`] };
  const lines: string[] = [];
  c.survived++;
  if (c.xp < LEVEL_RULES.maxLevel) {
    c.xp = Math.min(LEVEL_RULES.maxLevel, c.xp + VILLAGE_RULES.xpPerRun);
    rollOffer(c, rng);
    lines.push(`${c.name} gained XP (${c.xp}/${LEVEL_RULES.maxLevel}): a level-up waits in the Village.`);
  }
  const hurt: Injury[] = [];
  if (out.lowestHp < VILLAGE_RULES.majorBelow) hurt.push('major');
  else if (out.lowestHp < VILLAGE_RULES.minorBelow) hurt.push('minor');
  if (out.downedMajor) hurt.push('major');
  c.injuries.push(...hurt);
  for (const i of hurt) lines.push(`${c.name} carries home a ${INJURY_NAMES[i]}.`);
  return { died: false, lines };
}

/** Give a Character a Spec this Village's Shards unlock (needs a level; for good). Returns an error, or null. */
export function chooseSpec(c: Character, spec: SpecId, shards: readonly ShardId[], purse: number): string | null {
  if (!SPECS[spec]) return 'No such Specialization.';
  if (!specsUnlocked(shards).includes(spec)) return `${SPECS[spec].name} isn't unlocked: bring home its Shard first.`;
  if (!levelOf(c)) return `${c.name} needs a level first.`;
  if (c.spec) return `${c.name} is already ${SPECS[c.spec].name}.`;
  if (!specFits(spec, c.cls)) return `A ${CLASSES[c.cls].name} can't be ${SPECS[spec].name}.`;
  if (purse < REGALIA_RULES.specCost) return `${SPECS[spec].name} costs ${REGALIA_RULES.specCost} gold; you have ${purse}.`;
  c.spec = spec;
  return null;
}

/** Characters in a fresh Village: one of every class. */
export function foundVillage(rng: Rng, nextId: () => string): Character[] {
  const out: Character[] = [];
  for (const cls of CLASS_IDS) out.push(newCharacter(nextId(), cls, rng, out.map((c) => c.name)));
  return out;
}
