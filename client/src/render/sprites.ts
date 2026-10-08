import { PALETTE, SPRITES } from './sprite-data';

export type SpriteName = keyof typeof SPRITES;

const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

/** Darken a #rrggbb colour (for the 'B' shade of class colours). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

function toGrey(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const g = Math.round(((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.55 + (n & 255) * 0.15);
  const h = Math.round(g * 0.75).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/** A 16×16 canvas for a sprite, tinted with a class colour where the art says 'b'/'B'. Cached. */
export function spriteCanvas(name: string, color = '#888888', grey = false): HTMLCanvasElement {
  const key = `${name}|${color}|${grey}`;
  let cv = canvases.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const ctx = cv.getContext('2d')!;
  const rows = SPRITES[name] ?? SPRITES.villager;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      let col = ch === 'b' ? color : ch === 'B' ? shade(color, 0.6) : PALETTE[ch];
      if (!col) continue;
      if (grey) col = toGrey(col);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  canvases.set(key, cv);
  return cv;
}

/** Same sprite as a data URL, for <img> in DOM panels. */
export function spriteUrl(name: string, color?: string, grey = false): string {
  const key = `${name}|${color}|${grey}`;
  let url = urls.get(key);
  if (!url) {
    url = spriteCanvas(name, color, grey).toDataURL();
    urls.set(key, url);
  }
  return url;
}

/** Draw a sprite centred at (x, y), `size` pixels tall, crisp. */
export function drawSprite(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color?: string, grey = false) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spriteCanvas(name, color, grey), Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  ctx.imageSmoothingEnabled = prev;
}
