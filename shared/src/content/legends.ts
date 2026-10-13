import { cardText } from './cards';

/**
 * Legendary Gear (user, 2026-10-11): the fourth item tier, above Rare. Only the Dead King's treasure holds one. Each
 * piece adds to its wearer's stats like any other and puts its own card in their deck (M15: the card has the
 * Legendary's name; combat only). Brought in from the Village, a Legendary adds a whole CR (`KIT_RULES.legendaryCr`).
 */
export type LegendId = 'promise' | 'quake' | 'unmake' | 'redeem' | 'bastion' | 'forgive' | 'howl' | 'waystep';

export const LEGEND_IDS: readonly LegendId[] = ['promise', 'quake', 'unmake', 'redeem', 'bastion', 'forgive', 'howl', 'waystep'];

export const LEGEND_RULES = {
  /** Howl: wolves at your side at most. */
  maxWolves: 4,
};

/** Bosses are T4 (only the Dead King): Promise never takes one. */
export const BOSS_TIER = 4;

/** "Card: Promise · 1s · ⚔ · Burn: …" for item text. */
export function legendNote(id: LegendId): string {
  return `Card: ${cardText(id)}`;
}
