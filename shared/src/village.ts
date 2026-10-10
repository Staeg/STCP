import { CLASSES, CLASS_IDS, type ClassId } from './content/classes';
import { AFFLICTIONS, type AfflictionId } from './content/events';
import { TALENTS, talentsFor, type TalentId } from './content/talents';
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

/** What a hero brings into the dungeon from a Village. */
export interface Loadout {
  charId: string;
  charName: string;
  /** The player whose Village it is. */
  owner: string;
  talent: TalentId | null;
  injuries: Injury[];
  affliction: AfflictionId | null;
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
