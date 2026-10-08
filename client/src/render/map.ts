import type { HeroPos, PlayerView, RoomView } from '@stcp/shared';
import type { Net } from '../net';
import { drawSprite } from './sprites';

const COLORS = {
  bg: '#0d0b0a',
  corridor: '#4f3f2e',
  corridorUnknown: 'rgba(79,63,46,0.45)',
  roomExplored: '#2b231c',
  roomSeen: '#15110e',
  border: '#7a6448',
  borderSeen: '#4a3c2c',
  entrance: '#6a9a5a',
  exit: '#e0b44a',
  hover: '#f0d890',
  text: '#d8c8a8',
  muted: '#8a7a60',
};

interface Xform {
  s: number;
  ox: number;
  oy: number;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private hover: number | null = null;
  private mouse = { x: -1, y: -1 };
  private x: Xform = { s: 1, ox: 0, oy: 0 };
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private net: Net) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
    canvas.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('click', (e) => {
      const room = this.hitTest(e.clientX, e.clientY);
      if (room !== null) this.net.intent({ type: 'goto', room });
    });
  }

  private resize() {
    this.dpr = devicePixelRatio || 1;
    this.canvas.width = innerWidth * this.dpr;
    this.canvas.height = innerHeight * this.dpr;
  }

  private layout(view: PlayerView) {
    // Keep clear of the left HUD column (clock + roster) and the top-right status panel.
    const left = 300;
    const top = 110;
    const right = 30;
    const bottom = 70;
    const w = innerWidth - left - right;
    const h = innerHeight - top - bottom;
    const s = Math.min(w / view.width, h / view.height);
    this.x = { s, ox: left + (w - view.width * s) / 2, oy: top + (h - view.height * s) / 2 };
  }

  private sx(x: number) {
    return this.x.ox + x * this.x.s;
  }
  private sy(y: number) {
    return this.x.oy + y * this.x.s;
  }

  private roomSize() {
    return Math.max(22, 34 * this.x.s);
  }

  /** Interpolated world position of a hero (you, or a live ally) between the last two snapshots. */
  private smoothXY(id: string, curPos: HeroPos): { x: number; y: number } {
    const { cur, prev, curAt } = this.net;
    const b = posXY(cur!, curPos);
    if (!prev) return b;
    const prevPos = id === prev.you.id ? prev.you.pos : prev.allies.find((a) => a.id === id && a.live)?.pos;
    if (!prevPos) return b;
    const a = posXY(prev, prevPos);
    const alpha = Math.min(1, (performance.now() - curAt) / 100);
    return Math.hypot(a.x - b.x, a.y - b.y) < 80 ? { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha } : b;
  }

  /** Screen positions for every hero token, spreading out tokens that would overlap. */
  private tokenPositions(view: PlayerView): Map<string, { x: number; y: number; lx: number; ly: number }> {
    const entries: { id: string; pos: HeroPos }[] = [{ id: view.you.id, pos: view.you.pos }, ...view.allies];
    const raw = entries.map((e) => {
      const p = this.smoothXY(e.id, e.pos);
      return { id: e.id, x: this.sx(p.x), y: this.sy(p.y) };
    });
    // Greedy clustering: tokens within a few px of a cluster's anchor share a ring.
    const clusters: (typeof raw)[] = [];
    for (const t of raw) {
      const c = clusters.find((cl) => Math.hypot(cl[0].x - t.x, cl[0].y - t.y) < 8);
      if (c) c.push(t);
      else clusters.push([t]);
    }
    const out = new Map<string, { x: number; y: number; lx: number; ly: number }>();
    const spread = this.roomSize() * 0.26;
    const r = Math.max(6, 9 * this.x.s);
    for (const cl of clusters) {
      // Labels stack in a column under the cluster so names never pile on top of each other.
      const base = cl[0].y + (cl.length > 1 ? spread : 0) + r + 11;
      const others = cl.filter((t) => t.id !== view.you.id);
      cl.forEach((t, i) => {
        const li = Math.max(0, others.indexOf(t));
        const lx = cl[0].x;
        const ly = base + li * 13;
        if (cl.length === 1) return out.set(t.id, { x: t.x, y: t.y, lx: t.x, ly });
        const ang = -Math.PI / 2 + (i / cl.length) * Math.PI * 2;
        out.set(t.id, { x: cl[0].x + Math.cos(ang) * spread, y: cl[0].y + Math.sin(ang) * spread, lx, ly });
      });
    }
    return out;
  }

  /** Room under a screen point, using the most recent layout. */
  private hitTest(px: number, py: number): number | null {
    const view = this.net.cur;
    if (!view) return null;
    const half = this.roomSize() / 2 + 4;
    const hit = view.rooms.find((r) => Math.abs(this.sx(r.x) - px) < half && Math.abs(this.sy(r.y) - py) < half);
    return hit ? hit.id : null;
  }

  draw() {
    const { ctx } = this;
    const view = this.net.cur;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (!view) return;
    this.layout(view);

    const rooms = new Map(view.rooms.map((r) => [r.id, r]));
    const you = view.you;
    const curRoom = you.pos.kind === 'room' ? you.pos.room : null;
    const size = this.roomSize();

    this.hover = this.hitTest(this.mouse.x, this.mouse.y);
    this.canvas.style.cursor = this.hover !== null && this.hover !== curRoom ? 'pointer' : 'default';

    // Corridors
    ctx.lineCap = 'round';
    for (const c of view.corridors) {
      const a = rooms.get(c.a)!;
      const b = rooms.get(c.b)!;
      const unknownEnd = a.knowledge === 'unknown' ? a : b.knowledge === 'unknown' ? b : null;
      ctx.lineWidth = Math.max(3, 6 * this.x.s);
      if (unknownEnd) {
        const known = unknownEnd === a ? b : a;
        ctx.strokeStyle = COLORS.corridorUnknown;
        ctx.setLineDash([6, 6]);
        line(ctx, this.sx(known.x), this.sy(known.y), this.sx(unknownEnd.x), this.sy(unknownEnd.y));
        ctx.setLineDash([]);
      } else if (c.collapsed) {
        // Rubble: broken red line with an X in the middle.
        ctx.strokeStyle = 'rgba(160,60,40,0.8)';
        ctx.setLineDash([3, 5]);
        line(ctx, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y));
        ctx.setLineDash([]);
        const mx = (this.sx(a.x) + this.sx(b.x)) / 2;
        const my = (this.sy(a.y) + this.sy(b.y)) / 2;
        ctx.strokeStyle = '#e05a3a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(mx - 6, my - 6);
        ctx.lineTo(mx + 6, my + 6);
        ctx.moveTo(mx + 6, my - 6);
        ctx.lineTo(mx - 6, my + 6);
        ctx.stroke();
      } else {
        ctx.strokeStyle = COLORS.corridor;
        line(ctx, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y));
      }
    }

    // Chalk marks at crossroads: a tick per hero on the corridor they left by.
    const colorOf = new Map([[you.id, you.color], ...view.allies.map((a) => [a.id, a.color] as [string, string])]);
    const allCorridors = new Map([...view.corridors, ...view.ghostCorridors].map((c) => [c.id, c]));
    for (const chalk of view.chalk) {
      const room = rooms.get(chalk.room);
      if (!room) continue;
      const perCorridor = new Map<number, string[]>();
      for (const m of chalk.marks) (perCorridor.get(m.corridor) ?? perCorridor.set(m.corridor, []).get(m.corridor)!).push(m.heroId);
      for (const [cid, heroes] of perCorridor) {
        const c = allCorridors.get(cid);
        const other = c && rooms.get(c.a === chalk.room ? c.b : c.a);
        if (!other) continue;
        const dx = this.sx(other.x) - this.sx(room.x);
        const dy = this.sy(other.y) - this.sy(room.y);
        const len = Math.hypot(dx, dy);
        const [ux, uy] = [dx / len, dy / len];
        const d = size / 2 + 10;
        heroes.forEach((h, i) => {
          const off = (i - (heroes.length - 1) / 2) * 9;
          const x = this.sx(room.x) + ux * d - uy * off;
          const y = this.sy(room.y) + uy * d + ux * off;
          ctx.fillStyle = colorOf.get(h) ?? '#fff';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
          ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        });
      }
    }

    const tokens = this.tokenPositions(view);
    const hp = tokens.get(you.id)!;

    // Planned path
    if (hp && you.path.length + (you.pos.kind === 'corridor' ? 1 : 0) > 0) {
      ctx.strokeStyle = you.color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y);
      const stops = (you.pos.kind === 'corridor' ? [you.pos.to] : []).concat(you.path);
      for (const id of stops) {
        const r = rooms.get(id);
        if (r) ctx.lineTo(this.sx(r.x), this.sy(r.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Rooms
    const t = performance.now() / 1000;
    for (const r of view.rooms) this.drawRoom(r, size, r.id === this.hover, r.id === curRoom, t);

    // Heroes: ghosts first, then live allies, then you on top.
    const r = Math.max(6, 9 * this.x.s);
    const ordered = [...view.allies].sort((a, b) => Number(a.live) - Number(b.live));
    // Sprite size: a whole multiple of 16 px keeps the pixel art crisp.
    const sprite = Math.max(16, Math.round((r * 2.8) / 8) * 8);
    for (const a of ordered) {
      const p = tokens.get(a.id)!;
      this.drawHero(p.x, p.y, sprite, a.cls, a.color, a.live ? 'live' : 'ghost');
      if (a.downed || a.dead) this.drawCross(p.x, p.y, r, a.dead);
    }
    if (view.leading) drawSprite(ctx, 'villager', hp.x + sprite * 0.55, hp.y + sprite * 0.1, Math.round(sprite * 0.75));
    this.drawHero(hp.x, hp.y, sprite, you.cls, you.color, 'you');
    if (you.downedAt !== null || you.dead) this.drawCross(hp.x, hp.y, r, you.dead);

    // Light vignette around the hero
    {
      const frac = you.light / 100;
      const r0 = 90 + frac * 520;
      const g = ctx.createRadialGradient(hp.x, hp.y, r0 * 0.35, hp.x, hp.y, r0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${view.dim ? 0.9 : 0.3 + 0.45 * (1 - frac)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
    }

    // Ally labels above the vignette, so you can always find them
    ctx.font = '15px VT323, monospace';
    ctx.textAlign = 'center';
    for (const a of view.allies) {
      const p = tokens.get(a.id)!;
      const ago = Math.floor(view.time - a.seenAt);
      const label = a.live ? a.name : `${a.name} · ${ago >= 60 ? `${Math.floor(ago / 60)}m` : `${ago}s`} ago`;
      ctx.fillStyle = '#000';
      ctx.fillText(label, p.lx + 1, p.ly + 1);
      ctx.fillStyle = a.live ? a.color : COLORS.muted;
      ctx.fillText(label, p.lx, p.ly);
    }

    // Hover label drawn last so it sits above the vignette
    if (this.hover !== null) {
      const r = rooms.get(this.hover)!;
      const label = r.name ?? 'Unknown passage';
      ctx.font = '20px VT323, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      const tx = this.sx(r.x);
      const ty = this.sy(r.y) - size / 2 - 10;
      ctx.fillText(label, tx + 1, ty + 1);
      ctx.fillStyle = COLORS.hover;
      ctx.fillText(label, tx, ty);
    }
  }

  /** A hero on the map: a coloured base (so you can tell who's who at a glance) and their sprite. */
  private drawHero(x: number, y: number, size: number, cls: string, color: string, mode: 'you' | 'live' | 'ghost') {
    const { ctx } = this;
    const ghost = mode === 'ghost';
    ctx.globalAlpha = ghost ? 0.45 : 1;
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.42, size * 0.42, size * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = ghost ? 'rgba(0,0,0,0.4)' : color;
    ctx.fill();
    ctx.lineWidth = mode === 'you' ? 2 : 1;
    ctx.strokeStyle = mode === 'you' ? '#fff' : ghost ? color : '#000';
    if (ghost) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawSprite(ctx, cls, x, y, size, color, ghost);
    ctx.globalAlpha = 1;
  }

  /** X over a downed hero (red) or a dead one (grey). */
  private drawCross(x: number, y: number, r: number, dead: boolean) {
    const { ctx } = this;
    ctx.strokeStyle = dead ? '#888' : '#ff4a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  private drawRoom(r: RoomView, size: number, hover: boolean, current: boolean, t: number) {
    const { ctx } = this;
    const x = this.sx(r.x) - size / 2;
    const y = this.sy(r.y) - size / 2;

    if (r.kind === 'exit') {
      const open = this.net.cur?.exitOpen;
      const pulse = 0.5 + 0.5 * Math.sin(t * (open ? 6 : 2.5));
      ctx.shadowColor = open ? '#7cff6a' : COLORS.exit;
      ctx.shadowBlur = 10 + pulse * 14;
    }
    ctx.fillStyle = r.knowledge === 'explored' ? COLORS.roomExplored : COLORS.roomSeen;
    ctx.fillRect(x, y, size, size);
    ctx.shadowBlur = 0;

    ctx.lineWidth = current ? 3 : 2;
    let border = r.knowledge === 'explored' ? COLORS.border : COLORS.borderSeen;
    if (r.kind === 'entrance') border = COLORS.entrance;
    if (r.kind === 'exit') border = COLORS.exit;
    if (hover) border = COLORS.hover;
    ctx.strokeStyle = border;
    if (r.knowledge !== 'explored' && r.kind !== 'exit') ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, size, size);
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x + size / 2;
    const cy = y + size / 2;
    if (r.knowledge === 'unknown') {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `${Math.round(size * 0.6)}px VT323, monospace`;
      ctx.fillText('?', cx, cy + 1);
    } else if (r.kind === 'exit') {
      ctx.fillStyle = COLORS.exit;
      ctx.font = `${Math.round(size * 0.6)}px VT323, monospace`;
      ctx.fillText('⚑', cx, cy + 1);
      ctx.font = '16px VT323, monospace';
      ctx.fillText('RENDEZVOUS', cx, y + size + 10);
    } else if (r.kind === 'entrance') {
      ctx.fillStyle = COLORS.entrance;
      ctx.font = '16px VT323, monospace';
      ctx.fillText('ENTRANCE', cx, y + size + 10);
    }

    // Monsters you last saw here
    if (r.threat) {
      ctx.font = '16px VT323, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#000';
      ctx.fillText(`☠${r.threat}`, x + size - 3, y + size + 1);
      ctx.fillStyle = '#e05a4a';
      ctx.fillText(`☠${r.threat}`, x + size - 4, y + size);
      ctx.textAlign = 'center';
    }

    // Event you saw here
    if (r.event === 'villager') {
      drawSprite(ctx, 'villager', cx, cy, Math.max(16, Math.round((size * 0.8) / 8) * 8));
    } else if (r.event) {
      const glyph = ({ altar: '⛧', idol: '✧', stranger: '¿', well: '◯', vault: '▣', chest: '☐', crawlspace: '↘' } as const)[r.event];
      ctx.font = `${Math.round(size * 0.55)}px VT323, monospace`;
      ctx.fillStyle = r.event === 'altar' ? '#c08aff' : '#e0c890';
      ctx.fillText(glyph, cx, cy + 1);
    }

    // Loot you last saw here
    if (r.loot) {
      ctx.font = '16px VT323, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#000';
      ctx.fillText('✦', x + 1, y + size + 1);
      ctx.fillStyle = '#e0b44a';
      ctx.fillText('✦', x, y + size);
      ctx.textAlign = 'center';
    }

    // Crossroads marker
    if (r.knowledge === 'explored' && r.corridors.length >= 3) {
      ctx.fillStyle = COLORS.muted;
      ctx.beginPath();
      ctx.moveTo(x + size - 6, y + 2);
      ctx.lineTo(x + size - 2, y + 6);
      ctx.lineTo(x + size - 6, y + 10);
      ctx.lineTo(x + size - 10, y + 6);
      ctx.fill();
    }
    ctx.textBaseline = 'alphabetic';
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function posXY(view: PlayerView, pos: HeroPos): { x: number; y: number } {
  const room = (id: number) => view.rooms.find((r) => r.id === id) ?? { x: 0, y: 0 };
  if (pos.kind === 'room') return room(pos.room);
  const a = room(pos.from);
  const b = room(pos.to);
  const len = (view.corridors.find((c) => c.id === pos.corridor) ?? view.ghostCorridors.find((c) => c.id === pos.corridor))?.length;
  const f = len ? pos.t / len : 0.5;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
