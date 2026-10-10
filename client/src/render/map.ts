import { CALL_RULES, dirBetween, ENEMIES, EVENTS, itemTier, ITEMS, type AllyView, type HeroPos, type ItemId, type PlayerView, type RoomReveal, type RoomView } from '@stcp/shared';
import type { Net } from '../net';
import { icon, iconize } from '../icons';
import { drawSprite } from './sprites';

/** Item tier colours, as in the HUD (style.css .tier-N). */
const TIER_COLORS = { 1: '#f4f0e8', 2: '#5aa8ff', 3: '#c07cff' } as const;

const COLORS = {
  bg: '#0d0b0a',
  corridor: '#4f3f2e',
  corridorUnknown: 'rgba(79,63,46,0.45)',
  /** The ways into secret rooms. */
  secret: '#d9a92e',
  secretUnknown: 'rgba(217,169,46,0.55)',
  roomExplored: '#2b231c',
  roomSeen: '#15110e',
  border: '#7a6448',
  borderSeen: '#4a3c2c',
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
  /** Camera centre in world units, and when it last moved. */
  private cam: { x: number; y: number } | null = null;
  private camAt = 0;
  private camFor = '';
  /** After the run: a room clicked to pin its contents open, so each line can be hovered for the details. */
  private locked: number | null = null;
  private lockEl: HTMLDivElement;
  private lockHtml = '';

  constructor(private canvas: HTMLCanvasElement, private net: Net) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    addEventListener('resize', () => this.resize());
    canvas.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('mouseleave', () => (this.mouse = { x: -1, y: -1 }));
    canvas.addEventListener('click', (e) => {
      if (this.net.cur?.results) return;
      const room = this.hitTest(e.clientX, e.clientY);
      if (room !== null) this.net.intent({ type: 'goto', room });
    });
    this.lockEl = document.createElement('div');
    this.lockEl.className = 'reveal-lock';
    this.lockEl.hidden = true;
    document.body.appendChild(this.lockEl);
    // Post-game map: click a room to pin what was in it; the next click, anywhere, lets go.
    document.addEventListener('click', (e) => {
      if (!this.net.cur?.results) return;
      if (this.locked !== null) this.locked = null;
      else if (e.target === canvas) this.locked = this.hitTest(e.clientX, e.clientY);
    });
  }

  private resize() {
    this.dpr = devicePixelRatio || 1;
    this.canvas.width = innerWidth * this.dpr;
    this.canvas.height = innerHeight * this.dpr;
  }

  /** The camera follows your hero at a fixed zoom, easing toward them so each move pans smoothly. */
  private layout(view: PlayerView) {
    // Keep clear of the left HUD column (clock + roster), the top-right status panel and the bottom bars.
    const left = 300;
    const top = 110;
    const right = 30;
    const bottom = 130;
    const w = innerWidth - left - right;
    const h = innerHeight - top - bottom;
    // About 7 rooms across and 4–5 down, whatever the window size.
    if (view.results) {
      // After the run the whole dungeon is revealed: fit all of it on screen, clear of the status panel too.
      const w = innerWidth - left - 290;
      const xs = view.rooms.map((r) => r.x);
      const ys = view.rooms.map((r) => r.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const fit = Math.max(0.3, Math.min(2.2, Math.min(w / (x1 - x0 + 80), h / (y1 - y0 + 80))));
      this.x = { s: fit, ox: left + w / 2 - ((x0 + x1) / 2) * fit, oy: top + h / 2 - ((y0 + y1) / 2) * fit };
      return;
    }
    const s = Math.max(0.8, Math.min(2.2, Math.min(w / 750, h / 450)));
    const target = posXY(view, view.you.pos);
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.camAt) / 1000);
    this.camAt = now;
    if (!this.cam || view.you.id !== this.camFor) {
      this.cam = { ...target };
      this.camFor = view.you.id;
    } else {
      const k = 1 - Math.exp(-dt * 5);
      this.cam.x += (target.x - this.cam.x) * k;
      this.cam.y += (target.y - this.cam.y) * k;
    }
    this.x = { s, ox: left + w / 2 - this.cam.x * s, oy: top + h / 2 - this.cam.y * s };
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

  /** Screen positions for every hero token, spreading out tokens that would overlap. */
  private tokenPositions(view: PlayerView): Map<string, { x: number; y: number; lx: number; ly: number }> {
    const entries: { id: string; pos: HeroPos }[] = [{ id: view.you.id, pos: view.you.pos }, ...view.allies];
    const raw = entries.map((e) => {
      const p = posXY(view, e.pos);
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
    if (!view) {
      this.locked = null;
      this.drawLock(undefined, 0);
      return;
    }
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
        ctx.strokeStyle = c.secret ? COLORS.secretUnknown : COLORS.corridorUnknown;
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
      } else if (c.secret) {
        // A golden way into a secret room, glinting.
        ctx.strokeStyle = COLORS.secret;
        ctx.shadowColor = COLORS.secret;
        ctx.shadowBlur = 8;
        line(ctx, this.sx(a.x), this.sy(a.y), this.sx(b.x), this.sy(b.y));
        ctx.shadowBlur = 0;
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

    // Where allies you can see have chosen to go: a dashed line to the room, and a ring in their colour on it.
    const headings = view.allies.filter((a) => a.live && a.heading !== null && rooms.has(a.heading));
    for (const a of headings) {
      const p = tokens.get(a.id)!;
      const dest = rooms.get(a.heading!)!;
      ctx.strokeStyle = a.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      line(ctx, p.x, p.y, this.sx(dest.x), this.sy(dest.y));
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Rooms
    const t = performance.now() / 1000;
    // The pinned room only counts while the revealed map is actually on show (not under the results card).
    const peeking = !!view.results && !!document.getElementById('results')?.classList.contains('peek');
    if (!peeking) this.locked = null;
    const pinned = this.locked !== null ? rooms.get(this.locked) : undefined;
    for (const r of view.rooms) this.drawRoom(r, size, r.id === this.hover || r === pinned, r.id === curRoom, t);

    headings.forEach((a, i) => {
      const dest = rooms.get(a.heading!)!;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(this.sx(dest.x) - size / 2 - 4 - i * 3, this.sy(dest.y) - size / 2 - 4 - i * 3, size + 8 + i * 6, size + 8 + i * 6);
    });

    // A bell was tolled: rings ripple out from that room in the Bellwright's colour while it's heard.
    for (const toll of view.tolls) {
      const room = rooms.get(toll.room);
      if (!room) continue;
      ctx.strokeStyle = colorOf.get(toll.by) ?? '#d98a3a';
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        const phase = ((t * 0.8 + k / 3) % 1);
        ctx.globalAlpha = 0.8 * (1 - phase);
        ctx.beginPath();
        ctx.arc(this.sx(room.x), this.sy(room.y), size / 2 + 6 + phase * size * 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // A call for help: red rings pulling in toward the room, while it's fresh.
    for (const call of view.calls) {
      const room = rooms.get(call.room);
      if (!room) continue;
      ctx.strokeStyle = '#ff4a4a';
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        const phase = 1 - ((t * 1.2 + k / 3) % 1);
        ctx.globalAlpha = 0.8 * (1 - phase) * Math.max(0.25, 1 - call.ago / CALL_RULES.shown);
        ctx.beginPath();
        ctx.arc(this.sx(room.x), this.sy(room.y), size / 2 + 6 + phase * size * 1.6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

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
    // A ring in each hero's colour fills with their Speed timer: to arrival in a tunnel (where they wait at its
    // midpoint), or to their next turn standing in a room.
    const youFree = you.encounter === null && you.downedAt === null && !you.dead && !you.channel;
    let yourFrac: number | null = null;
    for (const h of [...view.allies.filter((a) => a.live), you]) {
      let frac: number;
      if (h.pos.kind === 'corridor') frac = Math.min(1, h.pos.t / h.pos.dur);
      else {
        const turn = h === you ? (youFree ? { start: you.turnStart, at: you.turnAt } : undefined) : (h as AllyView).turn;
        if (!turn || turn.at <= turn.start) continue;
        frac = Math.max(0, Math.min(1, (view.time - turn.start) / (turn.at - turn.start)));
      }
      if (h === you) yourFrac = frac;
      const p = tokens.get(h.id)!;
      ctx.lineWidth = h.id === you.id ? 3 : 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, sprite * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = h.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, sprite * 0.72, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }
    if (curRoom !== null && you.encounter === null && you.downedAt === null) this.drawKeyHints(view, rooms.get(curRoom), size);
    if (view.leading) drawSprite(ctx, 'villager', hp.x + sprite * 0.55, hp.y + sprite * 0.1, Math.round(sprite * 0.75));
    this.drawHero(hp.x, hp.y, sprite, you.cls, you.color, 'you');
    if (you.downedAt !== null || you.dead) this.drawCross(hp.x, hp.y, r, you.dead);

    // Light vignette around the hero (gone once the run is over and the map is revealed)
    if (!view.results) {
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
    const labelled = pinned ?? (this.hover !== null ? rooms.get(this.hover) : undefined);
    if (labelled) {
      const r = labelled;
      const label = r.name ?? 'Unknown passage';
      ctx.font = '20px VT323, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      const tx = this.sx(r.x);
      const ty = this.sy(r.y) - size / 2 - 10;
      ctx.fillText(label, tx + 1, ty + 1);
      ctx.fillStyle = COLORS.hover;
      ctx.fillText(label, tx, ty);
      if (r.reveal && !pinned) this.drawReveal(r.reveal, tx, this.sy(r.y) + size / 2 + 8);
    }
    this.drawLock(pinned, size);

    // Your Speed ring again, round the mouse pointer, so you can watch it without looking at your hero.
    if (yourFrac !== null && this.mouse.x >= 0 && !view.results) {
      const { x, y } = this.mouse;
      const rr = 13;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = you.color;
      ctx.beginPath();
      ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + yourFrac * Math.PI * 2);
      ctx.stroke();
    }
  }

  /** The pinned room's contents as a real box under it, each line with a hover tip giving the full description. */
  private drawLock(r: RoomView | undefined, size: number) {
    const el = this.lockEl;
    if (!r?.reveal) {
      el.hidden = true;
      this.lockHtml = '';
      return;
    }
    const rv = r.reveal;
    const row = (color: string, text: string, tip?: string) =>
      `<div class="rl-row${tip ? ' has-tip' : ''}" style="color:${color}">${text}${tip ? `<div class="hover-tip">${tip}</div>` : ''}</div>`;
    const rows: string[] = [];
    const counts = new Map<string, number>();
    for (const m of rv.monsters) counts.set(m, (counts.get(m) ?? 0) + 1);
    for (const [m, n] of counts) {
      const e = ENEMIES[m as keyof typeof ENEMIES];
      rows.push(row('#e07a5a', `${e.glyph} ${n > 1 ? `${n}× ` : ''}${e.name}`,
        `<div><b>${e.name}</b> ${icon('hp')} ${e.maxHp} · ${icon('speed')} ${e.speed}s${e.undead ? ' · undead' : ''}</div><div>${iconize(e.desc)}</div>`));
    }
    for (const it of rv.items) {
      const def = ITEMS[it as ItemId];
      rows.push(row(TIER_COLORS[itemTier(it)], `${def.glyph} ${def.name}`, `<div><b>${def.name}</b></div><div>${iconize(def.desc)}</div>`));
    }
    if (rv.gold > 0) rows.push(row('#e0b44a', `⛀ ${rv.gold} gold`));
    if (rv.event) {
      const ev = EVENTS[rv.event];
      rows.push(row('#c08aff', `${ev.glyph} ${ev.name} (not done)`, `<div><b>${ev.name}</b></div><div>${ev.text}</div>`));
    }
    if (rv.captive) rows.push(row('#e0c890', '☺ A captive, never freed', `<div>${EVENTS.villager.text}</div>`));
    if (!rows.length) rows.push(row(COLORS.muted, 'Nothing left here.'));
    const html = `<div class="muted small">Hover for details · click to let go</div>${rows.join('')}`;
    el.hidden = false;
    if (html !== this.lockHtml) {
      el.innerHTML = html;
      this.lockHtml = html;
    }
    const cx = this.sx(r.x);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, cx - w / 2))}px`;
    el.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, this.sy(r.y) + size / 2 + 8))}px`;
    // Tips open on whichever side has more room.
    el.classList.toggle('flip', cx > innerWidth / 2);
  }

  /** After the run: what was left in the hovered room, in a box under it. */
  private drawReveal(rv: RoomReveal, cx: number, top: number) {
    const lines: { text: string; color: string }[] = [];
    const counts = new Map<string, number>();
    for (const m of rv.monsters) counts.set(ENEMIES[m].name, (counts.get(ENEMIES[m].name) ?? 0) + 1);
    for (const [name, n] of counts) lines.push({ text: `☠ ${n > 1 ? `${n}× ` : ''}${name}`, color: '#e07a5a' });
    for (const it of rv.items) lines.push({ text: `${ITEMS[it as ItemId].glyph} ${ITEMS[it as ItemId].name}`, color: TIER_COLORS[itemTier(it)] });
    if (rv.gold > 0) lines.push({ text: `⛀ ${rv.gold} gold`, color: '#e0b44a' });
    if (rv.event) lines.push({ text: `${EVENTS[rv.event].glyph} ${EVENTS[rv.event].name} (not done)`, color: '#c08aff' });
    if (rv.captive) lines.push({ text: '☺ A captive, never freed', color: '#e0c890' });
    if (!lines.length) lines.push({ text: 'Nothing left here.', color: COLORS.muted });
    const { ctx } = this;
    ctx.font = '18px VT323, monospace';
    const lh = 18;
    const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 16;
    const h = lines.length * lh + 8;
    const x = Math.max(4, Math.min(innerWidth - w - 4, cx - w / 2));
    const y = Math.min(innerHeight - h - 4, top);
    ctx.fillStyle = 'rgba(22,18,15,0.95)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x + 8, y + 5 + i * lh);
    });
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
  }

  /** W/A/S/D next to each tunnel out of your room. */
  private drawKeyHints(view: PlayerView, here: RoomView | undefined, size: number) {
    if (!here) return;
    const { ctx } = this;
    const keys = { north: 'W', west: 'A', south: 'S', east: 'D' } as const;
    ctx.font = '16px VT323, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of view.corridors) {
      if (c.a !== here.id && c.b !== here.id) continue;
      const other = view.rooms.find((r) => r.id === (c.a === here.id ? c.b : c.a));
      if (!other) continue;
      const dx = this.sx(other.x) - this.sx(here.x);
      const dy = this.sy(other.y) - this.sy(here.y);
      const len = Math.hypot(dx, dy);
      const d = size / 2 + 22;
      const x = this.sx(here.x) + (dx / len) * d;
      const y = this.sy(here.y) + (dy / len) * d;
      // Nudge the badge off the corridor line so it doesn't sit on chalk marks.
      const ox = Math.abs(dx) > Math.abs(dy) ? 0 : 12;
      const oy = Math.abs(dx) > Math.abs(dy) ? -12 : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x + ox - 8, y + oy - 8, 16, 16);
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + ox - 8, y + oy - 8, 16, 16);
      ctx.fillStyle = c.collapsed ? '#e05a3a' : COLORS.text;
      ctx.fillText(keys[dirBetween(here, other)], x + ox, y + oy + 1);
    }
    ctx.textBaseline = 'alphabetic';
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
    if (r.kind === 'exit') border = COLORS.exit;
    if (r.kind === 'secret') border = COLORS.secret;
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
      ctx.fillText('START · EXIT', cx, y + size + 10);
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
      const glyph = EVENTS[r.event].glyph;
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

/** Where a hero is drawn: in their room, or at the midpoint of the tunnel they're taking (moves are instant on arrival). */
export function posXY(view: PlayerView, pos: HeroPos): { x: number; y: number } {
  const room = (id: number) => view.rooms.find((r) => r.id === id) ?? { x: 0, y: 0 };
  if (pos.kind === 'room') return room(pos.room);
  const a = room(pos.from);
  const b = room(pos.to);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
