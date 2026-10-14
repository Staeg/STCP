import { CARDS } from './cards';
import type { ClassId } from './classes';

/**
 * Talents (M12; rewritten around cards in M15, user 2026-10-13): a Character who has survived enough runs picks one
 * of their class's two. Each changes how their deck plays; none adds a card. Numbers live in TALENT_RULES.
 */
export type TalentId =
  | 'shieldwall' | 'unbrokenLine'
  | 'sleightOfHand' | 'openingAct'
  | 'steadyHands' | 'undyingFlame'
  | 'bloodPrice' | 'grimoire'
  | 'gravedigger' | 'restlessDead'
  | 'resounding' | 'carillon'
  | 'scourged' | 'penitent'
  | 'volatile' | 'prepared';

export interface TalentDef {
  id: TalentId;
  cls: ClassId;
  name: string;
  desc: string;
}

export const TALENT_RULES = {
  /** Shieldwall: every Guard card the Warden plays Delays the nearest enemy this long. */
  shieldwallDelay: 1,
  /** Sleight of Hand, Grimoire: hand size. */
  bigHand: 4,
  /** Opening Act: the first action comes after this fraction of Speed, and the first card takes this long. */
  openingFraction: 0.5,
  openingCard: 1,
  /** Steady Hands: Mend and Sanctuary take this much less. */
  steadyCut: 1,
  /** Blood Price: the Sorceress pays the whole Blood Pact herself, this many times over. */
  bloodPriceMult: 2,
  /** Gravedigger: Corpses lying ready when the Undertaker joins a fight. */
  gravediggerCorpses: 1,
  /** Carillon: after each Hinder card, the Bellwright's next card takes this much less. */
  carillonCut: 1,
  /** Scourged: Flagellate's cooldown is multiplied by this (and it costs no HP). */
  scourgedCooldown: 0.5,
  /** Prepared: items in a fight take this long. */
  preparedItemTime: 1,
};

export const TALENTS: Record<TalentId, TalentDef> = {
  shieldwall: { id: 'shieldwall', cls: 'warden', name: 'Shieldwall',
    desc: `Every Guard card you play Delays the nearest enemy ${TALENT_RULES.shieldwallDelay}s.` },
  unbrokenLine: { id: 'unbrokenLine', cls: 'warden', name: 'Unbroken Line',
    desc: `Every fight starts with ${CARDS.cover.name} and ${CARDS.bash.name} in your hand.` },
  sleightOfHand: { id: 'sleightOfHand', cls: 'cutthroat', name: 'Sleight of Hand',
    desc: `You hold ${TALENT_RULES.bigHand} cards instead of 3.` },
  openingAct: { id: 'openingAct', cls: 'cutthroat', name: 'Opening Act',
    desc: `Your first action in every fight comes after half your Speed, and your first card takes ${TALENT_RULES.openingCard}s.` },
  steadyHands: { id: 'steadyHands', cls: 'lampbearer', name: 'Steady Hands',
    desc: `${CARDS.mend.name} and ${CARDS.sanctuary.name} take ${TALENT_RULES.steadyCut}s less.` },
  undyingFlame: { id: 'undyingFlame', cls: 'lampbearer', name: 'Undying Flame',
    desc: `${CARDS.dawn.name} comes back to your deck after any fight that ends with every ally still standing.` },
  bloodPrice: { id: 'bloodPrice', cls: 'sorceress', name: 'Blood Price',
    desc: `${CARDS.pact.name} costs your allies nothing: you pay it ${TALENT_RULES.bloodPriceMult} times over.` },
  grimoire: { id: 'grimoire', cls: 'sorceress', name: 'Grimoire',
    desc: `You hold ${TALENT_RULES.bigHand} cards instead of 3.` },
  gravedigger: { id: 'gravedigger', cls: 'undertaker', name: 'Gravedigger',
    desc: `Every fight you join has ${TALENT_RULES.gravediggerCorpses} Corpse more lying ready.` },
  restlessDead: { id: 'restlessDead', cls: 'undertaker', name: 'Restless Dead',
    desc: `What you ${CARDS.raise.name} never crumbles, and follows you out of the fight into the next one.` },
  resounding: { id: 'resounding', cls: 'bellwright', name: 'Resounding',
    desc: `${CARDS.echo.name} repeats your last card at full power.` },
  carillon: { id: 'carillon', cls: 'bellwright', name: 'Carillon',
    desc: `After each Hinder card you play, your next card takes ${TALENT_RULES.carillonCut}s less.` },
  scourged: { id: 'scourged', cls: 'zealot', name: 'Scourged',
    desc: `Flagellate costs you no HP, and its cooldown is halved.` },
  penitent: { id: 'penitent', cls: 'zealot', name: 'Penitent',
    desc: `${CARDS.absolution.name} gives you back only half the light it turns into damage, so the dark keeps feeding you.` },
  volatile: { id: 'volatile', cls: 'alchemist', name: 'Volatile',
    desc: `Using an item in a fight also sets off a free ${CARDS.catalyst.name}.` },
  prepared: { id: 'prepared', cls: 'alchemist', name: 'Prepared',
    desc: `Every fight starts with ${CARDS.elixir.name} in your hand, and your items take ${TALENT_RULES.preparedItemTime}s.` },
};

export const TALENT_IDS = Object.keys(TALENTS) as TalentId[];

/**
 * Talents from before the cards (M15): a Character who had one has the same class's new one in its place (one kept
 * its name; the other takes the remaining one).
 */
export const OLD_TALENT_IDS: Record<string, TalentId> = {
  ironOath: 'shieldwall', unyielding: 'unbrokenLine',
  ghostStep: 'sleightOfHand',
  everflame: 'steadyHands', triage: 'undyingFlame',
  sanguine: 'bloodPrice', evilEye: 'grimoire',
  pallbearer: 'gravedigger',
  greatBell: 'resounding', resonance: 'carillon',
  martyr: 'scourged',
  quickHands: 'prepared',
};

/** A Talent id as saved before the cards, read as today's. */
export function migrateTalentId(id: string): TalentId {
  return OLD_TALENT_IDS[id] ?? (id as TalentId);
}

/** The two talents a Character of this class chooses between. */
export function talentsFor(cls: ClassId): [TalentId, TalentId] {
  return TALENT_IDS.filter((t) => TALENTS[t].cls === cls) as [TalentId, TalentId];
}

/** Does this hero (or Character) have this Talent? A Seasoned one has both of their class's. */
export function hasTalent(h: { talents: readonly TalentId[] } | null | undefined, talent: TalentId): boolean {
  return !!h && h.talents.includes(talent);
}
