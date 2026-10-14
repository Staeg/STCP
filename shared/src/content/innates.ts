/**
 * Numbers for the classes' Innates (each class's perk; see `ClassDef.innate`) and field abilities (M16). The cards'
 * own numbers live in CARD_RULES (content/cards.ts), since M15 replaced the three fixed abilities with decks.
 */
export const CLASS_RULES = {
  /** Lampbearer: their own light fades at this fraction of the usual rate. */
  lampLightDrain: 0.5,
  /** Warden's Stalwart (user, 2026-10-14; was 20% less damage at the front): the share of his Shield he keeps when a fight ends. */
  stalwartKeep: 0.5,
  /** Toll (out of combat, once a run; user, 2026-10-12, was a 4-turn cooldown): allies see you live for this long (seconds). */
  tollReveal: 10,
  /** Toll: monsters outside fights stop for this long (seconds); those fighting lose their next turn. Great Bell's until 2026-10-11. */
  tollDaze: 7,
  /** Zealot's Fervour: +1% damage per point of light below full (user, 2026-10-14; was +1.5% per stress). */
  zealotDmgPerDark: 0.01,
};

/**
 * Field abilities (M16, user 2026-10-14): one per class (the Bellwright also keeps the Toll), used out of a fight as
 * that turn. Cooldowns are in seconds and run all the time; the stronger the numbers, the longer the cooldown.
 */
export const FIELD_RULES = {
  /** Warden's Form Up: every hero in the room +5 Shield, but it never lifts anyone past 15 (user). */
  formUpShield: 5,
  formUpCap: 15,
  formUpCooldown: 30,
  /** Lampbearer's Rekindle: every hero in the room +25 light. */
  rekindleLight: 25,
  rekindleCooldown: 60,
  /** Bellwright's Ring In: Clang stacks, ready for the next fight. */
  ringInClang: 3,
  ringInCooldown: 30,
  /** Zealot's Flagellate (was a card): lose HP and up to this much light; the others here share the light lost. */
  flagellateHp: 4,
  flagellateLight: 25,
  flagellateCooldown: 15,
  /** Alchemist's Brew (was the Brewer innate, every 45s by itself): a random consumable into the pack. */
  brewCooldown: 45,
};
