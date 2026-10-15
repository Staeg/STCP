import { ABILITY_ART, ART_TINTS, CLASSES, LEGENDS, type ClassId } from '@stcp/shared';
import { CARD_PALETTE, MARK_ROWS, MOTIF_ROWS } from './card-art-data';
import { PALETTE, SPRITES } from './sprite-data';

/** An ability picture's size in art pixels (shown at 2×): a 24×24 picture inside a 1px frame. */
export const ABILITY_ART_SIZE = 26;

/** Legendary abilities wear the Legendary tier's colour (as item names are coloured), riveted. */
const LEGENDARY_FRAME = '#ff9a2e';

/** A field-only ability's medallion rim (the Toll): bronze, lit from the top left. */
const RIM = { light: '#e0b860', mid: '#b8883a', dark: '#6e4c1c' };

/** How an ability's picture is framed: a class ability in its class colour, a Legendary one riveted, the Toll round. */
export type AbilityFrame = 'class' | 'legend' | 'field';

export function abilityFrame(id: string): AbilityFrame {
  if (id === 'toll') return 'field';
  return id in LEGENDS ? 'legend' : 'class';
}

/** The colour of an ability's frame (on its picture and its button). */
export function abilityFrameColor(id: string, cls: ClassId | null): string {
  const frame = abilityFrame(id);
  if (frame === 'legend') return LEGENDARY_FRAME;
  if (frame === 'field') return RIM.mid;
  return cls ? CLASSES[cls].color : '#c9a45a';
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

/** A filled pixel circle (no smoothing). */
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

/** A round bronze medallion with a notched rim and clear corners: a field-only ability, never a square one. */
function medallion(ctx: CanvasRenderingContext2D, motif: string, mark: string | undefined, dark: string, mid: string) {
  const last = ABILITY_ART_SIZE - 1;
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
}

/**
 * An ability's picture as a data URL (cached), like a beta card's: its tint, the main motif, the mark for its second
 * effect, framed in the class colour (class abilities) or Legendary orange with rivets; the Toll is a round medallion.
 */
export function abilityArtUrl(id: string, cls: ClassId | null): string {
  const frame = abilityFrame(id);
  const color = abilityFrameColor(id, cls);
  const key = `${id}|${color}`;
  let url = urls.get(key);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = ABILITY_ART_SIZE;
  const ctx = cv.getContext('2d')!;
  const { motif, mark, tint } = ABILITY_ART[id] ?? { motif: 'hand', tint: 'strike' as const };
  const [dark, mid] = ART_TINTS[tint];
  if (frame === 'field') medallion(ctx, motif, mark, dark, mid);
  else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, ABILITY_ART_SIZE, ABILITY_ART_SIZE);
    ctx.fillStyle = dark;
    ctx.fillRect(1, 1, 24, 24);
    disc(ctx, 3, 2, 22, 21, mid);
    paintMotif(ctx, motif, 5, 4);
    if (mark) paintMark(ctx, mark, dark, 15);
    if (frame === 'legend') {
      ctx.fillStyle = '#1a1612';
      for (const [x, y] of [[1, 1], [24, 1], [1, 24], [24, 24]]) ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = '#e8e2d4';
      for (const [x, y] of [[0, 0], [25, 0], [0, 25], [25, 25]]) ctx.fillRect(x, y, 1, 1);
    }
  }
  url = cv.toDataURL();
  urls.set(key, url);
  return url;
}
