/**
 * Numbers for the classes' Innates (each class's perk; see `ClassDef.innate`). The cards' own numbers live in
 * CARD_RULES (content/cards.ts), since M15 replaced the three fixed abilities with decks.
 */
export const CLASS_RULES = {
  /** Lampbearer: their own light fades at this fraction of the usual rate. */
  lampLightDrain: 0.5,

  /** Toll (out of combat, once a run; user, 2026-10-12, was a 4-turn cooldown): allies see you live for this long (seconds). */
  tollReveal: 10,
  /** Toll: monsters outside fights stop for this long (seconds); those fighting lose their next turn. Great Bell's until 2026-10-11. */
  tollDaze: 7,
  /** Zealot's Fervour: +1% damage per point of light below full (user, 2026-10-14; was +1.5% per stress). */
  zealotDmgPerDark: 0.01,
  /** Alchemist: a fresh consumable this often (seconds). */
  brewEvery: 45,
};
