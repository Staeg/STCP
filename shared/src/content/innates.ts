/**
 * Numbers for the classes' Innates (each class's perk; see `ClassDef.innate`). The cards' own numbers live in
 * CARD_RULES (content/cards.ts), since M15 replaced the three fixed abilities with decks.
 */
export const CLASS_RULES = {
  /** Lampbearer: their own light fades at this fraction of the usual rate. */
  lampLightDrain: 0.5,
  /** Sorceress: Speed while Insane (user, 2026-10-10: rewards risky play). */
  sorceressInsaneSpeed: -1, // -1.5 until 2026-10-11 (user)
  /** Undertaker: stress an ally's death takes away (instead of adding STRESS.allyDeath). */
  morticianRelief: 7, // 10
  /** Toll (out of combat, once a run; user, 2026-10-12, was a 4-turn cooldown): allies see you live for this long (seconds). */
  tollReveal: 10,
  /** Toll: monsters outside fights stop for this long (seconds); those fighting lose their next turn. Great Bell's until 2026-10-11. */
  tollDaze: 7,
  /** Zealot: +1.5% damage per stress point. */
  zealotDmgPerStress: 0.015,
  /** Alchemist: a fresh consumable this often (seconds). */
  brewEvery: 45,
};
