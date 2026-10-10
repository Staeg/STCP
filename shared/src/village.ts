import { CLASSES, CLASS_IDS, type ClassId } from './content/classes';
import { AFFLICTIONS, type AfflictionId } from './content/events';
import { TALENTS, talentsFor, type TalentId } from './content/talents';
import { isGear, itemTier, ITEMS, pluralName, RESOURCE_IDS, slotOf, type GearSlot, type ItemId, type ResourceId } from './content/items';
import type { Rng } from './rng';

/**
 * The Village (M12): every player keeps a roster of Characters, one per class for now (stored as a list so
 * there can be more later). Characters gain XP by surviving runs, pick a Talent, and carry lasting injuries
 * and afflictions home, which cost gold to treat. Bots borrow Characters but leave no mark on them.
 */
export type Injury = 'minor' | 'major';

export interface Character {
  id: string;
  name: string;
  cls: ClassId;
  /** Survived runs since the last level (0..xpForTalent). */
  xp: number;
  /** Runs survived in total, for the record. */
  survived: number;
  talent: TalentId | null;
  injuries: Injury[];
  /** Broken by stress in an earlier run, and not yet treated. */
  affliction: AfflictionId | null;
}

export const VILLAGE_RULES = {
  /** XP per run survived, and the XP that earns a Talent. */
  xpPerRun: 1,
  xpForTalent: 2,
  /** A run where HP ever dropped below these fractions of max leaves a Minor / a Major Injury (the worse one only). */
  minorBelow: 0.5,
  majorBelow: 0.25,
  /** Max HP lost per injury (fractions of the class's base), and the most it can fall to. */
  minorHpLoss: 0.1,
  majorHpLoss: 0.2,
  hpFloor: 0.4,
  /** Speed (seconds) added per Major Injury. */
  majorSpeed: 0.5,
  /** Gold to treat each thing in the Village. */
  cost: { minor: 50, major: 100, affliction: 100 } as Record<Injury | 'affliction', number>,
};

export const INJURY_NAMES: Record<Injury, string> = { minor: 'Minor Injury', major: 'Major Injury' };

/**
 * Rites (user 2026-10-10): spend 5 of a Resource in the Village for an effect on your next run only. Effigy, Tome and
 * Gem change your own hero; a Relic changes the whole party's run.
 */
export const RITES: Record<ResourceId, { name: string; desc: string }> = {
  effigy: { name: 'Effigy Rite', desc: 'CR +1. Your hero deals +20% damage and has +20% max HP, and is 1s faster.' },
  gem: { name: 'Gem Rite', desc: 'CR −0.5. Your hero can’t bring, pick up or use consumables.' },
  tome: { name: 'Tome Rite', desc: 'Your hero deals −20% damage and has −20% max HP, but the gold they carry comes home even if they die.' },
  relic: { name: 'Relic Rite', desc: 'The whole party’s run starts at Escalation 5: the exit is open at once, and the collapse is 3 minutes away.' },
};

export const KIT_RULES = {
  /** Resources a Rite costs. */
  riteCost: 5,
  /** Consumables a hero may bring from the Stash at no cost. */
  consumables: 2,
  /** CR added per level (tier) of every piece of Gear brought in. */
  crPerGearLevel: 0.1,
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
}

export function emptyKit(): Kit {
  return { gear: {}, consumables: [], rites: [] };
}

/** The CR a kit adds: 0.1 per Gear level, +1 for an Effigy Rite, −0.5 for a Gem Rite. */
export function kitCr(kit: Kit | undefined): number {
  if (!kit) return 0;
  let cr = Object.values(kit.gear).reduce((s, it) => s + (it ? itemTier(it) * KIT_RULES.crPerGearLevel : 0), 0);
  if (kit.rites.includes('effigy')) cr += KIT_RULES.effigyCr;
  if (kit.rites.includes('gem')) cr += KIT_RULES.gemCr;
  return Math.round(cr * 100) / 100;
}

/** A hero's CR: 1 for a Talent, plus what their kit adds. */
export function heroCr(talent: TalentId | null | undefined, kit: Kit | undefined): number {
  return (talent ? 1 : 0) + kitCr(kit);
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

/** Why this kit can't be brought, given what's in the Stash, or null. */
export function kitError(kit: Kit, stash: readonly ItemId[], resources: Record<ResourceId, number>): string | null {
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
  if (kit.consumables.length > KIT_RULES.consumables) return `At most ${KIT_RULES.consumables} consumables.`;
  if (kit.rites.includes('gem') && kit.consumables.length) return 'The Gem Rite forbids consumables: leave them at home.';
  for (const it of kit.consumables) {
    if (ITEMS[it].kind !== 'consumable') return `${ITEMS[it].name} isn't a consumable.`;
    if (!take(it)) return `Your Stash has no more ${pluralName(it)}.`;
  }
  if (new Set(kit.rites).size !== kit.rites.length) return 'One of each Rite at most.';
  for (const r of kit.rites) {
    if (!RESOURCE_IDS.includes(r)) return 'No such Rite.';
    if ((resources[r] ?? 0) < KIT_RULES.riteCost) return `${RITES[r].name} needs ${KIT_RULES.riteCost} ${pluralName(r)}.`;
  }
  return null;
}

/** What a hero brings into the dungeon from a Village. */
export interface Loadout {
  charId: string;
  charName: string;
  /** The player whose Village it is. */
  owner: string;
  talent: TalentId | null;
  injuries: Injury[];
  affliction: AfflictionId | null;
  /** Gear, consumables and Rites taken from the player's Village Stash for this run. */
  kit?: Kit;
}

/** How a Character's run went, as far as the Village cares. */
export interface RunOutcome {
  escaped: boolean;
  /** Lowest HP reached, as a fraction of max HP. */
  lowestHp: number;
  /** Went down and nobody waived it (Pallbearer): one more Major Injury if they got out. */
  downedMajor: boolean;
  affliction: AfflictionId | null;
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
  return { id, name, cls, xp: 0, survived: 0, talent: null, injuries: [], affliction: null };
}

/** No injuries, no affliction: fit to go down. */
export function isHealthy(c: { injuries: Injury[]; affliction: AfflictionId | null }): boolean {
  return c.injuries.length === 0 && !c.affliction;
}

/** Earned a Talent but hasn't picked one yet. */
export function talentPending(c: Character): boolean {
  return !c.talent && c.xp >= VILLAGE_RULES.xpForTalent;
}

/** Max HP with these injuries (never below hpFloor of the class's base). */
export function injuredMaxHp(cls: ClassId, injuries: Injury[]): number {
  const base = CLASSES[cls].maxHp;
  const loss = injuries.reduce((s, i) => s + (i === 'major' ? VILLAGE_RULES.majorHpLoss : VILLAGE_RULES.minorHpLoss), 0);
  return Math.max(Math.ceil(base * VILLAGE_RULES.hpFloor), Math.round(base * (1 - loss)));
}

export function loadoutOf(owner: string, c: Character): Loadout {
  return { charId: c.id, charName: c.name, owner, talent: c.talent, injuries: [...c.injuries], affliction: c.affliction };
}

/**
 * Apply a finished run to a Character. A death wipes them out: the caller replaces them with a recruit.
 * Returns the story for the results screen.
 */
export function applyRun(c: Character, out: RunOutcome): { died: boolean; lines: string[] } {
  if (!out.escaped) return { died: true, lines: [`${c.name} the ${CLASSES[c.cls].name} did not come back.`] };
  const lines: string[] = [];
  c.survived++;
  if (!c.talent) {
    c.xp = Math.min(VILLAGE_RULES.xpForTalent, c.xp + VILLAGE_RULES.xpPerRun);
    lines.push(talentPending(c)
      ? `${c.name} gained XP (${c.xp}/${VILLAGE_RULES.xpForTalent}) and can choose a Talent in the Village.`
      : `${c.name} gained XP (${c.xp}/${VILLAGE_RULES.xpForTalent}).`);
  }
  const hurt: Injury[] = [];
  if (out.lowestHp < VILLAGE_RULES.majorBelow) hurt.push('major');
  else if (out.lowestHp < VILLAGE_RULES.minorBelow) hurt.push('minor');
  if (out.downedMajor) hurt.push('major');
  c.injuries.push(...hurt);
  for (const i of hurt) lines.push(`${c.name} carries home a ${INJURY_NAMES[i]}.`);
  if (out.affliction && out.affliction !== c.affliction) lines.push(`${c.name} is still ${AFFLICTIONS[out.affliction].name}.`);
  c.affliction = out.affliction;
  return { died: false, lines };
}

/** Pick a Talent (only once earned, and only one of the class's). Returns an error, or null. */
export function chooseTalent(c: Character, talent: TalentId): string | null {
  if (c.talent) return `${c.name} already has a Talent.`;
  if (!talentPending(c)) return `${c.name} needs ${VILLAGE_RULES.xpForTalent} XP first.`;
  if (!talentsFor(c.cls).includes(talent)) return `${TALENTS[talent].name} is not a ${CLASSES[c.cls].name} Talent.`;
  c.talent = talent;
  return null;
}

/** Characters in a fresh Village: one of every class. */
export function foundVillage(rng: Rng, nextId: () => string): Character[] {
  const out: Character[] = [];
  for (const cls of CLASS_IDS) out.push(newCharacter(nextId(), cls, rng, out.map((c) => c.name)));
  return out;
}
