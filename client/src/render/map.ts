import type { HeroPos, PlayerView, RoomView } from '@stcp/shared';
import type { Net } from '../net';

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
    const top = 110;
    const pad = 50;
    const w = innerWidth - pad * 2;
    const h = innerHeight - top - pad * 2;
    const s = Math.min(w / view.width, h / view.height);
    this.x = { s, ox: (innerWidth - view.width * s) / 2, oy: top + (innerHeight - top - view.height * s) / 2 - pad / 2 };
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

  /** Interpolated screen position of your hero. */
  heroScreenPos(): { x: number; y: number } | null {
    const { cur, prev, curAt } = this.net;
    if (!cur) return null;
    const b = posXY(cur, cur.you.pos);
    let p = b;
    if (prev) {
      const a = posXY(prev, prev.you.pos);
      const alpha = Math.min(1, (performance.now() - curAt) / 100);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 80) p = { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha };
    }
    return { x: this.sx(p.x), y: this.sy(p.y) };
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
      } else {
        ctx.strokeStyle = COLORS.corridor;
        line(ctx, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y));
      }
    }

    // Planned path
    const hp = this.heroScreenPos();
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

    // Hero
    if (hp) {
      ctx.fillStyle = you.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, Math.max(6, 9 * this.x.s), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }

    // Light vignette around the hero
    if (hp) {
      const frac = you.light / 100;
      const r0 = 90 + frac * 520;
      const g = ctx.createRadialGradient(hp.x, hp.y, r0 * 0.35, hp.x, hp.y, r0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${view.dim ? 0.9 : 0.3 + 0.45 * (1 - frac)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
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

  private drawRoom(r: RoomView, size: number, hover: boolean, current: boolean, t: number) {
    const { ctx } = this;
    const x = this.sx(r.x) - size / 2;
    const y = this.sy(r.y) - size / 2;

    if (r.kind === 'exit') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
      ctx.shadowColor = COLORS.exit;
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
  const room = (id: number) => view.rooms.find((r) => r.id === id)!;
  if (pos.kind === 'room') return room(pos.room);
  const a = room(pos.from);
  const b = room(pos.to);
  const len = view.corridors.find((c) => c.id === pos.corridor)!.length;
  const f = pos.t / len;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
