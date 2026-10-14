import { CARD_RULES, CARDS, CLASS_CARDS, type CardId } from '../content/cards';
import { GEAR_SLOTS, gearCard, type GearSlot } from '../content/items';
import { hasTalent, TALENT_RULES } from '../content/talents';
import type { Rng } from '../rng';
import type { Hero } from './world';

/**
 * A hero's deck in a fight (M15). It's dealt when they join one (from their class cards and what they wear, less
 * anything burned this run), and gathered up again when they leave it, so every fight starts from a full shuffle.
 */
export interface Deck {
  draw: CardId[];
  /** In the order they were drawn: the leftmost is what an undecided hero plays. */
  hand: CardId[];
  discard: CardId[];
  /** The last card played in this fight (Turn the Glass). */
  last: CardId | null;
}

/** The card a worn slot adds to the deck, or Fumble for an empty one. */
export function slotCard(h: Pick<Hero, GearSlot>, slot: GearSlot): CardId {
  const item = h[slot];
  return item ? gearCard(item) : 'fumble';
}

/**
 * Every card this hero's deck holds right now: class cards first, then one per Gear slot, then any extra for this run
 * (the Elder's Oil). Burned cards included.
 */
export function deckList(h: Pick<Hero, 'cls' | GearSlot> & { bonusCards?: readonly CardId[] }): CardId[] {
  return [...CLASS_CARDS[h.cls], ...GEAR_SLOTS.map((s) => slotCard(h, s)), ...(h.bonusCards ?? [])];
}

/** The cards that go into a fight: the deck less one copy of each card burned this run. */
export function liveCards(h: Pick<Hero, 'cls' | 'burned' | GearSlot> & { bonusCards?: readonly CardId[] }): CardId[] {
  const out = deckList(h);
  for (const b of h.burned) {
    const i = out.indexOf(b);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

export function handSize(h: Pick<Hero, 'talents'>): number {
  return hasTalent(h, 'sleightOfHand') || hasTalent(h, 'grimoire') ? TALENT_RULES.bigHand : CARD_RULES.handSize;
}

/** Cards some Talents put in the opening hand. */
function openingCards(h: Pick<Hero, 'talents'>): CardId[] {
  const out: CardId[] = [];
  if (hasTalent(h, 'unbrokenLine')) out.push('cover', 'bash');
  if (hasTalent(h, 'prepared')) out.push('elixir');
  return out;
}

/** Deal a fresh deck for a fight: shuffle what's left of it and draw a hand. */
export function dealDeck(h: Hero, rng: Rng): Deck {
  const draw = rng.shuffle(liveCards(h));
  const deck: Deck = { draw, hand: [], discard: [], last: null };
  for (const c of openingCards(h)) {
    const i = deck.draw.indexOf(c);
    if (i >= 0 && deck.hand.length < handSize(h)) deck.hand.push(...deck.draw.splice(i, 1));
  }
  refill(h, deck, rng);
  h.deck = deck;
  return deck;
}

/** Draw until the hand is full again; an empty draw pile takes the discard, shuffled. */
export function refill(h: Pick<Hero, 'talents'>, deck: Deck, rng: Rng) {
  while (deck.hand.length < handSize(h)) {
    if (deck.draw.length === 0) {
      if (deck.discard.length === 0) return;
      deck.draw = rng.shuffle(deck.discard);
      deck.discard = [];
    }
    deck.hand.push(deck.draw.shift()!);
  }
}

/** Playing a card, step one: it leaves the hand (before its effect). Returns false if it wasn't there. */
export function takeFromHand(h: Hero, card: CardId): boolean {
  const deck = h.deck;
  const i = deck ? deck.hand.indexOf(card) : -1;
  if (!deck || i < 0) return false;
  deck.hand.splice(i, 1);
  return true;
}

/**
 * Playing a card, step two (after its effect): it goes to the discard, or is burned for the run (Scourged puts
 * Flagellate straight back in hand), and the hand fills up again.
 */
export function settleCard(h: Hero, card: CardId, rng: Rng) {
  const deck = h.deck;
  if (!deck) {
    if (CARDS[card].burn) h.burned.push(card);
    return;
  }
  deck.last = card;
  if (CARDS[card].burn) h.burned.push(card);
  else deck.discard.push(card);
  refill(h, deck, rng);
}

/** Discard the first `n` cards of the hand (`n` = all of it by default) and draw again. */
export function cycle(h: Hero, rng: Rng, n?: number) {
  const deck = h.deck;
  if (!deck) return;
  const out = deck.hand.splice(0, n ?? deck.hand.length);
  deck.discard.push(...out);
  refill(h, deck, rng);
}

/** Turn the Glass: the last card played in this fight comes back from the discard into the hand. */
export function returnLast(h: Hero): CardId | null {
  const deck = h.deck;
  const last = deck?.last;
  if (!deck || !last) return null;
  const i = deck.discard.lastIndexOf(last);
  if (i < 0) return null;
  deck.discard.splice(i, 1);
  deck.hand.push(last);
  return last;
}

/** The fight is over for this hero: their cards are gathered up (burned ones stay burned). */
export function gatherDeck(h: Hero) {
  h.deck = null;
}

/** A Loom: every card burned this run comes back. Returns how many. */
export function unburn(h: Hero): number {
  const n = h.burned.length;
  h.burned = [];
  return n;
}
