import {
  CARD_RULES, CARDS, cardSource, deckList, FLEE_CHANCE, handSize, INSANITY, INSANITY_RULES, SCHOOLS, STRESS, fieldSkillsOf, fmtSpeed, HOTKEY_ITEMS, ITEMS,
  skillInfo, type CardId, type CardView, type ClassId, type CombatAction, type CombatEvent, type CombatUnitView, type EncounterView, type PlayerView,
} from '@stcp/shared';
import type { Net } from './net';
import { spriteUrl } from './render/sprites';
import { cardArtUrl, cardFrameColor } from './render/card-art';
import { juice } from './juice';
import { itemName, useFromField } from './loot';
import { icon, iconize, iconNum, type IconId } from './icons';
import { statusIcons } from './statuses';
import { digitKey } from './events';

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
  /** The card being aimed, when targeting === 'card'. */
  private targetingCard: CardId | null = null;
  /** A card waiting for a room to be clicked on the map (Waystep). */
  private aimRoom: CardId | null = null;
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
  /** Out of a fight: the card or action whose description was clicked open, so its icons can be hovered. */
  private pinned: string | null = null;
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
    if (!!enc !== this.fighting) this.aimRoom = null;
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
    panel.classList.toggle('aim-room', !!this.aimRoom);
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
    else if (this.aimRoom) status = `${CARDS[this.aimRoom].name}: click a room on the map.`;
    else if (this.targeting) status = 'Choose a target (defaults to the leftmost)';
    else if (enc.yourChoice) status = `Next: ${me?.choice ?? 'ready'}. You can change it until then.`;
    else status = `Pick your next card! (defaults to ${this.fallbackName(enc)})`;
    const header = `<div class="cb-head">
      <span>${me ? iconNum('speed', fmtSpeed(me.speed), `This wait: ${fmtSpeed(me.speed)} (what your last card took)`) : ''}${enc.doom ? ` <span class="danger" title="The Lich's Doom on you: you take this much more from every blow, aura and poison. It holds while a Lich stands in your fight; otherwise it drops by 1 at the end of each of your turns, even after the fight.">☠ Doom +${enc.doom}</span>` : ''}</span>
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

    const html = header + `<div class="cb-body">${stage}${log}</div>` + this.actionsHtml(view, enc, canAct);
    this.setHtml(html);
  }

  /** Out of combat: your deck (greyed, to read) and the Toll, then the pack items that work while exploring. */
  private renderIdle(view: PlayerView) {
    const items = this.itemsHtml(view, null, false);
    this.setHtml(`<div class="cb-group">
        <div class="cb-idle-head">Your deck <span class="muted">· a fight deals you ${handSize(view.you)} of these; each card says how long until your next action</span></div>
        ${this.deckHtml(view)}
      </div>`
      + (items ? `<div class="cb-group items"><div class="cb-idle-head">Items <span class="muted">· usable now (as your turn), or in a fight</span></div>${items}</div>` : ''));
  }

  /** What the sim plays for you if you don't pick: your leftmost card that isn't a Burn (and would do something). */
  private fallbackName(enc: EncounterView): string {
    const hand = enc.yourHand;
    const plain = (c: CardView) => !CARDS[c.card].burn && CARDS[c.card].target !== 'room';
    const c = hand.find((x) => plain(x) && !x.weak) ?? hand.find(plain) ?? hand[0];
    return c ? CARDS[c.card].name : 'Brace';
  }

  private setHtml(html: string) {
    if (html !== this.lastHtml) {
      $('combat').innerHTML = html;
      this.lastHtml = html;
    }
    this.applyPin();
  }

  /** Which button an out-of-fight click pins: a card or other action, or a pack item that can't be used now. */
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

  /** A card's face: its picture, name, its time, school icons and 🔥 for a Burn. `time` is what it would take you now. */
  private static cardFace(card: CardId, time: number, cls: ClassId): string {
    const def = CARDS[card];
    const schools = def.schools.map((s) => `<span title="${SCHOOLS[s].name}: ${esc(SCHOOLS[s].desc)}">${SCHOOLS[s].glyph}</span>`).join('');
    return `<img class="card-art" src="${cardArtUrl(card, cls)}" alt="">${esc(def.name)} <span class="cd-time">${fmtSpeed(time)}</span><span class="schools">${schools}</span>${def.burn ? '<span class="burn" title="Burn: gone for the rest of the run once played (a Loom brings it back).">🔥</span>' : ''}`;
  }

  /** A card button's frame: the class colour for class cards, the Gear's tier colour for the rest. */
  private static cardFrame(card: CardId, cls: ClassId): string {
    return `${cardSource(card) === 'class' ? 'from-class' : 'from-gear'}" style="--frame:${cardFrameColor(card, cls)}`;
  }

  /** A card's text, for its hover box. */
  private static cardDesc(card: CardId, time: number, extra = ''): string {
    const def = CARDS[card];
    const schools = def.schools.map((s) => SCHOOLS[s].name).join(', ');
    const from = cardSource(card) === 'class' ? 'Class card' : card === 'fumble' ? 'Empty Gear slot' : 'Gear card';
    return `<b>${esc(def.name)}</b> · ${fmtSpeed(time)} until your next action${schools ? ` · ${schools}` : ''}${def.burn ? ' · <b>Burn</b>' : ''} · <span class="muted">${from}</span><br>${iconize(def.desc)}${extra}`;
  }

  /**
   * In a fight: your hand of cards (keys 1–4), then Revive/Flee/Brace and the Toll, then combat items.
   * What you can't use right now is disabled; a card that would do nothing useful is dimmed (it still plays).
   */
  private actionsHtml(view: PlayerView, enc: EncounterView, canAct: boolean): string {
    const you = view.you;
    const chosen = enc.yourChoice;
    /** `desc` is HTML. Revive, Flee and Brace are just an icon (`body`), their name in the description. */
    const btn = (action: CombatAction, key: string, label: string, desc: string, disabled = false, body?: IconId) => {
      const sel = chosen?.action === action || this.targeting === action;
      return `<button class="cb-act ${body ? 'mini' : ''} ${sel ? 'sel' : ''}" data-action="${action}" ${!canAct || disabled ? 'disabled' : ''}>
        <kbd>${key}</kbd> ${body ? icon(body, label) : esc(label)}
        <div class="cb-desc">${body ? `<b>${esc(label)}</b>: ` : ''}${desc}</div></button>`;
    };
    const cards = enc.yourHand.map((c, i) => {
      const sel = (chosen?.action === 'card' && chosen.card === c.card) || (this.targeting === 'card' && this.targetingCard === c.card) || this.aimRoom === c.card;
      const why = c.weak ? `<br><span class="muted">Now: ${esc(c.weak)}</span>` : '';
      return `<button class="cb-act cb-card ${sel ? 'sel' : ''} ${c.weak ? 'weak' : ''} ${CARDS[c.card].burn ? 'burning' : ''} ${CombatUi.cardFrame(c.card, you.cls)}" data-card="${c.card}" ${canAct ? '' : 'disabled'}>
        <kbd>${i + 1}</kbd> ${CombatUi.cardFace(c.card, c.time, you.cls)}
        <div class="cb-desc">${CombatUi.cardDesc(c.card, c.time, why)}</div></button>`;
    }).join('');
    const burned = enc.burned.map((c) => CARDS[c].name).join(', ');
    const pile = `<span class="cb-deck" title="${esc(`Draw pile ${enc.deckCount} · discard ${enc.discardCount}${burned ? ` · burned: ${burned}` : ''}. The discard is shuffled back in when the draw pile runs out, and every fight starts from a full shuffle.`)}">🂠 ${enc.deckCount} · ♻ ${enc.discardCount}${enc.burned.length ? ` · 🔥 ${enc.burned.length}` : ''}${enc.corpses ? ` · ⚰ ${enc.corpses}` : ''}</span>`;
    const toll = you.cls === 'bellwright' ? this.greyBtn('toll', 'M', 'Toll', `${iconize(skillInfo(you, 'toll').desc)} Only out of a fight.`, true) : '';
    const actions = `<div class="cb-actions hand">${cards}${pile}</div>
      <div class="cb-actions basics">
      ${btn('revive', 'R', 'Revive', iconize(`Get a downed ally back up (30% HP). ${CARD_RULES.reviveTime}s.`), !enc.reviveTargets.length, 'revive')}
      ${btn('flee', 'F', 'Flee', iconize(`${Math.round(FLEE_CHANCE * 100)}% chance to escape to the previous room (sure with Smoke). +${STRESS.flee} stress. ${CARD_RULES.fleeTime}s.`), false, 'flee')}
      ${btn('brace', 'B', 'Brace', iconize(`Take 30% less damage until your next action. ${CARD_RULES.braceTime}s.`), false, 'brace')}
      ${toll}
    </div>`;
    return actions + this.itemsHtml(view, enc, canAct);
  }

  /** Out of a fight: every card in your deck, greyed (hover or click to read), burned ones struck through; then the Toll. */
  private deckHtml(view: PlayerView): string {
    const you = view.you;
    const left = [...you.burned];
    const cards = deckList(you).map((c, i) => {
      const b = left.indexOf(c);
      const burned = b >= 0;
      if (burned) left.splice(b, 1);
      return `<button class="cb-act cb-card ${burned ? 'burned' : ''} ${CARDS[c].burn ? 'burning' : ''} ${CombatUi.cardFrame(c, you.cls)}" data-pin="card${i}" aria-disabled="true">
        ${CombatUi.cardFace(c, CARDS[c].time, you.cls)}
        <div class="cb-desc">${CombatUi.cardDesc(c, CARDS[c].time, burned ? '<br><span class="muted">Burned this run.</span>' : '')}</div></button>`;
    }).join('');
    return `<div class="cb-actions deck">${cards}${you.cls === 'bellwright' ? this.tollBtn(view) : ''}</div>`;
  }

  /** An action that can't be used here (in a fight, or out of one): greyed, its description on hover or click. */
  private greyBtn(pin: string, key: string, name: string, desc: string, fight = false): string {
    // In a fight it's just its key and name (what it does on hover), so the usable ones keep the room.
    return `<button class="cb-act ${fight ? 'mini' : ''}" data-pin="${pin}" ${fight ? 'disabled' : 'aria-disabled="true"'}>
      <kbd>${key}</kbd> ${esc(name)}
      <div class="cb-desc"><b>${esc(name)}</b>: ${desc}</div></button>`;
  }

  /** Out of a fight, the Bellwright's Toll (once a run): bright when it can be rung, used with a click as your turn. */
  private tollBtn(view: PlayerView): string {
    const you = view.you;
    const info = skillInfo(you, 'toll');
    const queued = you.queuedSkill?.skill === 'toll';
    const rung = you.tolled;
    const free = you.pos.kind === 'room' && you.downedAt === null && !you.dead && !rung;
    return `<button class="cb-act live ${queued ? 'sel' : ''} ${!free ? 'cooling' : ''}" data-skill="toll">
      <kbd>M</kbd> ${esc(info.name)}${rung ? ' <span class="cd">rung</span>' : ''}
      <div class="cb-desc">${queued ? '✔ when your timer runs out. ' : ''}${iconize(info.desc)} Only out of a fight.</div></button>`;
  }

  /** The Toll, clicked or M pressed out of a fight. */
  private useToll() {
    const view = this.net.cur;
    if (!view || view.encounter || view.you.tolled || !fieldSkillsOf(view.you).includes('toll')) return;
    this.net.intent({ type: 'skill', skill: 'toll' });
  }

  /** A room was clicked on the map: true if a card was waiting for one (Waystep), so the click isn't a walk. */
  pickRoom(room: number): boolean {
    const card = this.aimRoom;
    if (!card) return false;
    this.aimRoom = null;
    if (this.net.cur?.encounter) this.net.intent({ type: 'combat', choice: { action: 'card', card, room } });
    return true;
  }

  /** Waiting for a room to be clicked: the card's name (the map says so by the pointer). */
  get pickingRoom(): string | null {
    return this.aimRoom ? CARDS[this.aimRoom].name : null;
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
    // In a fight the item keys come after the cards (4–7 with a hand of three); out of one they're 4–7.
    const base = Math.max(3, enc?.yourHand.length ?? 3);
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
        <span class="cb-label">${i < HOTKEY_ITEMS ? `<kbd>${i + base + 1}</kbd> ` : ''}${def.glyph} ${itemName(it)}</span><div class="cb-desc">${iconize(def.desc)}</div></button>`;
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
      u.carry && sym(ITEMS[u.carry].glyph, `Carrying ${ITEMS[u.carry].name}: ${ITEMS[u.carry].desc} Dropped when it falls.`),
      u.kind === 'monster' && !st.acted && sym('◌', "Hasn't acted yet: Backstab crits it for double damage."),
      ...statusIcons(st, time),
    ].filter(Boolean).join('');
    const floats = this.floaters
      .filter((f) => f.unit === u.id && now - f.at < 1100)
      .map((f) => `<div class="float ${f.cls}" style="animation-delay:-${now - f.at}ms">${f.text}</div>`)
      .join('');
    const classes = ['cb-unit', u.kind, valid.includes(u.id) ? 'targetable' : '', flash ? 'flash' : '', dying ? 'dying' : '',
      u.downed ? 'downed' : '', u.id === youId ? 'you' : ''].join(' ');
    const summoned = u.enemy === 'rat' || u.enemy === 'shade' || u.enemy === 'imp';
    const sub = u.downed ? `DOWN · ${Math.ceil(u.dying ?? 0)}s`
      : u.kind === 'hero' ? (u.choice ? '' : 'choosing…')
      : u.enemy === 'wolf' ? 'wolf · runs with you'
      : summoned ? 'summoned · this fight'
      : u.kind === 'risen' ? (u.turnsLeft === undefined ? 'risen · for good' : `risen · ${u.turnsLeft} turn${u.turnsLeft === 1 ? '' : 's'} left`) : '';
    // Turn timer: a ring round the sprite (like on the map) that fills up as their next action approaches.
    const timed = u.nextIn !== null && !dying;
    const fill = timed ? Math.max(0, Math.min(1, 1 - u.nextIn! / u.speed)) : 0;
    const ringColor = u.id === youId && this.hurry ? 'var(--danger)' : color;
    const ring = timed
      ? `<svg class="turnring ${u.id === youId ? 'mine' : ''}" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" class="track"/>
          <circle cx="50" cy="50" r="46" pathLength="100" stroke="${ringColor}" stroke-dasharray="${(fill * 100).toFixed(1)} 100"/></svg>`
      : '';
    const turn = timed
      ? `<div class="spd">${iconNum('speed', fmtSpeed(u.speed), u.kind === 'monster' ? `Speed ${fmtSpeed(u.speed)}: acts every ${fmtSpeed(u.speed)} · next in ${u.nextIn!.toFixed(1)}s` : `This wait ${fmtSpeed(u.speed)} · next in ${u.nextIn!.toFixed(1)}s`)} · ${u.nextIn!.toFixed(1)}s</div>`
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
    if (action === 'revive') return enc.reviveTargets;
    if (action === 'item') {
      const def = ITEMS[view.you.items[this.targetingItem ?? -1]];
      if (!def) return [];
      if (def.target === 'ally') return allies.map((a) => a.id);
      if (def.target === 'downed') return enc.heroes.filter((h) => h.downed).map((h) => h.id);
      return [];
    }
    // Cards: the server says who each can be aimed at.
    if (action === 'card') return enc.yourHand.find((c) => c.card === this.targetingCard)?.targets ?? [];
    return [];
  }

  private needsTarget(view: PlayerView, action: CombatAction, card?: CardId) {
    if (action === 'revive') return true;
    if (action === 'item') {
      const def = ITEMS[view.you.items[this.targetingItem ?? -1]];
      return !!def && (def.target === 'ally' || def.target === 'downed');
    }
    if (action === 'card' && card) return CARDS[card].target === 'enemy' || CARDS[card].target === 'ally';
    return false;
  }

  private pick(action: CombatAction, item?: number, card?: CardId) {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc) return;
    this.aimRoom = null;
    this.targetingItem = action === 'item' ? item ?? null : null;
    this.targetingCard = action === 'card' ? card ?? null : null;
    // Waystep: the room is clicked on the map (the fight stage folds away meanwhile).
    if (card && CARDS[card].target === 'room') {
      this.targeting = null;
      this.aimRoom = card;
      return;
    }
    if (!this.needsTarget(view, action, card)) {
      this.targeting = null;
      this.net.intent({ type: 'combat', choice: { action, item, card } });
      return;
    }
    const targets = this.validTargets(view, enc, action);
    if (targets.length === 1) {
      this.targeting = null;
      this.net.intent({ type: 'combat', choice: { action, target: targets[0], item, card } });
    } else if (targets.length > 1) {
      // Lock the move in now; if the turn comes before a target is clicked, it goes to the leftmost one.
      this.targeting = action;
      this.net.intent({ type: 'combat', choice: { action, item, card } });
    }
  }

  private onClick(e: Event) {
    const el = e.target as HTMLElement;
    const live = el.closest('button[data-skill]') as HTMLElement | null;
    if (live) {
      if (!live.classList.contains('cooling')) this.useToll();
      return;
    }
    // Exploring: clicking a greyed card or action keeps its description open (click it again, or anywhere, to close).
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
    const cardBtn = el.closest('button[data-card]') as HTMLButtonElement | null;
    if (cardBtn) {
      const card = cardBtn.dataset.card as CardId;
      if (this.canUse('card')) this.pick('card', undefined, card);
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
      this.net.intent({ type: 'combat', choice: { action: this.targeting, target: unit.dataset.unit, item: this.targetingItem ?? undefined, card: this.targetingCard ?? undefined } });
      this.targeting = null;
    }
  }

  private onKey(e: KeyboardEvent) {
    const view = this.net.cur;
    if (!view || (e.target as HTMLElement).tagName === 'INPUT' || e.repeat) return;
    if (e.code === 'Escape' && this.aimRoom) {
      this.aimRoom = null;
      e.stopImmediatePropagation();
      return;
    }
    if (view.phase !== 'running' || view.you.dead || view.you.extracted) return;
    if (!view.encounter) {
      // Out of a fight: M tolls.
      if (e.code === 'KeyM') this.useToll();
      return;
    }
    const enc = view.encounter;
    const basics: Record<string, CombatAction> = { KeyR: 'revive', KeyF: 'flee', KeyB: 'brace' };
    // Cards on 1–3 (1–4 with a bigger hand); items after them.
    const digit = digitKey(e.code);
    const handLen = enc.yourHand.length;
    if (e.code === 'Escape') this.targeting = null;
    // A / D: step to the very back / front of the heroes' side (the server ignores it if you're already there).
    else if (e.code === 'KeyA' || e.code === 'KeyD') this.net.intent({ type: 'stepTo', to: e.code === 'KeyD' ? 'front' : 'back' });
    else if (digit !== null && digit < handLen) {
      if (this.canUse('card')) this.pick('card', undefined, enc.yourHand[digit].card);
    } else if (digit !== null && digit >= Math.max(3, handLen) && digit - Math.max(3, handLen) < HOTKEY_ITEMS) {
      const slot = digit - Math.max(3, handLen);
      if (this.canUse('item', slot)) this.pick('item', slot);
    } else if (basics[e.code] && this.canUse(basics[e.code])) this.pick(basics[e.code]);
  }

  /** Decided from game state, not the DOM (which may lag a frame behind). */
  private canUse(action: CombatAction, item?: number): boolean {
    const view = this.net.cur;
    const enc = view?.encounter;
    if (!view || !enc) return false;
    const me = enc.heroes.find((h) => h.id === view.you.id);
    if (!me || me.downed) return false;
    if (action === 'card') return enc.yourHand.length > 0;
    if (action === 'revive') return enc.reviveTargets.length > 0;
    if (action === 'item') {
      const def = ITEMS[view.you.items[item ?? -1]];
      if (!def?.combat) return false;
      if (def.target === 'downed') return enc.heroes.some((h) => h.downed);
    }
    return true;
  }
}
