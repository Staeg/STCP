import {
  REGALIA_RULES, SPECS, talentsOf, type SpecId,
  CARDS, CLASS_CARDS, SCHOOLS, BUILDINGS, CLASS_IDS, CLASSES, crBonus, CR_RULES, crUnitChance, ENEMIES, ESCALATION, ROSTER_RULES, TIERS, UNITS_BY_TIER, GEAR_SLOTS, INJURY_NAMES, injuredMaxHp,
  ITEMS, KIT_RULES, LEVEL_NAMES, RITES, talentPending, TALENTS, VILLAGE_RULES, EMERGENCIES, emergencyWarning, KIND_NAMES, WELLBEING,
  type BuildingId, type Character, type ClassId, type EmergencyId, type FateChoice, type Injury, type ItemId, type Kit, type LeaderboardEntry, type LobbyView, type ResourceId,
  type GearSlot, type ServiceId, type TalentId, type VillageView,
} from '@stcp/shared';
import { codexHtml, type CodexTab } from './codex';
import { addToKit, loadoutHtml, PICKED, removeFromKit, toggleBare, toggleRite, villageHtml } from './village';
import type { Net } from './net';
import { SOLO } from './local';
import { spriteUrl } from './render/sprites';
import { iconize, iconNum, talentStars } from './icons';

declare const __BUILD__: string;
/** Built by vite.config.ts: one group per deploy, newest first; `at` is the push time (null = not pushed yet). */
declare const __PATCH_NOTES__: { at: string | null; sha: string; headlines: string[]; major: string[]; minor: string[]; other: string[] }[];

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

/** "3 days 4 hours ago", to the two largest units. */
function ago(iso: string): string {
  let mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return 'just now';
  const parts: string[] = [];
  for (const [n, unit] of [[1440, 'day'], [60, 'hour'], [1, 'minute']] as const) {
    const k = Math.floor(mins / n);
    mins -= k * n;
    if (k && parts.length < 2) parts.push(`${k} ${unit}${k === 1 ? '' : 's'}`);
    else if (parts.length) break;
  }
  return `${parts.join(' ')} ago`;
}

/** The changes each push brought, opened from the build tag in the corner. */
function patchNotesHtml(): string {
  const list = (items: string[], label = '') => items.length
    ? `${label ? `<div class="patch-kind">${label}</div>` : ''}<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const groups = __PATCH_NOTES__.map((g) => `<div class="patch">
    <div class="patch-head">${g.at ? `<span title="${esc(new Date(g.at).toLocaleString())}">${ago(g.at)}</span>` : '<span class="danger">Not pushed yet</span>'}
      <span class="muted small">@ ${g.sha}</span></div>
    ${g.headlines.length ? `<div class="patch-headline">${g.headlines.map(esc).join(' · ')}</div>` : ''}
    ${list(g.major, 'Major')}<div class="minor">${list(g.minor, 'Minor')}</div>${list(g.other, g.major.length + g.minor.length ? 'Other' : '')}</div>`).join('');
  return `<div class="patch-notes card wide"><div class="patch-title"><h1>Patch notes</h1><button data-act="patch-notes" class="quiet">Close</button></div>
    <div class="patch-list">${groups || '<p class="muted">No notes in this build.</p>'}</div></div>`;
}

/** Menu (no lobby) and lobby-room screens. The game itself is the map canvas + HUD. */
export class Screens {
  private rendered = '';
  /** A mouse button is down on the screen: replacing the DOM now would swallow the click (mousedown and mouseup on different elements). */
  private pressing = false;
  /** The Challenge Rating explainer under the lobby's CR line is open. */
  private crHelp = false;
  /** The patch notes panel (opened from the build tag) is showing. */
  private patchNotes = false;
  /** A Village service waiting for its target (a Stash piece, or what the Seer should look for). */
  private picking: ServiceId | null = null;
  /** The Armory, Bestiary or Archive, open over the Village. */
  private codexTab: CodexTab | null = null;

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
      : this.net.villageOpen && this.net.village && this.codexTab ? codexHtml(this.net.village, this.codexTab)
      : this.net.villageOpen && this.net.village ? villageHtml(this.net.village, lobby, this.picking, emergencyHtml(this.net.village, lobby), this.net.village.fate ? fateHtml(this.net.village) : null)
      : lobby === null ? this.menuHtml() : this.lobbyHtml(lobby);
    const html = `${body}${this.patchNotes ? patchNotesHtml() : ''}<button class="build-tag" data-act="patch-notes" title="Branch @ commit this build came from. Click for patch notes.">${esc(__BUILD__)}</button>`;
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

  /** Grow the selected class card's text to the largest size where it still fits, so the lobby fills the window without scrolling. */
  private fitClasses() {
    const grid = root().querySelector<HTMLElement>('.class-focus');
    if (!grid) return;
    const cards = [...grid.querySelectorAll<HTMLElement>('.class-card')];
    const fits = () => cards.every((c) => c.scrollHeight <= c.clientHeight + 1 && c.scrollWidth <= c.clientWidth + 1);
    const min = 12;
    grid.classList.remove('scroll');
    grid.style.setProperty('--fs', `${min}px`);
    // Too small a window (phones) to fit legibly: keep the minimum size and let just the grid scroll.
    if (!fits()) return grid.classList.add('scroll');
    let lo = min, hi = 32;
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
        const bot = lobby.bots[i - lobby.members.length];
        if (!bot) {
          slots.push(`<li class="slot empty">— a bot will fill this slot once everyone picks a class —</li>`);
          continue;
        }
        const bc = CLASSES[bot.cls];
        const bch = bot.character;
        slots.push(`<li class="slot bot">
          <span class="swatch" style="background:${bc.color}"></span>
          <span class="slot-name">${esc(bot.name)}${bch ? talentStars(talentsOf({ ...bch, cls: bot.cls })) : ''}${bot.owner ? ` <span class="muted">(borrowed from ${esc(bot.owner)})</span>` : ''}</span>
          ${bch && (bch.injuries.length || bch.insane) ? `<span class="danger small" title="No healthy Character was free to borrow">hurt</span>` : ''}
          <span class="slot-meta"><span class="muted">${bc.name}</span> · <span class="muted">BOT</span></span>
        </li>`);
        continue;
      }
      const cls = m.cls ? CLASSES[m.cls] : null;
      const ch = m.character;
      const who = ch ? `${esc(ch.name)}${m.cls ? talentStars(talentsOf({ ...ch, cls: m.cls })) : ''} <span class="muted">(${esc(m.name)})</span>` : esc(m.name);
      slots.push(`<li class="slot">
        <span class="swatch" style="background:${cls?.color ?? '#333'}"></span>
        <span class="slot-name">${who} <span class="title-tag">${esc(m.title)}</span>${m.id === lobby.hostId ? ' <span class="muted">(host)</span>' : ''}${m.id === lobby.youId ? ' <span class="muted">(you)</span>' : ''}</span>
        <span class="slot-meta"><span class="muted">${cls?.name ?? 'choosing…'}</span> · <span class="${m.ready ? 'ok' : 'muted'}">${m.connected ? (m.ready ? 'READY' : 'not ready') : 'disconnected'}</span>${kitBadge(m.kit)}
          ${m.emergency ? `<span class="em-tag ${EMERGENCIES[m.emergency].kind}" title="${esc(EMERGENCIES[m.emergency].desc)}">⚑ ${esc(EMERGENCIES[m.emergency].name)}</span>` : ''}</span>
      </li>`);
    }
    // Classes can be shared; each row says who else picked it. Only your class gets the full card.
    const village = this.net.village;
    const rows = CLASS_IDS.map((id) => {
      const c = CLASSES[id];
      const ch = village?.characters.find((x) => x.cls === id);
      const others = [...lobby.members.filter((m) => m.cls === id && m.id !== lobby.youId).map((m) => m.name), ...lobby.bots.filter((b) => b.cls === id).map((b) => `${b.name} (bot)`)];
      const hurt = ch && (ch.injuries.length || ch.insane);
      return `<button class="class-row ${you.cls === id ? 'selected' : ''}" data-act="class" data-cls="${id}" style="--cls:${c.color}" title="${esc(`${c.name}: ${c.role}`)}">
        <img class="cr-sprite" src="${spriteUrl(id, c.color)}" alt="">
        <span class="cr-name">${c.name}${ch ? talentStars(talentsOf(ch)) : ''}${hurt ? ' <span class="injury major">✚</span>' : ''}</span>
        <span class="cr-abs"><span class="ab-chip innate" title="${esc(`Innate: ${c.innate.desc}`)}">${esc(c.innate.name)}</span>${CLASS_CARDS[id].map((cd) => `<span class="ab-chip ${CARDS[cd].burn ? 'burn' : ''}" title="${esc(`${CARDS[cd].name} · ${CARDS[cd].time}s${CARDS[cd].burn ? ' · Burn' : ''}: ${CARDS[cd].desc}`)}">${esc(CARDS[cd].name)}</span>`).join('')}</span>
        ${others.length ? `<span class="cr-others" title="${esc(`Also: ${others.join(', ')}`)}">${others.map((n) => esc(n[0])).join('')}</span>` : ''}
      </button>`;
    }).join('');
    const focus = you.cls ? classCard(you.cls, village?.characters.find((x) => x.cls === you.cls))
      : '<div class="class-card empty"><div class="class-name muted">Pick a class</div><div class="muted">Click one on the left.</div></div>';
    // Solo: no one to wait for, so Descend readies you up itself.
    // Ready and Descend stay greyed out until the Village's Emergency is chosen.
    const canReady = !!you.cls && !!you.emergency;
    const allReady = SOLO ? canReady : lobby.members.every((m) => m.ready && m.cls && m.emergency);
    const whyNot = !you.cls ? 'Pick a class first.' : !you.emergency ? 'Choose your Emergency first.' : '';
    const link = `${location.origin}${location.pathname}?lobby=${lobby.code}`;
    return `<div class="card wide lobby">
      <div class="lb-head">
        ${SOLO ? '' : `<div class="lb-code" title="Share the code, or the link"><div class="code-big">${lobby.code}</div><a class="small" href="${link}">${esc(link.replace(/^https?:\/\//, ''))}</a></div>`}
        <ul class="slots">${slots.join('')}</ul>
        <div class="cr-corner">
          ${lobby.relic ? `<span class="danger" title="${esc(`${RITES.relic.desc} The run starts at Escalation ${KIT_RULES.relicEscalation}.`)}">♛</span>` : ''}
          <button class="cr-btn ${this.crHelp ? 'on' : ''}" data-act="cr-help" title="Challenge Rating${esc(crOddsText(lobby.cr))}, gold ×${(1 + CR_RULES.goldPerCr * lobby.cr).toFixed(2)}. Click for how it and the monsters work.">CR <b>${lobby.cr}</b></button>
        </div>
      </div>
      ${this.crHelp ? crHelpHtml(lobby.cr) : ''}
      <div class="lb-main">
        <div class="class-list">${rows}</div>
        <div class="class-focus">${focus}</div>
        <div class="lb-side">
          ${village ? lobbyEmergencyHtml(village, lobby.cr, you.kit) : ''}
          ${village ? loadoutHtml(village, you.cls ?? null) : ''}
        </div>
      </div>
      <div class="row">
        <label>Name <input id="name-input" maxlength="16" value="${esc(you.name)}"></label>
        ${SOLO ? '' : `<button data-act="ready" ${you.ready || canReady ? '' : `disabled title="${whyNot}"`}>${you.ready ? 'Not ready' : 'Ready'}</button>`}
        ${isHost ? `<button data-act="start" ${allReady ? '' : `disabled title="${SOLO ? whyNot : 'Everyone must pick a class, choose an Emergency and ready up.'}"`} class="primary">Descend</button>` : `<span class="muted">Waiting for the host to start…</span>`}
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
        this.picking = null;
        this.codexTab = null;
        break;
      case 'codex':
        this.codexTab = btn.dataset.tab as CodexTab;
        this.picking = null;
        break;
      case 'codex-close':
        this.codexTab = null;
        break;
      case 'build':
        net.send({ t: 'build', building: btn.dataset.building as BuildingId });
        break;
      case 'demolish': {
        const b = BUILDINGS[btn.dataset.building as BuildingId];
        const level = net.village?.buildings[b.id] ?? 0;
        if (confirm(`Tear down the ${LEVEL_NAMES[level]} ${b.name}? Its Resources are lost.`)) net.send({ t: 'demolish', building: b.id });
        break;
      }
      case 'service': {
        const s = btn.dataset.service as ServiceId;
        const d = btn.dataset;
        // Gear and the Seer's picks come from a second click; the first just starts picking (or stops).
        if (PICKED.includes(s) && !d.item && !d.pick) {
          this.picking = this.picking === s ? null : s;
          this.update();
          break;
        }
        this.picking = null;
        net.send({ t: 'service', req: { service: s, ...(d.char ? { charId: d.char } : {}), ...(d.injury ? { injury: d.injury as Injury } : {}),
          ...(d.item ? { item: d.item as ItemId } : {}), ...(d.pick ? { pick: d.pick } : {}) } });
        break;
      }
      case 'pick-cancel':
        this.picking = null;
        this.update();
        break;
      case 'patch-notes':
        this.patchNotes = !this.patchNotes;
        this.update();
        break;
      case 'cr-help':
        this.crHelp = !this.crHelp;
        this.update();
        break;
      case 'talent':
        net.send({ t: 'chooseTalent', charId: btn.dataset.char!, talent: btn.dataset.talent as TalentId });
        break;
      case 'spec': {
        const spec = btn.dataset.spec as SpecId;
        const who = this.net.village?.characters.find((c) => c.id === btn.dataset.char)?.name ?? 'This Character';
        if (confirm(`Make ${who} ${SPECS[spec].name} for ${REGALIA_RULES.specCost} gold? It's for good.`)) net.send({ t: 'chooseSpec', charId: btn.dataset.char!, spec });
        break;
      }
      case 'emergency':
        net.send({ t: 'chooseEmergency', id: btn.dataset.id as EmergencyId });
        break;
      case 'fate':
        net.send({ t: 'chooseFate', choice: btn.dataset.choice as FateChoice });
        break;
      case 'kit-add':
      case 'kit-remove':
      case 'kit-bare':
      case 'rite': {
        const v = net.village;
        if (!v) break;
        const kit = structuredClone(v.kit);
        if (btn.dataset.act === 'rite') toggleRite(kit, btn.dataset.rite as ResourceId);
        else if (btn.dataset.act === 'kit-add') addToKit(kit, btn.dataset.item as ItemId);
        else if (btn.dataset.act === 'kit-bare') toggleBare(kit, btn.dataset.slot as GearSlot);
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

/** Wellbeing as pips: ● for each point, ○ up to the most it can be. */
function wellbeingPips(w: number): string {
  return `<span class="wb-pips" title="Wellbeing ${w}: at ${WELLBEING.win} you win, at ${WELLBEING.lose} you lose.">${Array.from({ length: WELLBEING.max }, (_, i) => (i < w ? '●' : '○')).join('')}</span>`;
}

/** The full card for the class you picked: stats, your Character, Innate and the six class cards. */
function classCard(id: ClassId, ch: Character | undefined): string {
  const c = CLASSES[id];
  const hp = ch ? injuredMaxHp(id, ch.injuries) : c.maxHp;
  const majors = ch?.injuries.filter((i) => i === 'major').length ?? 0;
  return `<div class="class-card selected" style="--cls:${c.color}">
    <div class="class-head">
      <div>
        <div class="class-name">${c.name}</div>
        <div class="muted">${c.role}</div>
        <div class="class-stats">${iconNum('hp', hp)} ${iconNum('speed', `${c.speed + majors * VILLAGE_RULES.majorSpeed}s`)}</div>
      </div>
      <img class="class-sprite" src="${spriteUrl(id, c.color)}" alt="">
    </div>
    ${ch ? `<div class="class-char">${characterLine(ch)}</div>` : ''}
    <div class="blurb"><b>Innate: ${esc(c.innate.name)}</b>. ${iconize(c.innate.desc)}</div>
    <ul class="class-cards">${CLASS_CARDS[id].map((cd) => {
      const def = CARDS[cd];
      const schools = def.schools.map((x) => `<span title="${SCHOOLS[x].name}">${SCHOOLS[x].glyph}</span>`).join('');
      return `<li><b>${esc(def.name)}</b> <span class="muted">${def.time}s</span> ${schools}${def.burn ? ' <span title="Burn: once a run (a Loom brings it back).">🔥</span>' : ''}<br>${iconize(def.desc)}</li>`;
    }).join('')}</ul>
    <div class="small muted">Speed sets how soon you act first in a fight (and how fast you walk); after that, each card sets the wait for the next. Each piece of Gear adds a card too.</div>
  </div>`;
}

/** One Emergency as a pickable card, with its kind and any warning. */
function emergencyCard(id: EmergencyId, chosen: boolean, warning: string | null, act = true): string {
  const e = EMERGENCIES[id];
  return `<button class="em-card ${e.kind} ${chosen ? 'selected' : ''}" ${act ? `data-act="emergency" data-id="${id}"` : 'disabled'}>
    <div><b>${esc(e.name)}</b> <span class="em-kind">${KIND_NAMES[e.kind]}</span></div>
    <div class="small">${esc(e.desc)}</div>
    ${warning ? `<div class="small danger">⚠ ${esc(warning)}</div>` : ''}
  </button>`;
}

const KIND_HELP = 'Party-wide: whatever anyone in the run does counts, even if your hero dies. Personal: your own hero has to carry it out (or an Undertaker for them), and what has to come out can’t go in.';

/** The Village screen's Wellbeing and the two Emergencies to pick from, by name (hover for the rest). */
function emergencyHtml(v: VillageView, lobby: LobbyView | null): string {
  const chips = v.offered.map((id) => {
    const e = EMERGENCIES[id];
    const warning = emergencyWarning(id, { cr: lobby?.cr, rites: v.kit.rites });
    const tip = `${e.name} (${KIND_NAMES[e.kind]}): ${e.desc}${warning ? `\n⚠ ${warning}` : ''}`;
    return `<button class="em-chip ${e.kind} ${v.emergency === id ? 'selected' : ''}" data-act="emergency" data-id="${id}" title="${esc(tip)}">⚑ ${esc(e.name)}${warning ? ' <span class="danger">⚠</span>' : ''}</button>`;
  }).join('');
  return `<div class="vv-em" title="${esc(`Do the Emergency for +1 Wellbeing, fail it for −1. ${WELLBEING.win} wins, ${WELLBEING.lose} loses.\n${KIND_HELP}`)}">
    <span>Wellbeing ${wellbeingPips(v.wellbeing)}</span><span class="${v.emergency ? 'muted' : 'danger'} small">${v.emergency ? 'Emergency:' : 'Pick an Emergency:'}</span>${chips}
  </div>`;
}

/** The lobby: your Emergency, or a prompt to choose one right here. */
function lobbyEmergencyHtml(v: VillageView, cr: number, kit: Kit): string {
  if (v.fate) return `<div class="lb-panel em-box danger">Your Village’s story is over. Open the Village to go on.</div>`;
  return `<div class="lb-panel">
    <div class="vv-sub"><span class="gold">Emergency</span>${v.emergency ? '' : ' <span class="danger small">choose one to ready up</span>'}
      <span class="muted small" title="${esc(KIND_HELP)}">(?)</span><span class="lb-wb">Wellbeing ${wellbeingPips(v.wellbeing)}</span></div>
    <div class="em-row">${v.offered.map((id) => emergencyCard(id, v.emergency === id, emergencyWarning(id, { cr, rites: kit.rites }))).join('')}</div>
  </div>`;
}

/** Wellbeing hit 6 or 0: how to go on (user, for now). */
function fateHtml(v: VillageView): string {
  const won = v.fate === 'won';
  return `<div class="em-box fate ${won ? 'won' : 'lost'}">
    <h2>${won ? 'The Village prospers. You have won!' : 'The Village has fallen. The game is lost.'}</h2>
    <div class="row">
      <button class="primary" data-act="fate" data-choice="reset">Reset Wellbeing to ${WELLBEING.start}</button>
      <button data-act="fate" data-choice="restart">Start over altogether</button>
    </div>
    <div class="muted small">Reset keeps your Characters, Stash and purse. Starting over founds a new Village with an empty Stash and purse.</div>
  </div>`;
}

/** "Ilse · XP 1/2 · ★ Iron Oath · Minor Injury" for a Character on a lobby class card. */
function characterLine(c: Character): string {
  const bits = [`<b>${esc(c.name)}</b>`];
  if (c.talent) bits.push(...talentsOf(c).map((t) => `<span class="talent-star" title="${esc(TALENTS[t].desc)}">★ ${esc(TALENTS[t].name)}</span>`));
  else bits.push(talentPending(c) ? '<span class="gold">Talent ready!</span>' : `XP ${c.xp}/${VILLAGE_RULES.xpForTalent}`);
  for (const i of c.injuries) bits.push(`<span class="injury ${i}">${INJURY_NAMES[i]}</span>`);
  if (c.insane) bits.push('<span class="injury major">Insane</span>');
  if (c.spec) bits.push(`<span class="spec-tag" title="${esc(SPECS[c.spec].desc)}">${esc(SPECS[c.spec].name)}</span>`);
  return bits.join(' · ');
}

/** A marker on the Village button when a Talent is waiting to be chosen. */
function villageBadge(v: VillageView | null): string {
  const talents = v?.characters.filter(talentPending).length ?? 0;
  return talents ? ` <span class="gold">(★ ${talents})</span>` : '';
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
    <div><b>Monster tiers.</b> ${TIERS.map((t) => `<span class="tier">T${t}</span> ${tierUnits(t)}`).join(' · ')} · <span class="tier">T4</span> ${ENEMIES.king.name} (only if someone wakes him)</div>
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
function crOddsText(cr: number): string {
  const base = Math.floor(cr);
  const frac = Math.round((cr - base) * 100);
  return frac ? ` ${cr} (${frac}% CR ${base + 1}, else CR ${base})` : ` ${cr}`;
}

/** The glyphs of what a lobby member is bringing from their Stash, hover for names. */
function kitBadge(kit: Kit): string {
  const items = [...GEAR_SLOTS.map((s) => kit.gear[s]).filter((x): x is ItemId => !!x), ...kit.consumables];
  const parts = items.map((it) => `<span title="${esc(ITEMS[it].name)}">${ITEMS[it].glyph}</span>`);
  parts.push(...kit.rites.map((r) => `<span class="rite-tag" title="${esc(`${RITES[r].name}: ${RITES[r].desc}`)}">${ITEMS[r].glyph}</span>`));
  return parts.length ? `<span class="kit-badge">${parts.join('')}</span>` : '';
}
