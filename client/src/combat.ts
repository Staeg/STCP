import {
  ABILITIES, ENEMIES, ROUND_TIME,
  type CombatAction, type CombatEvent, type CombatUnitView, type EncounterView, type PlayerView,
} from '@stcp/shared';
import type { Net } from './net';

const $ = (id: string) => document.getElementById(id)!;
const EVENT_STEP_MS = 320;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Pending {
  /** Damage/heal not yet "played" per unit, so HP bars change in step with the replay. */
  dmg: Map<string, number>;
  heal: Map<string, number>;
  /** Monsters that died this round, kept on screen until their death plays. */
  dying: Map<string, CombatUnitView>;
}

export class CombatUi {
  private targeting: CombatAction | null = null;
  private lastKey = '';
  private pending: Pending = { dmg: new Map(), heal: new Map(), dying: new Map() };
  private floaters: { unit: string; text: string; cls: string; at: number }[] = [];
  private flashes = new Map<string, number>();
  private prevMonsters = new Map<string, CombatUnitView>();
  private timers: number[] = [];
  private shownLog: string[] = [];
  private lastHtml = '';

  constructor(private net: Net) {
    // pointerdown, not click: the panel re-renders often and a click can straddle two renders.
    $('combat').addEventListener('pointerdown', (e) => this.onClick(e));
    addEventListener('keydown', (e) => this.onKey(e));
  }

  update(view: PlayerView | null) {
    const panel = $('combat');
    const enc = view?.encounter ?? null;
    if (!view || !enc) {
      panel.hidden = true;
      this.targeting = null;
      this.prevMonsters.clear();
      this.lastKey = '';
      this.shownLog = [];
      return;
    }
    if (this.shownLog.length === 0 && enc.log.length) this.shownLog = enc.log.slice(0, 1); // the "Ambush!" line
    panel.hidden = false;
    this.onNewResolution(enc);
    this.render(view, enc);
    for (const m of enc.monsters) this.prevMonsters.set(m.id, m);
  }

  // ---- Replay of a round's events ----

  private onNewResolution(enc: EncounterView) {
    const key = `${enc.room}:${enc.round}:${enc.phase}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (enc.phase === 'choosing') {
      this.targeting = null;
      return;
    }
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const p: Pending = { dmg: new Map(), heal: new Map(), dying: new Map() };
    const alive = new Set(enc.monsters.map((m) => m.id));
    for (const [id, m] of this.prevMonsters) if (!alive.has(id)) p.dying.set(id, { ...m, hp: 0 });
    for (const e of enc.events) {
      if (!e.target || e.amount === undefined) continue;
      if (e.kind === 'damage') p.dmg.set(e.target, (p.dmg.get(e.target) ?? 0) + e.amount);
      if (e.kind === 'heal') p.heal.set(e.target, (p.heal.get(e.target) ?? 0) + e.amount);
    }
    this.pending = p;
    enc.events.forEach((e, i) => this.timers.push(window.setTimeout(() => this.play(e), i * EVENT_STEP_MS)));
  }

  private play(e: CombatEvent) {
    const now = performance.now();
    this.flashes.set(e.actor, now);
    if (e.target && e.amount !== undefined) {
      if (e.kind === 'damage') this.pending.dmg.set(e.target, (this.pending.dmg.get(e.target) ?? 0) - e.amount);
      if (e.kind === 'heal') this.pending.heal.set(e.target, (this.pending.heal.get(e.target) ?? 0) - e.amount);
    }
    const t = e.target ?? e.actor;
    if (e.kind === 'damage') this.floaters.push({ unit: t, text: `${e.crit ? 'CRIT ' : ''}-${e.amount}`, cls: e.crit ? 'crit' : 'dmg', at: now });
    else if (e.kind === 'heal') this.floaters.push({ unit: t, text: `+${e.amount}`, cls: 'heal', at: now });
    else if (e.kind === 'miss') this.floaters.push({ unit: t, text: 'DODGE', cls: 'miss', at: now });
    else if (e.kind === 'stress' && e.amount) this.floaters.push({ unit: t, text: `+${e.amount} stress`, cls: 'stress', at: now });
    else if (e.kind === 'death') this.pending.dying.delete(t);
    else if (e.kind === 'down') this.floaters.push({ unit: t, text: 'DOWN', cls: 'crit', at: now });
    else if (e.kind === 'flee') this.floaters.push({ unit: t, text: 'FLED', cls: 'miss', at: now });
    this.shownLog.push(e.text);
    if (this.shownLog.length > 30) this.shownLog.shift();
  }

  private displayHp(u: CombatUnitView): number {
    const hp = u.hp + (this.pending.dmg.get(u.id) ?? 0) - (this.pending.heal.get(u.id) ?? 0);
    return Math.max(0, Math.min(u.maxHp, hp));
  }

  // ---- Rendering ----

  private render(view: PlayerView, enc: EncounterView) {
    const you = view.you;
    const me = enc.heroes.find((h) => h.id === you.id);
    const canAct = enc.phase === 'choosing' && !!me && !me.downed && !enc.youJoining;
    if (!canAct) this.targeting = null;
    const valid = this.targeting ? this.validTargets(view, enc, this.targeting) : [];

    // Header + timer
    const frac = enc.phase === 'choosing' ? enc.timeLeft / ROUND_TIME : 0;
    const waiting = enc.heroes.filter((h) => !h.ready && !h.joining).map((h) => h.name);
    let status: string;
    if (enc.phase === 'resolving') status = 'Resolving…';
    else if (enc.youJoining) status = 'You join the fight next round…';
    else if (me?.downed) status = 'You are down! An ally must revive you.';
    else if (this.targeting) status = 'Choose a target (Esc to cancel)';
    else if (enc.yourChoice) status = waiting.length ? `Locked in · waiting for ${waiting.join(', ')}` : 'Locked in';
    else status = 'Choose your action!';
    const header = `<div class="cb-head">
      <span>Round ${enc.round}</span>
      <span class="cb-status ${canAct && !enc.yourChoice ? 'urgent' : ''}">${esc(status)}</span>
      <span>${enc.phase === 'choosing' ? enc.timeLeft.toFixed(1) + 's' : ''}</span>
    </div>
    <div class="cb-timer"><div style="width:${(frac * 100).toFixed(1)}%" class="${frac < 0.4 ? 'low' : ''}"></div></div>`;

    // Stage: heroes back→front on the left, monsters front→back on the right.
    const heroes = [...enc.heroes].sort((a, b) => (a.rank === b.rank ? 0 : a.rank === 'back' ? -1 : 1));
    const monsters = [...enc.monsters, ...this.pending.dying.values()].sort((a, b) => (a.rank === b.rank ? 0 : a.rank === 'front' ? -1 : 1));
    const stage = `<div class="cb-stage">
      <div class="cb-side heroes">${heroes.map((u) => this.unitHtml(u, valid, you.id)).join('')}</div>
      <div class="cb-vs">⚔</div>
      <div class="cb-side monsters">${monsters.map((u) => this.unitHtml(u, valid, you.id)).join('')}</div>
    </div>`;

    // Action bar
    const abilities = ABILITIES[you.cls];
    const chosen = enc.yourChoice;
    const btn = (action: CombatAction, key: string, label: string, desc: string, cd = 0, disabled = false) => {
      const sel = chosen?.action === action || this.targeting === action;
      return `<button class="cb-act ${sel ? 'sel' : ''}" data-action="${action}" ${!canAct || cd > 0 || disabled ? 'disabled' : ''} title="${esc(desc)}">
        <kbd>${key}</kbd> ${esc(label)}${cd > 0 ? ` <span class="cd">${cd}</span>` : ''}
        <div class="cb-desc">${esc(desc)}</div></button>`;
    };
    const downedAllies = enc.heroes.filter((h) => h.downed);
    const actions = `<div class="cb-actions">
      ${abilities.map((ab, i) => btn(`a${i}` as CombatAction, String(i + 1), ab.name, ab.desc, you.cooldowns[ab.id] ?? 0)).join('')}
      ${btn('revive', 'R', 'Revive', 'Get a downed ally back up (30% HP).', 0, downedAllies.length === 0)}
      ${btn('flee', 'F', 'Flee', '70% chance to escape to the previous room. +5 stress.')}
      ${btn('brace', 'B', 'Brace', 'Take 30% less damage this round. (Automatic if time runs out.)')}
    </div>`;

    const log = `<div class="cb-log">${this.shownLog.slice(-7).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;

    const html = header + `<div class="cb-body">${stage}${log}</div>` + actions;
    if (html !== this.lastHtml) {
      $('combat').innerHTML = html;
      this.lastHtml = html;
    }
  }

  private unitHtml(u: CombatUnitView, valid: string[], youId: string): string {
    const now = performance.now();
    const hp = this.displayHp(u);
    const dying = this.pending.dying.has(u.id);
    const pct = (hp / u.maxHp) * 100;
    const flash = now - (this.flashes.get(u.id) ?? -1e9) < 260;
    const color = u.kind === 'hero' ? u.color : '#9a4a3a';
    const glyph = u.kind === 'hero' ? u.name.slice(0, 1).toUpperCase() : ENEMIES[u.enemy!].glyph;
    const st = u.st;
    const icons = [
      st.stun && '<span title="Stunned">★</span>',
      st.bleed && `<span title="Bleeding ${st.bleed.dmg}/round">🩸${st.bleed.rounds}</span>`,
      st.mark && '<span title="Marked">◎</span>',
      st.block && `<span title="Block">⛨${st.block}</span>`,
      st.weak && '<span title="Weakened">↓</span>',
      st.calm && '<span title="Calm: immune to stress">☾</span>',
      st.guardedBy && '<span title="Guarded">⛉</span>',
      st.brace && '<span title="Bracing">▣</span>',
    ].filter(Boolean).join('');
    const floats = this.floaters
      .filter((f) => f.unit === u.id && now - f.at < 1100)
      .map((f) => `<div class="float ${f.cls}" style="animation-delay:-${now - f.at}ms">${esc(f.text)}</div>`)
      .join('');
    const classes = ['cb-unit', u.kind, u.rank, valid.includes(u.id) ? 'targetable' : '', flash ? 'flash' : '', dying ? 'dying' : '',
      u.downed ? 'downed' : '', u.joining ? 'joining' : '', u.id === youId ? 'you' : ''].join(' ');
    const sub = u.downed ? `DOWN · ${Math.ceil(u.bleedOut ?? 0)}s` : u.joining ? 'joining…' : u.kind === 'hero' ? (u.ready ? '✔' : '…') : u.rank;
    return `<div class="${classes}" data-unit="${u.id}" style="--c:${color}">
      <div class="glyph">${glyph}</div>
      <div class="uname">${esc(u.name)}</div>
      <div class="hpbar"><div style="width:${pct}%"></div></div>
      <div class="hptext">${Math.ceil(hp)}/${u.maxHp}</div>
      <div class="icons">${icons}</div>
      <div class="sub">${esc(sub)}</div>
      ${floats}
    </div>`;
  }

  // ---- Input ----

  private validTargets(view: PlayerView, enc: EncounterView, action: CombatAction): string[] {
    const allies = enc.heroes.filter((h) => !h.downed);
    if (action === 'revive') return enc.heroes.filter((h) => h.downed).map((h) => h.id);
    const idx = Number(action.slice(1));
    const ab = ABILITIES[view.you.cls][idx];
    if (!ab) return [];
    const front = enc.monsters.filter((m) => m.rank === 'front');
    switch (ab.target) {
      case 'enemy': return enc.monsters.map((m) => m.id);
      case 'enemyFront': return (front.length ? front : enc.monsters).map((m) => m.id);
      case 'ally': return allies.map((a) => a.id);
      case 'otherAlly': return allies.filter((a) => a.id !== view.you.id).map((a) => a.id);
      default: return [];
    }
  }

  private needsTarget(view: PlayerView, action: CombatAction) {
    if (action === 'revive') return true;
    if (!action.startsWith('a')) return false;
    const ab = ABILITIES[view.you.cls][Number(action.slice(1))];
    return ['enemy', 'enemyFront', 'ally', 'otherAlly'].includes(ab.target);
  }

  private pick(action: CombatAction) {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc || enc.phase !== 'choosing') return;
    if (!this.needsTarget(view, action)) {
      this.targeting = null;
      this.net.intent({ type: 'combat', choice: { action } });
      return;
    }
    const targets = this.validTargets(view, enc, action);
    if (targets.length === 1) {
      this.targeting = null;
      this.net.intent({ type: 'combat', choice: { action, target: targets[0] } });
    } else if (targets.length > 1) {
      this.targeting = action;
    }
  }

  private onClick(e: Event) {
    const el = e.target as HTMLElement;
    const btn = el.closest('button[data-action]') as HTMLButtonElement | null;
    if (btn && this.canUse(btn.dataset.action as CombatAction)) return this.pick(btn.dataset.action as CombatAction);
    const unit = el.closest('[data-unit]') as HTMLElement | null;
    const view = this.net.cur;
    if (unit && this.targeting && view?.encounter && this.validTargets(view, view.encounter, this.targeting).includes(unit.dataset.unit!)) {
      this.net.intent({ type: 'combat', choice: { action: this.targeting, target: unit.dataset.unit } });
      this.targeting = null;
    }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.net.cur?.encounter || (e.target as HTMLElement).tagName === 'INPUT') return;
    const map: Record<string, CombatAction> = { Digit1: 'a0', Digit2: 'a1', Digit3: 'a2', KeyR: 'revive', KeyF: 'flee', KeyB: 'brace' };
    if (e.code === 'Escape') this.targeting = null;
    else if (map[e.code] && this.canUse(map[e.code])) this.pick(map[e.code]);
  }

  /** Decided from game state, not the DOM (which may lag a frame behind). */
  private canUse(action: CombatAction): boolean {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc || enc.phase !== 'choosing' || enc.youJoining) return false;
    const me = enc.heroes.find((h) => h.id === view.you.id);
    if (!me || me.downed) return false;
    if (action.startsWith('a')) {
      const ab = ABILITIES[view.you.cls][Number(action.slice(1))];
      if ((view.you.cooldowns[ab.id] ?? 0) > 0) return false;
    }
    if (action === 'revive') return enc.heroes.some((h) => h.downed);
    return true;
  }
}
