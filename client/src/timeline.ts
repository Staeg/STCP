import { ITEMS, TIMELINE_TURNS, type CombatUnitView, type EncounterView, type TimelineTurnView } from '@stcp/shared';
import { spriteUrl } from './render/sprites';
import { cardArtUrl } from './render/card-art';
import { icon } from './icons';

/** How long a turn takes to slide to its new place on the strip when the order changes: quick, but you see it go. */
const SLIDE_MS = 240;
/** How long a turn that changed places (not just moved up a slot) stays lit, so you can tell what your pick did. */
const LIT_MS = 700;

/** A unit's sprite: a hero in their colour, a Risen ally as its class in the colour of the dead, a monster as itself. */
export function unitSprite(u: CombatUnitView, grey = false): string {
  return u.kind === 'hero' ? spriteUrl(u.cls!, u.color, grey || u.downed)
    : u.cls ? spriteUrl(u.cls, '#8fa39a', grey) : spriteUrl(u.enemy!, undefined, grey);
}

interface Marker {
  el: HTMLElement;
  /** The slot it's in (a float while sliding) and the slide it's on. */
  x: number;
  from: number;
  to: number;
  start: number;
  /** What it shows, so it's only redrawn when that changes. */
  sig: string;
  lit: number;
  /** Seconds to its turn, as of `seen` (performance.now()). */
  in: number;
  leaving?: boolean;
}

const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * The fight's timeline (Grandia/FFX style): the next turns in a row, soonest on the left, each unit's sprite with the
 * card a hero will play on it (when it's theirs to show). When a pick changes the order, the turns it moves slide to their new places.
 */
export class TimelineStrip {
  readonly el = document.createElement('div');
  private track = document.createElement('div');
  private markers = new Map<string, Marker>();
  private last: TimelineTurnView[] | null = null;
  private room: number | null = null;
  private seen = 0;

  constructor() {
    this.el.className = 'cb-timeline';
    this.el.innerHTML = `<div class="tl-label" title="Who acts next, soonest on the left, if everyone does what they've picked (or their default: dashed). Your picks' hastes and delays show up here as you make them.">NEXT</div>`;
    this.track.className = 'tl-track';
    this.el.append(this.track);
  }

  /** Each frame: `enc` is the fight (null out of one), `youId` you. */
  update(enc: EncounterView | null, youId: string) {
    this.el.hidden = !enc;
    if (!enc) {
      this.clear();
      return;
    }
    if (enc.room !== this.room) {
      this.clear();
      this.room = enc.room;
    }
    const now = performance.now();
    if (enc.timeline !== this.last) {
      this.apply(enc, youId, now);
      this.last = enc.timeline;
      this.seen = now;
    }
    this.place(now);
  }

  private clear() {
    for (const m of this.markers.values()) m.el.remove();
    this.markers.clear();
    this.last = null;
    this.room = null;
  }

  private apply(enc: EncounterView, youId: string, now: number) {
    const units = new Map([...enc.heroes, ...enc.monsters, ...(enc.legion ?? []), ...(enc.risen ? [enc.risen] : [])].map((u) => [u.id, u]));
    // Whoever your next move is aimed at gets a gold outline wherever they are on the strip.
    const yourTarget = enc.timeline.find((t) => t.id === youId)?.target;
    const keys = enc.timeline.map((t) => `${t.id}#${t.n}`);
    const old = [...this.markers.entries()].filter(([, m]) => !m.leaving).sort((a, b) => a[1].to - b[1].to).map(([k]) => k);
    // Where each turn would be if nothing but the turns that have gone since changed: everything after them moves up.
    const gone = old.map((k) => !keys.includes(k));
    const expected = (k: string) => old.indexOf(k) - gone.slice(0, old.indexOf(k)).filter(Boolean).length;
    for (const [k, m] of this.markers) {
      if (keys.includes(k) || m.leaving) continue;
      m.leaving = true;
      // A turn that came slides off the front; one a pick pushed back out of sight slides off the far end.
      m.el.classList.add(m.to < 0.5 ? 'gone' : 'dropped');
      this.slide(m, m.to < 0.5 ? -1 : TIMELINE_TURNS, now);
      setTimeout(() => {
        m.el.remove();
        if (this.markers.get(k) === m) this.markers.delete(k);
      }, SLIDE_MS + 200);
    }
    enc.timeline.forEach((t, i) => {
      const k = keys[i];
      // Someone the forecast brings in (a summon, the raised dead) isn't on the stage yet: drawn from what it says.
      const u = units.get(t.id) ?? (t.unit ? { id: t.id, kind: t.unit.side, name: t.unit.name, enemy: t.unit.enemy, cls: t.unit.cls, hp: 1, maxHp: 1, st: {}, speed: 0, nextIn: null } as CombatUnitView : undefined);
      let m = this.markers.get(k);
      if (m?.leaving) {
        m.el.remove();
        m = undefined;
      }
      if (!m) {
        const el = document.createElement('div');
        // A turn coming into sight (moved up by a pick, or the next one along) slides in from beyond the far end.
        // The first time the strip fills, everything is just there.
        const at = this.last ? TIMELINE_TURNS : i;
        m = { el, x: at, from: at, to: at, start: now, sig: '', lit: this.last && i < keys.length - 1 ? now : 0, in: t.in };
        el.classList.add('new');
        requestAnimationFrame(() => el.classList.remove('new'));
        this.track.append(el);
        this.markers.set(k, m);
      } else if (Math.abs(m.to - i) > 1e-6) {
        // Moved further than the turns that came would explain: the order changed.
        if (i !== expected(k)) m.lit = now;
      }
      m.in = t.in;
      if (Math.abs(m.to - i) > 1e-6) this.slide(m, i, now);
      const sig = JSON.stringify([t, u?.downed, t.id === youId, yourTarget === t.id && t.id !== youId]);
      if (sig !== m.sig) {
        m.sig = sig;
        this.draw(m, t, u, youId, yourTarget, units);
      }
      m.el.classList.toggle('first', i === 0);
    });
  }

  private slide(m: Marker, to: number, now: number) {
    m.from = m.x;
    m.to = to;
    m.start = now;
  }

  private draw(m: Marker, t: TimelineTurnView, u: CombatUnitView | undefined, youId: string, yourTarget: string | undefined, units: Map<string, CombatUnitView>) {
    const side = u?.kind ?? (t.choice ? 'hero' : 'monster');
    const classes = ['tl-turn', side, t.id === youId ? 'you' : '', t.auto ? 'auto' : '', t.maybe ? 'maybe' : '', t.stunned ? 'stunned' : '',
      yourTarget === t.id && t.id !== youId ? 'aimed' : ''];
    // Keep what the animation has on it.
    const keep = ['lit', 'new', 'first'].filter((c) => m.el.classList.contains(c));
    m.el.className = [...classes, ...keep].filter(Boolean).join(' ');
    m.el.style.setProperty('--c', u?.kind === 'hero' ? u.color ?? '#888' : u?.kind === 'risen' ? '#8fa39a' : '#9a4a3a');
    const name = u?.name ?? '?';
    const target = t.target ? units.get(t.target) : undefined;
    const move = t.stunned ? 'stunned: skips this turn' : t.label ? `${t.auto ? 'default: ' : ''}${t.label}${target ? ` → ${t.target === t.id ? 'self' : target.name}` : ''}` : '';
    m.el.title = `${name}${move ? `: ${move}` : ''}${t.maybe ? ' (only if the dice go a certain way)' : ''}`;
    const badge = t.stunned ? icon('stun', 'Stunned: skips this turn') : this.badge(t, u);
    m.el.innerHTML = `<img src="${u ? unitSprite(u) : ''}" alt="" draggable="false">${badge ? `<span class="tl-move">${badge}</span>` : ''}${t.maybe ? '<span class="tl-maybe">?</span>' : ''}<span class="tl-in"></span>`;
  }

  /** What a hero's turn will be, small: the card's picture, an icon for Revive/Flee/Brace, an item's glyph. */
  private badge(t: TimelineTurnView, u: CombatUnitView | undefined): string {
    const c = t.choice;
    if (!c) return '';
    switch (c.action) {
      case 'card': return c.card ? `<img class="tl-card" src="${cardArtUrl(c.card, u?.cls ?? null)}" alt="">` : '';
      case 'item': return t.item ? ITEMS[t.item].glyph : '•';
      default: return icon(c.action, t.label ?? c.action);
    }
  }

  /** Every frame: slide what's moving, count the seconds down. */
  private place(now: number) {
    const w = this.track.clientWidth / TIMELINE_TURNS;
    const elapsed = (now - this.seen) / 1000;
    for (const m of this.markers.values()) {
      const p = Math.min(1, (now - m.start) / SLIDE_MS);
      m.x = m.from + (m.to - m.from) * ease(p);
      m.el.style.transform = `translateX(${(m.x * w).toFixed(1)}px)`;
      m.el.style.width = `${w}px`;
      m.el.classList.toggle('lit', now - m.lit < LIT_MS);
      const label = m.el.querySelector('.tl-in');
      // Server views come ten times a second; between them the countdown runs on by itself.
      if (label && !m.leaving) label.textContent = `${Math.max(0, m.in - Math.min(elapsed, 0.3)).toFixed(1)}s`;
    }
  }
}
