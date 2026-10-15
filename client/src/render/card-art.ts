import { CARD_ART, cardSource, CARDS, CLASSES, FIELD_ART, SCHOOLS, type CardId, type ClassId, type FieldSkill } from '@stcp/shared';
import { CARD_PALETTE, MARK_ROWS, MOTIF_ROWS } from './card-art-data';
import { PALETTE, SPRITES } from './sprite-data';

/** A card picture's size in art pixels (shown at 2×): a 24×24 picture inside a 1px frame. */
export const CARD_ART_SIZE = 26;

/** Frame colours: a class card wears its class's colour; Gear cards their tier's (as item names are coloured), riveted. */
const TIER_FRAME: Record<number, string> = { 0: '#5a5a62', 1: '#cfc9bd', 2: '#5aa8ff', 3: '#c07cff', 4: '#ff9a2e' };

/** The colour of a card's frame (on its picture and its button). */
export function cardFrameColor(card: CardId, cls: ClassId | null): string {
  const src = cardSource(card);
  if (src === 'class') return cls ? CLASSES[cls].color : '#c9a45a';
  return TIER_FRAME[src];
}

const urls = new Map<string, string>();

function paint(ctx: CanvasRenderingContext2D, rows: string[], palette: Record<string, string>, x0: number, y0: number) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]];
      if (row[x] === '.' || !col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  });
}

/** A filled pixel circle (no smoothing), like the Python preview's. */
function disc(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5;
  const ry = (y1 - y0) / 2 + 0.5;
  ctx.fillStyle = color;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) ctx.fillRect(x, y, 1, 1);
  }
}

/** A motif (or a unit's sprite, for summons) with its top-left at x, y. */
function paintMotif(ctx: CanvasRenderingContext2D, motif: string, x: number, y: number) {
  if (MOTIF_ROWS[motif]) paint(ctx, MOTIF_ROWS[motif], CARD_PALETTE, x, y);
  else paint(ctx, SPRITES[motif] ?? [], PALETTE, x, y);
}

/** The mark for a second effect, in its own outlined badge 10px across, from `at`, `at`. */
function paintMark(ctx: CanvasRenderingContext2D, mark: string, dark: string, at: number) {
  disc(ctx, at, at, at + 9, at + 9, CARD_PALETTE.k);
  disc(ctx, at + 1, at + 1, at + 8, at + 8, dark);
  paint(ctx, MARK_ROWS[mark], CARD_PALETTE, at + 1, at + 1);
}

/**
 * A card's picture as a data URL (cached): its first school's tint, the main motif, the mark for its second effect, and
 * a frame telling class cards (the class colour) from Gear cards (the tier colour, with rivets).
 */
export function cardArtUrl(card: CardId, cls: ClassId | null): string {
  const frame = cardFrameColor(card, cls);
  const key = `${card}|${frame}`;
  let url = urls.get(key);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = CARD_ART_SIZE;
  const ctx = cv.getContext('2d')!;
  const school = CARDS[card].schools[0];
  const [dark, mid] = school ? SCHOOLS[school].tint : ['#202020', '#3a3a3a'];
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, CARD_ART_SIZE, CARD_ART_SIZE);
  ctx.fillStyle = dark;
  ctx.fillRect(1, 1, 24, 24);
  disc(ctx, 3, 2, 22, 21, mid);
  const { motif, mark } = CARD_ART[card];
  paintMotif(ctx, motif, 5, 4);
  if (mark) paintMark(ctx, mark, dark, 15);
  // Gear cards: rivets in the frame's corners.
  if (cardSource(card) !== 'class') {
    ctx.fillStyle = '#1a1612';
    for (const [x, y] of [[1, 1], [24, 1], [1, 24], [24, 24]]) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = '#e8e2d4';
    for (const [x, y] of [[0, 0], [25, 0], [0, 25], [25, 25]]) ctx.fillRect(x, y, 1, 1);
  }
  url = cv.toDataURL();
  urls.set(key, url);
  return url;
}

/** A field ability medallion's rim: bronze, lit from the top left. */
const RIM = { light: '#e0b860', mid: '#b8883a', dark: '#6e4c1c' };

/**
 * A field ability's picture as a data URL (cached), the same size as a card's but round (user, 2026-10-15): a bronze
 * medallion with a notched rim, its school's tint inside, the motif and its mark. Corners are left clear, so at a
 * glance it reads as a coin, never a card.
 */
export function fieldArtUrl(skill: FieldSkill): string {
  const key = `field|${skill}`;
  let url = urls.get(key);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = CARD_ART_SIZE;
  const ctx = cv.getContext('2d')!;
  const { motif, mark, school } = FIELD_ART[skill];
  const [dark, mid] = SCHOOLS[school].tint;
  const last = CARD_ART_SIZE - 1;
  disc(ctx, 0, 0, last, last, CARD_PALETTE.k);
  disc(ctx, 1, 1, last - 1, last - 1, RIM.dark);
  disc(ctx, 1, 1, last - 2, last - 2, RIM.light);
  disc(ctx, 2, 2, last - 2, last - 2, RIM.mid);
  // Notches struck into the rim, like a coin's edge.
  ctx.fillStyle = RIM.dark;
  for (const [x, y] of [[12, 1], [13, 1], [1, 12], [1, 13], [24, 12], [24, 13], [12, 24], [13, 24], [4, 4], [21, 4], [4, 21], [21, 21]]) ctx.fillRect(x, y, 1, 1);
  disc(ctx, 3, 3, last - 3, last - 3, CARD_PALETTE.k);
  disc(ctx, 4, 4, last - 4, last - 4, dark);
  disc(ctx, 6, 6, last - 6, last - 6, mid);
  paintMotif(ctx, motif, 5, 5);
  if (mark) paintMark(ctx, mark, dark, 13);
  url = cv.toDataURL();
  urls.set(key, url);
  return url;
}
