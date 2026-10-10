import {
  abilitiesFor, AFFLICTIONS, CLASS_IDS, CLASSES, CR_RULES, ENEMIES, INJURY_NAMES, injuredMaxHp, talentPending, TALENTS, talentsFor, VILLAGE_RULES,
  type Character, type LeaderboardEntry, type LobbyView, type TalentId, type Treatment, type VillageView,
} from '@stcp/shared';
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
      <div class="cr-line" title="Challenge Rating: one for every hero with a Talent, bots included. Each point: +${Math.round(CR_RULES.goldPerCr * 100)}% gold. Lantern Wights from CR 1, the Forsaken Queen from CR 3.">
        Challenge Rating <b>${lobby.cr}</b>${lobby.cr < 4 ? ' <span class="muted">(bots borrowing Talented Characters add to it)</span>' : ''}
        · <span class="muted">gold ×${(1 + CR_RULES.goldPerCr * lobby.cr).toFixed(2)}</span>
      </div>
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
      case 'talent':
        net.send({ t: 'chooseTalent', charId: btn.dataset.char!, talent: btn.dataset.talent as TalentId });
        break;
      case 'treat':
        net.send({ t: 'treat', charId: btn.dataset.char!, what: btn.dataset.what as Treatment });
        break;
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
    <div class="row muted small">Talents raise the Challenge Rating: more gold, but ${ENEMIES.wight.name}s from CR 1 and the ${ENEMIES.queen.name} from CR 3.</div>
    <div class="row"><button class="primary" data-act="village-close">Back</button></div>
  </div>`;
}
