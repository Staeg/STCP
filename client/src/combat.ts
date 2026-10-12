import {
  abilitiesOf, FLEE_CHANCE, INSANITY, INSANITY_RULES, LEGENDS, legendsOf, STRESS, fieldSkillsOf, fmtSpeed, HOTKEY_ITEMS, ITEMS, readyAbilities,
  skillInfo, skillTarget, type CombatAction, type CombatEvent, type CombatUnitView, type EncounterView, type FieldSkill, type LegendId, type PlayerView,
} from '@stcp/shared';
import type { Net } from './net';
import { spriteUrl } from './render/sprites';
import { juice } from './juice';
import { itemName, useFromField } from './loot';
import { cooldownIcon, icon, iconize, iconNum, type IconId } from './icons';
import { statusIcons } from './statuses';
import { digitClaimed, digitKey } from './events';

const $ = (id: string) => document.getElementById(id)!;
/** Events from one turn play out this far apart; a busy fight queues them up. */
const EVENT_STEP_MS = 260;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Pending {
  /** Damage/heal not yet "played" per unit, so HP bars change in step with the replay. */
  dmg: Map<string, number>;
  heal: Map<string, number>;
  /** Monsters that have died, kept on screen until their death plays. */
  dying: Map<string, CombatUnitView>;
}

export class CombatUi {
  private targeting: CombatAction | null = null;
  /** Inventory slot being aimed, when targeting === 'item'. */
  private targetingItem: number | null = null;
  /** Fight (room) and the last event seq already queued for replay. */
  private seen: { room: number; seq: number } | null = null;
  /** When the replay queue runs dry (performance.now()). */
  private queueEnd = 0;
  private pending: Pending = { dmg: new Map(), heal: new Map(), dying: new Map() };
  /** `text` is HTML (fixed strings, numbers and icons). */
  private floaters: { unit: string; text: string; cls: string; at: number }[] = [];
  private flashes = new Map<string, number>();
  private prevMonsters = new Map<string, CombatUnitView>();
  /** Where each monster stood last render, so the slain stay in place until their death plays. */
  private prevSlot = new Map<string, number>();
  private timers: number[] = [];
  private shownLog: string[] = [];
  private lastHtml = '';
  /** Unit id → name, and unit id → colours of the heroes whose next move targets it. */
  private names = new Map<string, string>();
  /** Game time of the view being drawn (smoke runs out by the clock). */
  private time = 0;
  private aimedBy = new Map<string, string[]>();
  /** Your turn is close and you haven't picked: your ring turns red. */
  private hurry = false;
  /** Out of a fight: the action whose description was clicked open, so its icons can be hovered. */
  private pinned: string | null = null;
  /**
   * An ability waiting for its target: someone from the strip of names above the bar, or (`room`) a room clicked on
   * the map. A field skill out of a fight, or a Legendary ability in or out of one.
   */
  private aim: { skill: FieldSkill; legend: boolean; room: boolean } | null = null;
  private fighting = false;
  private pinTouched = false;

  constructor(private net: Net) {
    // pointerdown, not click: the panel re-renders often and a click can straddle two renders.
    $('combat').addEventListener('pointerdown', (e) => this.onClick(e));
    // Any click that didn't (re)pin a description lets go of the pinned one.
    document.addEventListener('pointerdown', () => {
      if (!this.pinTouched) this.pinned = null;
      this.pinTouched = false;
      this.applyPin();
    });
    addEventListener('keydown', (e) => this.onKey(e));
  }

  update(view: PlayerView | null) {
    const panel = $('combat');
    const enc = view?.encounter ?? null;
    // A fight starting or ending calls off whatever was being aimed.
    if (!!enc !== this.fighting) this.aim = null;
    this.fighting = !!enc;
    if (!view || !enc) {
      this.targeting = null;
      this.prevMonsters.clear();
      this.seen = null;
      this.shownLog = [];
      this.pending = { dmg: new Map(), heal: new Map(), dying: new Map() };
      panel.hidden = !view || view.phase !== 'running' || view.you.dead || view.you.extracted;
      panel.classList.add('idle');
      panel.classList.remove('aim-room');
      if (view && !panel.hidden) this.renderIdle(view);
      return;
    }
    if (this.shownLog.length === 0 && enc.log.length) this.shownLog = enc.log.slice(0, 1); // the "Ambush!" line
    panel.hidden = false;
    panel.classList.remove('idle');
    // Picking a room on the map: the fight stage folds away so the map shows.
    panel.classList.toggle('aim-room', !!this.aim?.room);
    this.onNewEvents(enc);
    this.render(view, enc);
    for (const m of enc.monsters) this.prevMonsters.set(m.id, m);
    if (enc.risen) this.prevMonsters.set(enc.risen.id, enc.risen);
    for (const r of enc.legion ?? []) this.prevMonsters.set(r.id, r);
  }

  // ---- Replay of each turn's events ----

  private onNewEvents(enc: EncounterView) {
    const latest = enc.events.length ? enc.events[enc.events.length - 1].seq ?? 0 : 0;
    // Joining a fight already under way: don't replay what happened before you got here.
    if (this.seen?.room !== enc.room) {
      this.seen = { room: enc.room, seq: latest };
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      return;
    }
    const fresh = enc.events.filter((e) => (e.seq ?? 0) > this.seen!.seq);
    this.seen.seq = latest;
    if (fresh.length === 0) return;
    const p = this.pending;
    for (const e of fresh) {
      // The slain stay on screen until their death plays.
      const m = e.kind === 'death' && e.target ? this.prevMonsters.get(e.target) : undefined;
      if (m) p.dying.set(m.id, { ...m, hp: 0, nextIn: null });
      if (!e.target || e.amount === undefined) continue;
      if (e.kind === 'damage') p.dmg.set(e.target, (p.dmg.get(e.target) ?? 0) + e.amount);
      if (e.kind === 'heal') p.heal.set(e.target, (p.heal.get(e.target) ?? 0) + e.amount);
    }
    const now = performance.now();
    const start = Math.max(now, this.queueEnd);
    fresh.forEach((e, i) => this.timers.push(window.setTimeout(() => this.play(e), start - now + i * EVENT_STEP_MS)));
    this.queueEnd = start + fresh.length * EVENT_STEP_MS;
  }

  private play(e: CombatEvent) {
    const now = performance.now();
    const youId = this.net.cur?.you.id;
    if (e.crit || e.kind === 'down' || e.kind === 'death') juice('shake');
    if (e.target === youId && (e.kind === 'damage' || e.kind === 'down') && (e.amount ?? 1) > 0) juice('hurt');
    this.flashes.set(e.actor, now);
    if (e.target && e.amount !== undefined) {
      if (e.kind === 'damage') this.pending.dmg.set(e.target, (this.pending.dmg.get(e.target) ?? 0) - e.amount);
      if (e.kind === 'heal') this.pending.heal.set(e.target, (this.pending.heal.get(e.target) ?? 0) - e.amount);
    }
    const t = e.target ?? e.actor;
    if (e.kind === 'damage') this.floaters.push({ unit: t, text: `${e.crit ? 'CRIT ' : ''}-${e.amount}`, cls: e.crit ? 'crit' : 'dmg', at: now });
    else if (e.kind === 'heal') this.floaters.push({ unit: t, text: `+${e.amount}`, cls: 'heal', at: now });
    else if (e.kind === 'miss') this.floaters.push({ unit: t, text: 'DODGE', cls: 'miss', at: now });
    else if (e.kind === 'stress' && e.amount) this.floaters.push({ unit: t, text: `+${e.amount}${icon('stress')}`, cls: 'stress', at: now });
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
    this.time = view.time;
    const you = view.you;
    const me = enc.heroes.find((h) => h.id === you.id);
    const canAct = !!me && !me.downed;
    if (!canAct) this.targeting = null;
    const valid = this.targeting ? this.validTargets(view, enc, this.targeting) : [];

    // Header: when your turn comes. The timers themselves are rings around each sprite.
    const left = me?.nextIn ?? null;
    let status: string;
    if (me?.downed) status = 'You are down! An ally must revive you.';
    else if (this.targeting) status = 'Choose a target (defaults to the leftmost)';
    else if (enc.yourChoice) status = `Next turn: ${me?.choice ?? 'ready'}. You can change it until then.`;
    else status = `Pick your next move! (defaults to ${this.fallbackName(view)})`;
    const header = `<div class="cb-head">
      <span>${me ? iconNum('speed', fmtSpeed(me.speed)) : ''}${enc.doom ? ` <span class="danger" title="The Lich's Doom on you: you take this much more from every blow, aura and poison. It holds while a Lich stands in your fight; otherwise it drops by 1 at the end of each of your turns, even after the fight.">☠ Doom +${enc.doom}</span>` : ''}</span>
      <span class="cb-status ${canAct && !enc.yourChoice ? 'urgent' : ''}">${esc(status)}</span>
      <span>${left !== null ? `your turn in ${left.toFixed(1)}s` : ''}</span>
    </div>`;
    this.hurry = canAct && !enc.yourChoice && left !== null && !!me && left / me.speed < 0.4;

    // Stage: heroes back→front on the left, monsters front→back on the right, in the server's order
    // (which is also who goes first when two turns come up at once).
    // Who's aiming at whom, so everyone can see the plan forming.
    this.names = new Map([...enc.heroes, ...enc.monsters].map((u) => [u.id, u.name]));
    this.aimedBy = new Map();
    for (const h of enc.heroes) {
      if (h.choiceTarget && h.choiceTarget !== h.id) (this.aimedBy.get(h.choiceTarget) ?? this.aimedBy.set(h.choiceTarget, []).get(h.choiceTarget)!).push(h.color!);
    }
    // The risen stand right of the heroes, nearest the enemy (and so take the hits).
    const legion = enc.legion ?? [];
    const dyingRisen = [...this.pending.dying.values()].filter((u) => u.kind === 'risen' && u.id !== enc.risen?.id && !legion.some((r) => r.id === u.id));
    const heroes = [...enc.heroes, ...legion, ...(enc.risen ? [enc.risen] : []), ...dyingRisen];
    const monsters = [...enc.monsters];
    for (const d of this.pending.dying.values()) {
      if (d.kind === 'monster') monsters.splice(Math.min(this.prevSlot.get(d.id) ?? monsters.length, monsters.length), 0, d);
    }
    this.prevSlot = new Map(monsters.map((m, i) => [m.id, i]));
    const stage = `<div class="cb-stage">
      <div class="cb-side heroes">${heroes.map((u) => this.unitHtml(u, valid, you.id)).join('')}</div>
      <div class="cb-vs">⚔</div>
      <div class="cb-side monsters">${monsters.map((u) => this.unitHtml(u, valid, you.id)).join('')}</div>
    </div>`;

    const log = `<div class="cb-log">${this.shownLog.slice(-7).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;

    const html = header + `<div class="cb-body">${stage}${log}</div>` + this.aimHtml(view) + this.actionsHtml(view, enc, canAct);
    this.setHtml(html);
  }

  /** Out of combat: the same action bar, greyed out, so you always know what you'll have to hand. */
  private renderIdle(view: PlayerView) {
    const items = this.itemsHtml(view, null, false);
    this.setHtml(`<div class="cb-group">
        <div class="cb-idle-head">Abilities <span class="muted">· bright ones work now too, as your turn · in a fight you default to your first one that's ready</span></div>
        ${this.aimHtml(view)}${this.actionsHtml(view, null, false)}
      </div>`
      + (items ? `<div class="cb-group items"><div class="cb-idle-head">Items <span class="muted">· usable now (as your turn), or in a fight</span></div>${items}</div>` : ''));
  }

  /** What the sim does for you if you don't pick: your first ability that's ready, or Brace if none is. */
  private fallbackName(view: PlayerView): string {
    const i = readyAbilities(view.you)[0];
    return i === undefined ? 'Brace' : abilitiesOf(view.you)[i].name;
  }

  private setHtml(html: string) {
    if (html !== this.lastHtml) {
      $('combat').innerHTML = html;
      this.lastHtml = html;
    }
    this.applyPin();
  }

  /** Which button an out-of-fight click pins: an ability or other action, or a pack item that can't be used now. */
  private static pinKey(el: HTMLElement): string | null {
    if (el.dataset.pin) return el.dataset.pin;
    if (el.dataset.action) return el.dataset.action;
    if (el.dataset.fieldItem !== undefined && !el.classList.contains('usable')) return `item${el.dataset.fieldItem}`;
    return null;
  }

  private applyPin() {
    const idle = $('combat').classList.contains('idle');
    if (!idle) this.pinned = null;
    for (const b of $('combat').querySelectorAll<HTMLElement>('button.cb-act')) b.classList.toggle('pinned', CombatUi.pinKey(b) === this.pinned && this.pinned !== null);
  }

  /**
   * Abilities, Revive/Flee/Brace and combat items. Everything is shown; what you can't use right now is disabled.
   * Out of combat the buttons are only greyed (not `disabled`), so hovering still shows what they do.
   */
  private actionsHtml(view: PlayerView, enc: EncounterView | null, canAct: boolean): string {
    const you = view.you;
    const abilities = abilitiesOf(you);
    const chosen = enc?.yourChoice ?? null;
    const off = (disabled: boolean) => (!disabled ? '' : enc ? 'disabled' : 'aria-disabled="true"');
    /** `desc` is HTML. Revive, Flee and Brace are just an icon (`body`), their name in the description. */
    const btn = (action: CombatAction, key: string, label: string, desc: string, cd = 0, disabled = false, body?: IconId) => {
      const sel = chosen?.action === action || this.targeting === action;
      return `<button class="cb-act ${body ? 'mini' : ''} ${sel ? 'sel' : ''}" data-action="${action}" ${off(!canAct || cd > 0 || disabled)}>
        <kbd>${key}</kbd> ${body ? icon(body, label) : esc(label)}${cd > 0 ? ` <span class="cd">${cooldownIcon(0, cd)}</span>` : ''}
        <div class="cb-desc">${body ? `<b>${esc(label)}</b>: ` : ''}${desc}</div></button>`;
    };
    const anyDowned = !!enc?.heroes.some((h) => h.downed);
    const ability = (i: number) => {
      const ab = abilities[i];
      const action = `a${i}` as CombatAction;
      const opt = enc?.yourOptions[action];
      const blocked = !!opt && (opt.blocked !== null || (this.needsTarget(view, action) && opt.targets.length === 0));
      // Cooldowns carry over between fights, so they show out of one too.
      const cd = you.cooldowns[ab.id] ?? 0;
      // The cooldown already says why; otherwise explain what's stopping it.
      const why = opt?.blocked && cd === 0 ? ` Not now: ${esc(opt.blocked)}` : '';
      const extra = ab.id === 'spade' && you.spadeBonus ? ` Now ${ab.power + you.spadeBonus} dmg.` : '';
      return btn(action, String(i + 1), ab.name, abilityDesc(ab.desc + extra, ab.cooldown, !!ab.field) + why, cd, blocked);
    };
    const actions = `<div class="cb-actions">
      ${enc ? abilities.map((_, i) => ability(i)).join('') : abilities.map((ab, i) => (ab.field ? this.fieldBtn(view, ab.id as FieldSkill, String(i + 1)) : ability(i))).join('')}
      ${this.extraBtns(view, enc, canAct)}
      ${!enc ? '' : `${btn('revive', 'R', 'Revive', iconize('Get a downed ally back up (30% HP).'), 0, !anyDowned, 'revive')}
      ${btn('flee', 'F', 'Flee', iconize(`${Math.round(FLEE_CHANCE * 100)}% chance to escape to the previous room (sure with Smoke). +${STRESS.flee} stress.`), 0, false, 'flee')}
      ${btn('brace', 'B', 'Brace', iconize('Take 30% less damage until your next turn. (Automatic if your turn comes while all your abilities are cooling down.)'), 0, false, 'brace')}`}
    </div>`;

    if (!enc) return actions;
    const items = this.itemsHtml(view, enc, canAct);
    return actions + items;
  }

  /** The Bellwright's Toll and Legendary abilities: after the class's three, in the same bar. */
  private extraBtns(view: PlayerView, enc: EncounterView | null, canAct: boolean): string {
    const you = view.you;
    const out: string[] = [];
    if (you.cls === 'bellwright') {
      out.push(enc ? this.greyBtn('toll', 'M', 'Toll', `${iconize(skillInfo(you, 'toll').desc)} Only out of a fight.`, you.cooldowns.toll ?? 0, false, true)
        : this.fieldBtn(view, 'toll', 'M'));
    }
    for (const l of legendsOf(you)) {
      const key = LEGEND_KEY;
      const def = LEGENDS[l];
      if (!enc) {
        out.push(def.field ? this.fieldBtn(view, l, key) : this.greyBtn(l, key, def.name, `${iconize(def.desc)} ${cooldownIcon(def.cooldown)} Only in a fight.`, you.cooldowns[l] ?? 0, true));
        continue;
      }
      if (!def.combat) {
        out.push(this.greyBtn(l, key, def.name, `${iconize(def.desc)} ${cooldownIcon(def.cooldown)} Only out of a fight.`, you.cooldowns[l] ?? 0, true, true));
        continue;
      }
      const cd = you.cooldowns[l] ?? 0;
      const opt = enc.legendOptions?.[l];
      const blocked = !canAct || cd > 0 || !!opt?.blocked;
      const sel = (enc.yourChoice?.action === 'legend' && enc.yourChoice.legend === l) || (this.aim?.legend && this.aim.skill === l);
      const why = opt?.blocked && cd === 0 ? ` Not now: ${esc(opt.blocked)}` : '';
      out.push(`<button class="cb-act legend ${sel ? 'sel' : ''}" data-legend="${l}" ${blocked ? 'disabled' : ''}>
        <kbd>${key}</kbd> ${esc(def.name)}${cd > 0 ? ` <span class="cd">${cooldownIcon(0, cd)}</span>` : ''}
        <div class="cb-desc">${iconize(def.desc)} ${cooldownIcon(def.cooldown)}${def.field ? ` ${icon('field')}` : ''}${why}</div></button>`);
    }
    return out.join('');
  }

  /** An action that can't be used here (in a fight, or out of one): greyed, its description on hover or click. */
  private greyBtn(pin: string, key: string, name: string, desc: string, cd: number, legend = false, fight = false): string {
    // In a fight it's just its key and name (what it does on hover), so the usable ones keep the room.
    return `<button class="cb-act ${legend ? 'legend' : ''} ${fight ? 'mini' : ''}" data-pin="${pin}" ${fight ? 'disabled' : 'aria-disabled="true"'}>
      <kbd>${key}</kbd> ${esc(name)}${cd > 0 && !fight ? ` <span class="cd">${cooldownIcon(0, cd)}</span>` : ''}
      <div class="cb-desc"><b>${esc(name)}</b>: ${desc}</div></button>`;
  }

  /**
   * Out of a fight, one button for an ability that works there (a field skill): bright when it's ready, used with a
   * click (as your turn), its cooldown on it. Targets are picked from a strip above the bar, or on the map.
   */
  private fieldBtn(view: PlayerView, skill: FieldSkill, key: string): string {
    const you = view.you;
    const legend = skill in LEGENDS;
    const info = skillInfo(you, skill);
    const cd = you.cooldowns[skill] ?? 0;
    const ab = abilitiesOf(you).find((a) => a.id === skill);
    const cooldown = legend ? LEGENDS[skill as LegendId].cooldown : skill === 'toll' ? 0 : ab?.cooldown ?? 0;
    const queued = you.queuedSkill?.skill === skill;
    const aiming = this.aim?.skill === skill;
    // The Toll is once a run (a Loom weaves it back).
    const rung = skill === 'toll' && you.tolled;
    const free = you.pos.kind === 'room' && you.downedAt === null && !you.dead && !rung;
    const inFights = legend ? LEGENDS[skill as LegendId].combat : !!ab;
    return `<button class="cb-act live ${legend ? 'legend' : ''} ${queued || aiming ? 'sel' : ''} ${cd > 0 || !free ? 'cooling' : ''}" data-skill="${skill}">
      <kbd>${key}</kbd> ${esc(info.name)}${cd > 0 ? ` <span class="cd">${cooldownIcon(0, cd)}</span>` : ''}${rung ? ' <span class="cd">rung</span>' : ''}
      <div class="cb-desc">${queued ? '✔ when your timer runs out. ' : ''}${iconize(info.desc)}${cooldown ? ` ${cooldownIcon(cooldown)}` : ''}${inFights ? ` ${icon('field')}` : ' Only out of a fight.'}</div></button>`;
  }

  /** Who an ability being aimed can go to, as name buttons (or a "click a room" note), above the bar. */
  private aimHtml(view: PlayerView): string {
    const aim = this.aim;
    if (!aim) return '';
    const name = skillInfo(view.you, aim.skill).name;
    const cancel = '<button class="aim-chip cancel" data-aim-cancel>✕ <kbd>Esc</kbd></button>';
    if (aim.room) return `<div class="cb-aim"><b>${esc(name)}</b>: click a room on the map. ${cancel}</div>`;
    const chips = this.aimTargets(view).map((t) => `<button class="aim-chip" data-aim-target="${t.id}">${t.label}</button>`).join('');
    return `<div class="cb-aim"><b>${esc(name)}</b> on: ${chips || '<span class="muted">nobody here</span>'} ${cancel}</div>`;
  }

  /** Who the ability being aimed can go to now (labels are HTML). */
  private aimTargets(view: PlayerView): { id: string; label: string }[] {
    const aim = this.aim;
    if (!aim) return [];
    const you = view.you;
    const enc = view.encounter;
    type Person = { id: string; name: string; hp: number; maxHp: number; stress?: number; downed?: boolean; dead: boolean };
    const label = (a: Person) => a.dead ? `${esc(a.name)} <span class="muted">dead</span>` : a.downed ? `${esc(a.name)} <span class="muted">down</span>`
      : `${a.id === you.id ? 'yourself' : esc(a.name)} <span class="muted">${icon('hp')}${Math.max(0, Math.ceil(a.hp))}/${a.maxHp}${a.stress !== undefined ? ` ${Math.round(a.stress)}${icon('stress')}` : ''}</span>`;
    const people: Person[] = [{ id: you.id, name: you.name, hp: you.hp, maxHp: you.maxHp, stress: you.stress, dead: you.dead }, ...view.allies];
    if (enc && aim.legend) {
      const ids = enc.legendOptions?.[aim.skill as LegendId]?.targets ?? [];
      return ids.flatMap((id) => people.filter((p) => p.id === id)).map((p) => ({ id: p.id, label: label(p) }));
    }
    const here = you.pos.kind === 'room' ? you.pos.room : -1;
    const kind = skillTarget(you, aim.skill);
    const inRoom = view.allies.filter((a) => a.live && !a.extracted && a.pos.kind === 'room' && a.pos.room === here);
    if (kind === 'fallen') return inRoom.filter((a) => a.downed || a.dead).map((a) => ({ id: a.id, label: label(a) }));
    let list: Person[] = [...(kind === 'any' ? [people[0]] : []), ...inRoom.filter((a) => !a.downed && !a.dead)];
    if (aim.skill === 'sins') list = list.filter((a) => (a.stress ?? 0) > 0);
    if (aim.skill === 'mend') list = list.filter((a) => a.hp < a.maxHp);
    return list.map((a) => ({ id: a.id, label: label(a) }));
  }

  /** Clicked (or its key pressed): a field skill out of a fight. Untargeted ones go at once; others want a target. */
  private useField(skill: FieldSkill) {
    const view = this.net.cur;
    if (!view || view.encounter) return;
    if ((view.you.cooldowns[skill] ?? 0) > 0) return;
    const kind = skillTarget(view.you, skill);
    if (kind === 'none') {
      this.aim = null;
      this.net.intent({ type: 'skill', skill });
      return;
    }
    this.aim = { skill, legend: skill in LEGENDS, room: kind === 'room' };
    if (kind === 'room') return;
    const targets = this.aimTargets(view);
    // Only one who it could be: no need to ask.
    if (targets.length === 1) this.aimAt(targets[0].id);
    else if (targets.length === 0) {
      this.aim = null;
      this.net.intent({ type: 'skill', skill }); // the server says why not
    }
  }

  /** A Legendary ability in a fight: picked now, done on your turn. */
  private pickLegend(l: LegendId) {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc) return;
    const opt = enc.legendOptions?.[l];
    if (!opt || opt.blocked || (view.you.cooldowns[l] ?? 0) > 0) return;
    this.targeting = null;
    const kind = LEGENDS[l].target;
    if (kind === 'none') {
      this.aim = null;
      this.net.intent({ type: 'combat', choice: { action: 'legend', legend: l } });
      return;
    }
    this.aim = { skill: l, legend: true, room: kind === 'room' };
    if (kind === 'room') return;
    if (opt.targets.length === 1) this.aimAt(opt.targets[0]);
  }

  /** The target of the ability being aimed was picked. */
  private aimAt(target: string) {
    const aim = this.aim;
    if (!aim) return;
    this.aim = null;
    if (this.net.cur?.encounter && aim.legend) this.net.intent({ type: 'combat', choice: { action: 'legend', legend: aim.skill as LegendId, target } });
    else this.net.intent({ type: 'skill', skill: aim.skill, target });
  }

  /** A room was clicked on the map: true if an ability was waiting for one (and took it), so the click isn't a walk. */
  pickRoom(room: number): boolean {
    const aim = this.aim;
    if (!aim?.room) return false;
    this.aim = null;
    if (this.net.cur?.encounter && aim.legend) this.net.intent({ type: 'combat', choice: { action: 'legend', legend: aim.skill as LegendId, room } });
    else this.net.intent({ type: 'skill', skill: aim.skill, room });
    return true;
  }

  /** Waiting for a room to be clicked: the ability's name (the map says so by the pointer). */
  get pickingRoom(): string | null {
    const view = this.net.cur;
    return this.aim?.room && view ? skillInfo(view.you, this.aim.skill).name : null;
  }

  /**
   * Usable pack items. In a fight they're combat actions; out of one, those that work while exploring
   * can be clicked right here (the rest are greyed, like the combat bar).
   */
  private itemsHtml(view: PlayerView, enc: EncounterView | null, canAct: boolean): string {
    // Gem Rite: no consumables at all, so no Items panel either.
    if (view.you.rites?.includes('gem')) return '';
    const chosen = enc?.yourChoice ?? null;
    const elixir = view.you.elixir ? '<span class="elixir" title="Elixir: your next item has double effect.">⚗×2</span>' : '';
    const btns = elixir + view.you.items.map((it, i) => {
      const def = ITEMS[it];
      if (!def.combat && !def.field) return '';
      if (!enc) {
        const usable = def.field;
        // Out of a fight an item is your turn: it happens when your timer runs out.
        const queued = view.you.queuedItem?.index === i && view.you.queuedItem.item === it;
        return `<button class="cb-act item ${usable ? 'usable' : ''} ${queued ? 'sel' : ''}" data-field-item="${i}" ${usable ? '' : 'aria-disabled="true"'}>
          <span class="cb-label">${i < HOTKEY_ITEMS ? `<kbd>${i + 4}</kbd> ` : ''}${def.glyph} ${itemName(it)}</span><div class="cb-desc">${queued ? '✔ when your timer runs out. ' : ''}${iconize(def.desc)}${usable ? '' : ' Only in a fight.'}</div></button>`;
      }
      if (!def.combat) return '';
      const sel = (chosen?.action === 'item' && chosen.item === i) || (this.targeting === 'item' && this.targetingItem === i);
      return `<button class="cb-act item ${sel ? 'sel' : ''}" data-action="item" data-item="${i}" ${canAct ? '' : 'disabled'}>
        <span class="cb-label">${i < HOTKEY_ITEMS ? `<kbd>${i + 4}</kbd> ` : ''}${def.glyph} ${itemName(it)}</span><div class="cb-desc">${iconize(def.desc)}</div></button>`;
    }).filter(Boolean).join('');
    return btns ? `<div class="cb-actions items">${btns}</div>` : '';
  }

  private unitHtml(u: CombatUnitView, valid: string[], youId: string): string {
    const now = performance.now();
    const hp = this.displayHp(u);
    const dying = this.pending.dying.has(u.id);
    const pct = (hp / u.maxHp) * 100;
    const flash = now - (this.flashes.get(u.id) ?? -1e9) < 260;
    const color = u.kind === 'hero' ? u.color : u.kind === 'risen' ? '#8fa39a' : '#9a4a3a';
    // A Risen ally is its class's sprite in the colour of the dead.
    const img = u.kind === 'hero' ? spriteUrl(u.cls!, u.color, u.downed)
      : u.cls ? spriteUrl(u.cls, '#8fa39a', dying) : spriteUrl(u.enemy!, undefined, dying);
    const st = u.st;
    const time = this.time;
    const sym = (glyph: string, tip: string) => `<span title="${esc(tip)}">${glyph}</span>`;
    const icons = [
      u.insane && sym('😱', `${INSANITY.name}: ${INSANITY.desc} ${INSANITY_RULES}`),
      u.kind === 'hero' && (u.stress ?? 0) > 0 && iconNum('stress', u.stress!, `Stress ${u.stress}/100.`),
      u.kind === 'monster' && !st.acted && sym('◌', "Hasn't acted yet: Backstab crits it for double damage."),
      ...statusIcons(st, time),
    ].filter(Boolean).join('');
    const floats = this.floaters
      .filter((f) => f.unit === u.id && now - f.at < 1100)
      .map((f) => `<div class="float ${f.cls}" style="animation-delay:-${now - f.at}ms">${f.text}</div>`)
      .join('');
    const classes = ['cb-unit', u.kind, valid.includes(u.id) ? 'targetable' : '', flash ? 'flash' : '', dying ? 'dying' : '',
      u.downed ? 'downed' : '', u.id === youId ? 'you' : ''].join(' ');
    const sub = u.downed ? `DOWN · ${Math.ceil(u.dying ?? 0)}s`
      : u.kind === 'hero' ? (u.choice ? '' : 'choosing…')
      : u.enemy === 'wolf' ? 'wolf · runs with you' : u.kind === 'risen' ? (u.turnsLeft === undefined ? 'risen · for good' : `risen · ${u.turnsLeft} turn${u.turnsLeft === 1 ? '' : 's'} left`) : '';
    // Speed timer: a ring round the sprite (like on the map) that fills up as their turn approaches.
    const timed = u.nextIn !== null && !dying;
    const fill = timed ? Math.max(0, Math.min(1, 1 - u.nextIn! / u.speed)) : 0;
    const ringColor = u.id === youId && this.hurry ? 'var(--danger)' : color;
    const ring = timed
      ? `<svg class="turnring ${u.id === youId ? 'mine' : ''}" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" class="track"/>
          <circle cx="50" cy="50" r="46" pathLength="100" stroke="${ringColor}" stroke-dasharray="${(fill * 100).toFixed(1)} 100"/></svg>`
      : '';
    const turn = timed
      ? `<div class="spd">${iconNum('speed', fmtSpeed(u.speed), `Speed ${fmtSpeed(u.speed)}: acts every ${fmtSpeed(u.speed)} · next turn in ${u.nextIn!.toFixed(1)}s`)} · ${u.nextIn!.toFixed(1)}s</div>`
      : '';
    const target = u.choiceTarget ? this.names.get(u.choiceTarget) : undefined;
    const pick = u.kind === 'hero' && u.choice
      ? `<div class="pick" title="${esc(u.choice + (target ? ` → ${target}` : ''))}">✔ ${esc(u.choice)}${target ? `<br>→ ${esc(u.choiceTarget === u.id ? 'self' : target)}` : ''}</div>`
      : '';
    const aimed = (this.aimedBy.get(u.id) ?? []).map((c) => `<span style="color:${c}">◆</span>`).join('');
    return `<div class="${classes}" data-unit="${u.id}" style="--c:${color}">
      <div class="sprite-wrap"><img class="sprite" src="${img}" alt="" draggable="false">${ring}</div>
      <div class="uname">${esc(u.name)}</div>
      <div class="hpbar"><div style="width:${pct}%"></div></div>
      <div class="hptext">${Math.ceil(hp)}/${u.maxHp}</div>
      ${turn}
      <div class="icons">${icons}</div>
      ${pick}${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      ${aimed ? `<div class="aimed" title="Targeted by an ally's next move">${aimed}</div>` : ''}
      ${floats}
    </div>`;
  }

  // ---- Input ----

  private validTargets(view: PlayerView, enc: EncounterView, action: CombatAction): string[] {
    const allies = enc.heroes.filter((h) => !h.downed);
    if (action === 'revive') return enc.heroes.filter((h) => h.downed).map((h) => h.id);
    if (action === 'item') {
      const def = ITEMS[view.you.items[this.targetingItem ?? -1]];
      if (!def) return [];
      if (def.target === 'ally') return allies.map((a) => a.id);
      if (def.target === 'downed') return enc.heroes.filter((h) => h.downed).map((h) => h.id);
      return [];
    }
    // Abilities: the server says who each can be aimed at.
    return enc.yourOptions[action]?.targets ?? [];
  }

  private needsTarget(view: PlayerView, action: CombatAction) {
    if (action === 'revive') return true;
    if (action === 'item') {
      const def = ITEMS[view.you.items[this.targetingItem ?? -1]];
      return !!def && (def.target === 'ally' || def.target === 'downed');
    }
    if (!action.startsWith('a')) return false;
    const ab = abilitiesOf(view.you)[Number(action.slice(1))];
    return ['enemy', 'enemyFirst', 'damagedEnemy', 'ally', 'otherAlly'].includes(ab.target);
  }

  private pick(action: CombatAction, item?: number) {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc) return;
    this.targetingItem = action === 'item' ? item ?? null : null;
    if (!this.needsTarget(view, action)) {
      this.targeting = null;
      this.net.intent({ type: 'combat', choice: { action, item } });
      return;
    }
    const targets = this.validTargets(view, enc, action);
    if (targets.length === 1) {
      this.targeting = null;
      this.net.intent({ type: 'combat', choice: { action, target: targets[0], item } });
    } else if (targets.length > 1) {
      // Lock the move in now; if the turn comes before a target is clicked, it goes to the leftmost one.
      this.targeting = action;
      this.net.intent({ type: 'combat', choice: { action, item } });
    }
  }

  private onClick(e: Event) {
    const el = e.target as HTMLElement;
    const chip = el.closest('button.aim-chip') as HTMLElement | null;
    if (chip) {
      if (chip.dataset.aimCancel !== undefined) this.aim = null;
      else if (chip.dataset.aimTarget) this.aimAt(chip.dataset.aimTarget);
      return;
    }
    const live = el.closest('button[data-skill]') as HTMLElement | null;
    if (live) {
      if (!live.classList.contains('cooling')) this.useField(live.dataset.skill as FieldSkill);
      return;
    }
    const leg = el.closest('button[data-legend]') as HTMLButtonElement | null;
    if (leg) {
      if (!leg.disabled) this.pickLegend(leg.dataset.legend as LegendId);
      return;
    }
    // Exploring: clicking a greyed action keeps its description open (click it again, or anywhere, to close).
    const pinBtn = !this.net.cur?.encounter ? (el.closest('button.cb-act') as HTMLElement | null) : null;
    const key = pinBtn && CombatUi.pinKey(pinBtn);
    if (key) {
      this.pinned = this.pinned === key ? null : key;
      this.pinTouched = true;
      this.applyPin();
      return;
    }
    const field = el.closest('button[data-field-item]') as HTMLButtonElement | null;
    if (field) {
      if (!this.net.cur?.encounter && field.classList.contains('usable')) useFromField(this.net, Number(field.dataset.fieldItem));
      return;
    }
    const btn = el.closest('button[data-action]') as HTMLButtonElement | null;
    if (btn) {
      const action = btn.dataset.action as CombatAction;
      const item = btn.dataset.item !== undefined ? Number(btn.dataset.item) : undefined;
      if (this.canUse(action, item)) this.pick(action, item);
      return;
    }
    const unit = el.closest('[data-unit]') as HTMLElement | null;
    const view = this.net.cur;
    if (unit && this.targeting && view?.encounter && this.validTargets(view, view.encounter, this.targeting).includes(unit.dataset.unit!)) {
      this.net.intent({ type: 'combat', choice: { action: this.targeting, target: unit.dataset.unit, item: this.targetingItem ?? undefined } });
      this.targeting = null;
    }
  }

  private onKey(e: KeyboardEvent) {
    const view = this.net.cur;
    if (!view || (e.target as HTMLElement).tagName === 'INPUT' || e.repeat) return;
    if (e.code === 'Escape' && this.aim) {
      this.aim = null;
      e.stopImmediatePropagation();
      return;
    }
    if (view.phase !== 'running' || view.you.dead || view.you.extracted) return;
    // Your Legendary's ability is on Q, in a fight or out.
    const l = e.code === `Key${LEGEND_KEY}` ? legendsOf(view.you)[0] : undefined;
    if (l) {
      if (view.encounter) this.pickLegend(l);
      else if (LEGENDS[l].field) this.useField(l);
      return;
    }
    if (!view.encounter) {
      // Out of a fight, your abilities keep their keys (1–3) unless an event or a loot vote is using that number; M tolls.
      const digit = digitKey(e.code);
      const ab = digit !== null && digit < 3 && !digitClaimed(view, digit) ? abilitiesOf(view.you)[digit] : undefined;
      if (ab?.field) this.useField(ab.id as FieldSkill);
      if (e.code === 'KeyM' && fieldSkillsOf(view.you).includes('toll')) this.useField('toll');
      return;
    }
    const map: Record<string, CombatAction> = { Digit1: 'a0', Digit2: 'a1', Digit3: 'a2', KeyR: 'revive', KeyF: 'flee', KeyB: 'brace' };
    const slot = ['Digit4', 'Digit5', 'Digit6', 'Digit7'].slice(0, HOTKEY_ITEMS).indexOf(e.code);
    if (e.code === 'Escape') this.targeting = null;
    else if (slot >= 0 && this.canUse('item', slot)) this.pick('item', slot);
    else if (map[e.code] && this.canUse(map[e.code])) this.pick(map[e.code]);
  }

  /** Decided from game state, not the DOM (which may lag a frame behind). */
  private canUse(action: CombatAction, item?: number): boolean {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc) return false;
    const me = enc.heroes.find((h) => h.id === view.you.id);
    if (!me || me.downed) return false;
    if (action.startsWith('a')) {
      const ab = abilitiesOf(view.you)[Number(action.slice(1))];
      if ((view.you.cooldowns[ab.id] ?? 0) > 0) return false;
      const opt = enc.yourOptions[action];
      if (opt?.blocked || (this.needsTarget(view, action) && !opt?.targets.length)) return false;
    }
    if (action === 'revive') return enc.heroes.some((h) => h.downed);
    if (action === 'item') {
      const def = ITEMS[view.you.items[item ?? -1]];
      if (!def?.combat) return false;
      if (def.target === 'downed') return enc.heroes.some((h) => h.downed);
    }
    return true;
  }
}

/** Your Legendary's ability (you can wear only one) is on this key. */
const LEGEND_KEY = 'Q';

/** Ability text (HTML) with icons for its cooldown and whether it works outside fights. */
function abilityDesc(desc: string, cooldown: number, field: boolean): string {
  return iconize(desc) + (cooldown ? ` ${cooldownIcon(cooldown)}` : '') + (field ? ` ${icon('field')}` : '');
}
