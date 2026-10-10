import {
  abilitiesFor, AFFLICTIONS, CLASS_IDS, CLASSES, crBonus, CR_RULES, crUnitChance, ENEMIES, ESCALATION, ROSTER_RULES, TIERS, UNITS_BY_TIER, GEAR_SLOTS, INJURY_NAMES, injuredMaxHp, itemTier, ITEMS, KIT_RULES, pluralName, kitCr, RESOURCE_IDS, RITES,
  slotOf, talentPending, TALENTS, talentsFor, VILLAGE_RULES,
  type Character, type GearSlot, type ItemId, type Kit, type LeaderboardEntry, type LobbyView, type ResourceId, type TalentId, type Treatment, type VillageView,
} from '@stcp/shared';
import { itemName } from './loot';
import type { Net } from './net';
import { SOLO } from './local';
import { spriteUrl } from './render/sprites';
import { cooldownIcon, icon, iconize, iconNum } from './icons';

declare const __BUILD__: string;

const root = () => document.getElementById('screen')!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The Hall of Fortune table (shared by the menu and the results screen). */
export function hallOfFortune(entries: LeaderboardEntry[], you: string): string {
  if (!entries.length) return '<div class="hof muted small">No one has made it out alive yet. Be the first.</div>';
  const rows = entries.map((e, i) => `<tr class="${e.name.toLowerCase() === you.toLowerCase() ? 'me' : ''}">
    <td>${i + 1}.</td><td>${esc(e.name)} <span class="title-tag">${esc(e.title)}</span></td>
    <td class="gold">${e.gold}</td><td class="muted">${e.escapes}/${e.runs} out · best ${e.best}</td></tr>`).join('');
  return `<div class="hof"><div class="hof-head">⛀ Hall of Fortune</div><table>${rows}</table></div>`;
}

/** Menu (no lobby) and lobby-room screens. The game itself is the map canvas + HUD. */
export class Screens {
  private rendered = '';
  /** A mouse button is down on the screen: replacing the DOM now would swallow the click (mousedown and mouseup on different elements). */
  private pressing = false;
  /** The Challenge Rating explainer under the lobby's CR line is open. */
  private crHelp = false;

  constructor(private net: Net) {
    root().addEventListener('pointerdown', () => (this.pressing = true));
    for (const ev of ['pointerup', 'pointercancel'] as const) window.addEventListener(ev, () => (this.pressing = false));
    root().addEventListener('click', (e) => this.onClick(e));
    root().addEventListener('change', (e) => this.onChange(e));
    new ResizeObserver(() => this.fitClasses()).observe(root());
    void document.fonts.ready.then(() => this.fitClasses());
    root().addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).id === 'code-input') this.join();
    });
  }

  /** Re-render when the lobby changes. Returns true if a screen is covering the game. */
  update(): boolean {
    const lobby = this.net.lobby;
    const el = root();
    if (lobby?.state === 'game' || this.net.reviewing) {
      el.hidden = true;
      this.rendered = '';
      return false;
    }
    el.hidden = false;
    const body = lobby === undefined ? `<div class="card"><h1>So They Can Prosper</h1><p>Connecting…</p></div>`
      : this.net.villageOpen && this.net.village ? villageHtml(this.net.village, lobby)
      : lobby === null ? this.menuHtml() : this.lobbyHtml(lobby);
    const html = `${body}<div class="build-tag" title="Branch @ commit this build came from">${esc(__BUILD__)}</div>`;
    if (html !== this.rendered && !this.pressing) {
      // Preserve typed text and focus across re-renders (other players' changes trigger these).
      const values = new Map([...el.querySelectorAll('input')].map((i) => [i.id, i.value]));
      const focused = document.activeElement?.id;
      el.innerHTML = html;
      this.rendered = html;
      for (const input of el.querySelectorAll('input')) {
        if (values.has(input.id)) input.value = values.get(input.id)!;
        if (input.id === focused) input.focus();
      }
      this.fitClasses();
    }
    return true;
  }

  /** Grow the class-card text to the largest size where every card still fits its grid cell, so the lobby fills the window without scrolling. */
  private fitClasses() {
    const grid = root().querySelector<HTMLElement>('.classes');
    if (!grid) return;
    const cards = [...grid.querySelectorAll<HTMLElement>('.class-card')];
    const fits = () => cards.every((c) => c.scrollHeight <= c.clientHeight + 1 && c.scrollWidth <= c.clientWidth + 1);
    const min = 12;
    grid.classList.remove('scroll');
    grid.style.setProperty('--fs', `${min}px`);
    // Too small a window (phones) to fit legibly: keep the minimum size and let just the grid scroll.
    if (!fits()) return grid.classList.add('scroll');
    let lo = min, hi = 28;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      grid.style.setProperty('--fs', `${mid}px`);
      if (fits()) lo = mid;
      else hi = mid;
    }
    grid.style.setProperty('--fs', `${lo}px`);
  }

  private menuHtml() {
    return `<div class="card">
      <h1>So They Can Prosper</h1>
      ${SOLO ? '<p class="muted small">Solo playtest build: you and three bots, all running in this tab.</p>' : ''}
      <label>Your name<br><input id="name-input" maxlength="16" value="${esc(this.net.name)}" placeholder="Nameless"></label>
      <div class="row">
        <button data-act="create">${SOLO ? 'Start a run' : 'Start an expedition'}</button>
        <button data-act="village">The Village${villageBadge(this.net.village)}</button>
      </div>
      ${SOLO ? '' : `<div class="row">
        <input id="code-input" maxlength="4" placeholder="CODE" class="code">
        <button data-act="join">Join</button>
      </div>`}
      ${hallOfFortune(this.net.leaderboard, this.net.name)}
    </div>`;
  }

  private lobbyHtml(lobby: LobbyView) {
    const you = lobby.members.find((m) => m.id === lobby.youId)!;
    const isHost = lobby.hostId === lobby.youId;
    const slots = [];
    for (let i = 0; i < lobby.maxPlayers; i++) {
      const m = lobby.members[i];
      if (!m) {
        slots.push(`<li class="slot empty">— a bot will fill this slot —</li>`);
        continue;
      }
      const cls = m.cls ? CLASSES[m.cls] : null;
      const ch = m.character;
      const who = ch ? `${esc(ch.name)}${ch.talent ? ` <span class="talent-star" title="${esc(TALENTS[ch.talent].name)}">★</span>` : ''} <span class="muted">(${esc(m.name)})</span>` : esc(m.name);
      slots.push(`<li class="slot">
        <span class="swatch" style="background:${cls?.color ?? '#333'}"></span>
        <span class="slot-name">${who} <span class="title-tag">${esc(m.title)}</span>${m.id === lobby.hostId ? ' <span class="muted">(host)</span>' : ''}${m.id === lobby.youId ? ' <span class="muted">(you)</span>' : ''}</span>
        ${kitBadge(m.kit)}
        <span class="slot-meta"><span class="muted">${cls?.name ?? 'choosing…'}</span> · <span class="${m.ready ? 'ok' : 'muted'}">${m.connected ? (m.ready ? 'READY' : 'not ready') : 'disconnected'}</span></span>
      </li>`);
    }
    // Classes can be shared; the card just says who else picked it.
    const village = this.net.village;
    const cards = CLASS_IDS.map((id) => {
      const c = CLASSES[id];
      const mine = you.cls === id;
      const ch = village?.characters.find((x) => x.cls === id);
      const hp = ch ? injuredMaxHp(id, ch.injuries) : c.maxHp;
      const majors = ch?.injuries.filter((i) => i === 'major').length ?? 0;
      const others = lobby.members.filter((m) => m.cls === id && m.id !== lobby.youId);
      return `<button class="class-card ${mine ? 'selected' : ''}" data-act="class" data-cls="${id}" style="--cls:${c.color}">
        <div class="class-head">
          <div>
            <div class="class-name">${c.name}</div>
            <div class="muted">${c.role}</div>
            <div class="class-stats">${iconNum('hp', hp)} ${iconNum('speed', `${c.speed + majors * VILLAGE_RULES.majorSpeed}s`)}</div>
          </div>
          <img class="class-sprite" src="${spriteUrl(id, c.color)}" alt="">
        </div>
        ${ch ? `<div class="class-char">${characterLine(ch)}</div>` : ''}
        <div class="blurb">${iconize(c.blurb)}</div>
        <ul class="class-abilities">${abilitiesFor(id, ch?.talent).map((ab, i) => `<li><b>${i + 1}. ${esc(ab.name)}</b>${ab.cooldown ? ` ${cooldownIcon(ab.cooldown)}` : ''}${ab.field ? ` ${icon('field')}` : ''}<br>${iconize(ab.desc)}</li>`).join('')}</ul>
        ${others.length ? `<div class="muted">also: ${others.map((m) => esc(m.name)).join(', ')}</div>` : ''}
      </button>`;
    }).join('');
    // Solo: no one to wait for, so Descend readies you up itself.
    const allReady = SOLO ? !!you.cls : lobby.members.every((m) => m.ready && m.cls);
    const link = `${location.origin}${location.pathname}?lobby=${lobby.code}`;
    return `<div class="card wide lobby">
      ${SOLO ? '<div class="muted">Pick a class. Bots take the other three.</div>' : `<div class="lobby-head">
        <div><div class="muted">Lobby code</div><div class="code-big">${lobby.code}</div></div>
        <div class="muted small">Share the code, or this link:<br><a href="${link}">${esc(link)}</a></div>
      </div>`}
      <ul class="slots">${slots.join('')}</ul>
      <div class="cr-line">
        <button class="help-btn ${this.crHelp ? 'on' : ''}" data-act="cr-help" title="How Challenge Rating and the monsters work">?</button>
        Challenge Rating <b>${lobby.cr}</b>${crOdds(lobby.cr)} <span class="muted">(bots borrowing Talented Characters add to it)</span>
        · <span class="muted">gold ×${(1 + CR_RULES.goldPerCr * lobby.cr).toFixed(2)}</span>
        ${lobby.relic ? `· <span class="danger" title="${esc(RITES.relic.desc)}">♛ Relic Rite: the run starts at Escalation ${KIT_RULES.relicEscalation}</span>` : ''}
      </div>
      ${this.crHelp ? crHelpHtml(lobby.cr) : ''}
      <div class="classes">${cards}</div>
      <div class="row">
        <label>Name <input id="name-input" maxlength="16" value="${esc(you.name)}"></label>
        ${SOLO ? '' : `<button data-act="ready" ${you.cls ? '' : 'disabled'}>${you.ready ? 'Not ready' : 'Ready'}</button>`}
        ${isHost ? `<button data-act="start" ${allReady ? '' : 'disabled'} class="primary">Descend</button>` : `<span class="muted">Waiting for the host to start…</span>`}
        <button data-act="village">The Village${villageBadge(village)}</button>
        ${this.net.lastRun ? '<button data-act="review">Last run’s map</button>' : ''}
        <button data-act="leave" class="quiet">Leave</button>
      </div>
    </div>`;
  }

  private onClick(e: Event) {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn || btn.disabled) return;
    const net = this.net;
    switch (btn.dataset.act) {
      case 'create':
        this.commitName();
        net.send({ t: 'create' });
        break;
      case 'join':
        this.join();
        break;
      case 'class': {
        const cls = btn.dataset.cls as (typeof CLASS_IDS)[number];
        const mine = net.lobby?.members.find((m) => m.id === net.lobby?.youId)?.cls === cls;
        net.send({ t: 'pickClass', cls: mine ? null : cls });
        break;
      }
      case 'ready': {
        const you = net.lobby?.members.find((m) => m.id === net.lobby?.youId);
        net.send({ t: 'ready', ready: !you?.ready });
        break;
      }
      case 'start':
        if (SOLO) net.send({ t: 'ready', ready: true });
        net.send({ t: 'start' });
        break;
      case 'review':
        net.review(true);
        break;
      case 'village':
        net.villageOpen = true;
        net.send({ t: 'village' });
        break;
      case 'village-close':
        net.villageOpen = false;
        break;
      case 'cr-help':
        this.crHelp = !this.crHelp;
        this.update();
        break;
      case 'talent':
        net.send({ t: 'chooseTalent', charId: btn.dataset.char!, talent: btn.dataset.talent as TalentId });
        break;
      case 'treat':
        net.send({ t: 'treat', charId: btn.dataset.char!, what: btn.dataset.what as Treatment });
        break;
      case 'kit-add':
      case 'kit-remove':
      case 'rite': {
        const v = net.village;
        if (!v) break;
        const kit = structuredClone(v.kit);
        if (btn.dataset.act === 'rite') toggleRite(kit, btn.dataset.rite as ResourceId);
        else if (btn.dataset.act === 'kit-add') addToKit(kit, btn.dataset.item as ItemId);
        else removeFromKit(kit, btn.dataset.slot!);
        net.send({ t: 'setKit', kit });
        break;
      }
      case 'leave':
        net.send({ t: 'leave' });
        history.replaceState(null, '', location.pathname);
        break;
    }
  }

  private onChange(e: Event) {
    if ((e.target as HTMLElement).id === 'name-input') this.commitName();
  }

  private commitName() {
    const input = document.getElementById('name-input') as HTMLInputElement | null;
    if (input && input.value.trim() && input.value.trim() !== this.net.name) this.net.setName(input.value.trim());
  }

  private join() {
    const code = (document.getElementById('code-input') as HTMLInputElement | null)?.value.trim().toUpperCase();
    if (!code) return;
    this.commitName();
    this.net.send({ t: 'join', code });
  }
}

/** "Ilse · XP 1/2 · ★ Iron Oath · Minor Injury" for a Character on a lobby class card. */
function characterLine(c: Character): string {
  const bits = [`<b>${esc(c.name)}</b>`];
  if (c.talent) bits.push(`<span class="talent-star" title="${esc(TALENTS[c.talent].desc)}">★ ${esc(TALENTS[c.talent].name)}</span>`);
  else bits.push(talentPending(c) ? '<span class="gold">Talent ready!</span>' : `XP ${c.xp}/${VILLAGE_RULES.xpForTalent}`);
  for (const i of c.injuries) bits.push(`<span class="injury ${i}">${INJURY_NAMES[i]}</span>`);
  if (c.affliction) bits.push(`<span class="injury major">${AFFLICTIONS[c.affliction].name}</span>`);
  return bits.join(' · ');
}

/** A marker on the Village button when a Talent is waiting to be chosen. */
function villageBadge(v: VillageView | null): string {
  const talents = v?.characters.filter(talentPending).length ?? 0;
  return talents ? ` <span class="gold">(★ ${talents})</span>` : '';
}

/** The Village: the purse, and every Character with their XP, Talent, wounds and what treating them costs. */
function villageHtml(v: VillageView, lobby: LobbyView | null): string {
  const bringing = lobby?.members.find((m) => m.id === lobby.youId)?.cls;
  const cards = v.characters.map((c) => {
    const cls = CLASSES[c.cls];
    const hp = injuredMaxHp(c.cls, c.injuries);
    const majors = c.injuries.filter((i) => i === 'major').length;
    const pips = Array.from({ length: VILLAGE_RULES.xpForTalent }, (_, i) => (i < c.xp ? '●' : '○')).join('');
    let talent: string;
    if (c.talent) {
      talent = `<div class="v-talent"><span class="talent-star">★ ${esc(TALENTS[c.talent].name)}</span><br><span class="small">${esc(TALENTS[c.talent].desc)}</span></div>`;
    } else if (talentPending(c)) {
      talent = `<div class="v-talent"><div class="gold">Choose a Talent:</div>${talentsFor(c.cls).map((t) =>
        `<button class="v-pick" data-act="talent" data-char="${c.id}" data-talent="${t}"><b>${esc(TALENTS[t].name)}</b><br><span class="small">${esc(TALENTS[t].desc)}</span></button>`).join('')}</div>`;
    } else {
      talent = `<div class="v-talent muted small">At ${VILLAGE_RULES.xpForTalent} XP, a Talent: ${talentsFor(c.cls).map((t) =>
        `<span class="v-option" title="${esc(TALENTS[t].desc)}">${esc(TALENTS[t].name)}</span>`).join(' or ')}</div>`;
    }
    const treat = (what: Treatment, label: string) => {
      const cost = VILLAGE_RULES.cost[what];
      return `<button class="v-treat ${what === 'minor' ? 'minor' : 'major'}" data-act="treat" data-char="${c.id}" data-what="${what}" ${v.purse < cost ? 'disabled' : ''}>${label} · treat for ${cost}g</button>`;
    };
    const wounds = [
      ...c.injuries.map((i) => treat(i, INJURY_NAMES[i])),
      ...(c.affliction ? [treat('affliction', AFFLICTIONS[c.affliction].name)] : []),
    ];
    return `<div class="v-card" style="--cls:${cls.color}">
      <div class="class-head">
        <div>
          <div class="class-name">${esc(c.name)}</div>
          <div class="muted">${cls.name}${bringing === c.cls ? ' · <span class="gold">coming along</span>' : ''}</div>
          <div class="class-stats">${iconNum('hp', hp)}${hp < cls.maxHp ? `<span class="muted">/${cls.maxHp}</span>` : ''} ${iconNum('speed', `${cls.speed + majors * VILLAGE_RULES.majorSpeed}s`)}</div>
        </div>
        <img class="class-sprite" src="${spriteUrl(c.cls, cls.color)}" alt="">
      </div>
      <div>XP <span class="gold">${pips}</span> <span class="muted small">· ${c.survived} run${c.survived === 1 ? '' : 's'} survived</span></div>
      ${talent}
      <div class="v-wounds">${wounds.length ? wounds.join('') : '<span class="ok small">Fit and well</span>'}</div>
    </div>`;
  }).join('');
  const report = v.report.length ? `<div class="v-report"><div class="muted small">After the last run</div>${v.report.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : '';
  return `<div class="card wide village">
    <div class="lobby-head">
      <div><h1>The Village</h1><div class="muted small">Each run a Character survives earns 1 XP; ${VILLAGE_RULES.xpForTalent} XP earns a Talent. Wounds and afflictions follow them home. Death sends a raw recruit in their place.</div></div>
      <div class="v-purse">Purse <span class="gold">${v.purse} gold</span></div>
    </div>
    ${report}
    <div class="v-grid">${cards}</div>
    ${stashHtml(v, lobby)}
    <div class="row muted small">Talents, Gear brought along and Effigy Rites raise the Challenge Rating: more gold, but stranger monsters more often, and tougher ones from CR ${CR_RULES.lowCr}. The ? by the CR in the lobby explains it all.</div>
    <div class="row"><button class="primary" data-act="village-close">Back</button></div>
  </div>`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const tierUnits = (t: (typeof TIERS)[number]) => UNITS_BY_TIER[t].map((u) => ENEMIES[u].name).join(', ');

/** What a run at this (whole) CR brings: gold, CR units' chances, and monster toughness by tier. */
function crAtHtml(cr: number): string {
  const units = TIERS.filter((t) => crUnitChance(t, cr) > 0);
  const chances = units.length ? units.map((t) => `T${t} ${pct(crUnitChance(t, cr))}`).join(', ') : 'none yet';
  const bonuses = TIERS.map((t) => crBonus(t, cr));
  const tough = bonuses.every((b) => b === 0) ? 'normal'
    : bonuses.every((b) => b === bonuses[0]) ? `+${pct(bonuses[0])} for all`
    : TIERS.map((t) => `T${t} +${pct(bonuses[t])}`).join(', ');
  return `<li><b>CR ${cr}</b>: gold ×${(1 + CR_RULES.goldPerCr * cr).toFixed(2)} · CR units per group: ${chances}${units.length ? ` (lairs: all ${units.length})` : ''} · monster HP and damage: ${tough}</li>`;
}

/** The lobby's Challenge Rating explainer: how monsters are chosen for a run, what CR does, and what this CR means. */
function crHelpHtml(cr: number): string {
  const lo = Math.floor(cr);
  const now = cr === lo ? [lo] : [lo, lo + 1];
  const u = CR_RULES.units;
  return `<div class="cr-help">
    <div><b>Monster tiers.</b> ${TIERS.map((t) => `<span class="tier">T${t}</span> ${tierUnits(t)}`).join(' · ')}</div>
    <div><b>Each run</b> picks its monsters at random: ${ROSTER_RULES.defaults[0]} T0, ${ROSTER_RULES.defaults[1]} T1 and ${ROSTER_RULES.defaults[2]} T2 are its default monsters.
      T0 are there from the start, T1 join at Escalation ${ROSTER_RULES.escalation[1]} and T2 at Escalation ${ROSTER_RULES.escalation[2]} (lairs and hidden rooms don't wait).
      One more of each tier (the T3 always: there is only the ${ENEMIES.lich.name}) is the run's <i>CR unit</i>, which only Challenge Rating brings.</div>
    <div><b>Challenge Rating</b> is 1 per hero with a Talent (bots included), +${KIT_RULES.crPerGearLevel} per level of Gear brought from the Stash, +${KIT_RULES.effigyCr} for an Effigy Rite and ${KIT_RULES.gemCr} for a Gem Rite. A fraction is the chance of the next CR up. Each CR: +${pct(CR_RULES.goldPerCr)} gold found.</div>
    <ul>
      <li>Each group of monsters rolls separately for each CR unit: T0 from CR ${u[0].from} (${pct(u[0].chance)}), T1 from CR ${u[1].from} (${pct(u[1].chance)}), T2 from CR ${u[2].from} (${pct(u[2].chance)}), T3 from CR ${u[3].from} (${pct(u[3].chance)}). Lairs bring every one unlocked.</li>
      <li>CR ${CR_RULES.lowCr}: T0 and T1 monsters get +${pct(CR_RULES.lowBonus)} HP and damage.</li>
      <li>CR ${CR_RULES.allCr}: every monster gets +${pct(CR_RULES.allBonus)} HP and damage.</li>
      <li>Each CR above ${CR_RULES.growFrom}: CR units are ${TIERS.map((t) => pct(u[t].perCr)).join(' / ')} (T0 / T1 / T2 / T3) more likely, and every monster gets +${pct(CR_RULES.perCrAbove)} HP and damage.</li>
      <li>These bonuses add to Escalation's (+${pct(ESCALATION.escalationScaling)} per Escalation).</li>
    </ul>
    <div><b>This lobby${now.length > 1 ? ` (${pct(cr - lo)} chance of CR ${lo + 1})` : ''}:</b></div>
    <ul>${now.map(crAtHtml).join('')}</ul>
  </div>`;
}

/** " (70% CR 3, else CR 2)" when the combined CR has a fraction. */
function crOdds(cr: number): string {
  const base = Math.floor(cr);
  const frac = Math.round((cr - base) * 100);
  return frac ? ` <span class="muted">(${frac}% CR ${base + 1}, else CR ${base})</span>` : '';
}

/** The glyphs of what a lobby member is bringing from their Stash, hover for names. */
function kitBadge(kit: Kit): string {
  const items = [...GEAR_SLOTS.map((s) => kit.gear[s]).filter((x): x is ItemId => !!x), ...kit.consumables];
  const parts = items.map((it) => `<span title="${esc(ITEMS[it].name)}">${ITEMS[it].glyph}</span>`);
  parts.push(...kit.rites.map((r) => `<span class="rite-tag" title="${esc(`${RITES[r].name}: ${RITES[r].desc}`)}">${ITEMS[r].glyph}</span>`));
  return parts.length ? `<span class="kit-badge">${parts.join('')}</span>` : '';
}

/** How many of `item` the kit already takes. */
function inKit(kit: Kit, item: ItemId): number {
  return Object.values(kit.gear).filter((x) => x === item).length + kit.consumables.filter((x) => x === item).length;
}

/** Gear goes on its slot (replacing what was chosen there); a consumable takes a free place. */
function addToKit(kit: Kit, item: ItemId) {
  const slot = slotOf(item);
  if (slot) kit.gear[slot] = item;
  else if (kit.consumables.length < KIT_RULES.consumables) kit.consumables.push(item);
}

/** `slot` is a Gear slot, or "c0"/"c1" for a consumable place. */
function removeFromKit(kit: Kit, slot: string) {
  if (slot.startsWith('c')) kit.consumables.splice(Number(slot.slice(1)), 1);
  else delete kit.gear[slot as GearSlot];
}

function toggleRite(kit: Kit, r: ResourceId) {
  kit.rites = kit.rites.includes(r) ? kit.rites.filter((x) => x !== r) : [...kit.rites, r];
  // The Gem Rite forbids consumables: taking it leaves them at home.
  if (kit.rites.includes('gem')) kit.consumables = [];
}

const SLOT_NAMES: Record<GearSlot, string> = { weapon: 'Weapon', armor: 'Armor', amulet: 'Amulet', ring: 'Ring' };

/** The Village Stash: what's in it, what goes into the next run, and the Rites Resources can power. */
function stashHtml(v: VillageView, lobby: LobbyView | null): string {
  const kit = v.kit;
  const locked = lobby?.state === 'game';
  const dis = locked ? 'disabled' : '';
  const gearCr = (it: ItemId) => `+${(itemTier(it) * KIT_RULES.crPerGearLevel).toFixed(1)} CR`;
  // The kit: four Gear slots and the free consumable places.
  const gear = GEAR_SLOTS.map((s) => {
    const it = kit.gear[s];
    return it
      ? `<button class="kit-slot full" data-act="kit-remove" data-slot="${s}" ${dis} title="${esc(ITEMS[it].desc)} Click to leave it at home.">${ITEMS[it].glyph} ${itemName(it)} <span class="muted small">${gearCr(it)}</span></button>`
      : `<div class="kit-slot muted">${SLOT_NAMES[s]}: none</div>`;
  });
  const gem = kit.rites.includes('gem');
  const cons = gem ? ['<div class="kit-slot muted">Consumables: none (Gem Rite)</div>'] : Array.from({ length: KIT_RULES.consumables }, (_, i) => {
    const it = kit.consumables[i];
    return it
      ? `<button class="kit-slot full" data-act="kit-remove" data-slot="c${i}" ${dis} title="${esc(ITEMS[it].desc)} Click to leave it at home.">${ITEMS[it].glyph} ${itemName(it)} <span class="muted small">free</span></button>`
      : '<div class="kit-slot muted">Consumable: none</div>';
  });
  const cr = kitCr(kit);
  // The Stash, one button per kind of item, with how many are left to take.
  const counts = new Map<ItemId, number>();
  for (const it of v.items) counts.set(it, (counts.get(it) ?? 0) + 1);
  const stash = [...counts].map(([it, n]) => {
    const left = n - inKit(kit, it);
    const isCons = ITEMS[it].kind === 'consumable';
    const full = isCons && (gem || kit.consumables.length >= KIT_RULES.consumables);
    const why = left <= 0 ? 'All of them are packed.' : isCons && gem ? 'The Gem Rite forbids consumables.' : full ? `Only ${KIT_RULES.consumables} consumables.` : isCons ? 'Click to pack it (free).' : `Click to wear it (${gearCr(it)}).`;
    const count = n > 1 ? ` <span class="muted">×${left}/${n}</span>` : left <= 0 ? ' <span class="muted">(packed)</span>' : '';
    return `<button class="stash-item" data-act="kit-add" data-item="${it}" ${locked || left <= 0 || full ? 'disabled' : ''} title="${esc(`${ITEMS[it].desc} ${why}`)}">${ITEMS[it].glyph} ${itemName(it)}${count}</button>`;
  }).join('');
  const rites = RESOURCE_IDS.map((r) => {
    const have = v.resources[r] ?? 0;
    const on = kit.rites.includes(r);
    const can = on || have >= KIT_RULES.riteCost;
    // A small tile per Rite (glyph and count); the full effect is on hover.
    const status = on ? 'Active next run. Click to cancel.' : can ? 'Click to perform it next run.' : `Needs ${KIT_RULES.riteCost}.`;
    const tip = `${pluralName(r)}: ${have}\n${RITES[r].name} (${KIT_RULES.riteCost}): ${RITES[r].desc}\n${status}`;
    return `<button class="rite ${on ? 'on' : ''}" data-act="rite" data-rite="${r}" ${locked || !can ? 'disabled' : ''} title="${esc(tip)}">
      <span class="rite-glyph">${ITEMS[r].glyph}</span><span class="rite-count">${have}</span>
    </button>`;
  }).join('');
  return `<div class="v-stash">
    <div class="v-kit">
      <div class="gold">Taking into the next run${cr ? ` <span class="muted">· CR ${cr > 0 ? '+' : ''}${cr}</span>` : ''}</div>
      <div class="muted small">Gear adds ${KIT_RULES.crPerGearLevel} CR per level (common 1 · uncommon 2 · rare 3). Up to ${KIT_RULES.consumables} consumables, free. If your Character dies, what they took is lost.</div>
      <div class="kit-slots">${gear.join('')}${cons.join('')}</div>
    </div>
    <div class="v-stash-items">
      <div class="gold">Village Stash</div>
      <div class="muted small">Everything your Characters carry out of the dungeon ends up here.</div>
      <div class="stash-list">${stash || '<span class="muted">Empty. Bring something home.</span>'}</div>
    </div>
    <div class="v-rites">
      <div class="gold">Resources and Rites</div>
      <div class="muted small">Spend ${KIT_RULES.riteCost} of a Resource for an effect on your next run only. They're spent when it starts.</div>
      <div class="rite-list">${rites}</div>
    </div>
  </div>`;
}
