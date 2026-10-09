import { CLASS_IDS, CLASSES, type LeaderboardEntry, type LobbyView } from '@stcp/shared';
import type { Net } from './net';
import { SOLO } from './local';
import { spriteUrl } from './render/sprites';

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
    root().addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).id === 'code-input') this.join();
    });
  }

  /** Re-render when the lobby changes. Returns true if a screen is covering the game. */
  update(): boolean {
    const lobby = this.net.lobby;
    const el = root();
    if (lobby?.state === 'game') {
      el.hidden = true;
      this.rendered = '';
      return false;
    }
    el.hidden = false;
    const html = lobby === undefined ? `<div class="card"><h1>So They Can Prosper</h1><p>Connecting…</p></div>`
      : lobby === null ? this.menuHtml() : this.lobbyHtml(lobby);
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
    }
    return true;
  }

  private menuHtml() {
    return `<div class="card">
      <h1>So They Can Prosper</h1>
      <p class="muted">Up to four heroes. One rendezvous. Ten minutes until the exit opens.</p>
      ${SOLO ? '<p class="muted small">Solo playtest build: you and three bots, all running in this tab.</p>' : ''}
      <label>Your name<br><input id="name-input" maxlength="16" value="${esc(this.net.name)}" placeholder="Nameless"></label>
      <div class="row">
        <button data-act="create">${SOLO ? 'Start a run' : 'Start an expedition'}</button>
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
      slots.push(`<li class="slot">
        <span class="swatch" style="background:${cls?.color ?? '#333'}"></span>
        <span class="slot-name">${esc(m.name)} <span class="title-tag">${esc(m.title)}</span>${m.id === lobby.hostId ? ' <span class="muted">(host)</span>' : ''}${m.id === lobby.youId ? ' <span class="muted">(you)</span>' : ''}</span>
        <span class="muted">${cls?.name ?? 'choosing…'}</span>
        <span class="${m.ready ? 'ok' : 'muted'}">${m.connected ? (m.ready ? 'READY' : 'not ready') : 'disconnected'}</span>
      </li>`);
    }
    const taken = new Map(lobby.members.filter((m) => m.cls).map((m) => [m.cls!, m]));
    const cards = CLASS_IDS.map((id) => {
      const c = CLASSES[id];
      const owner = taken.get(id);
      const mine = owner?.id === lobby.youId;
      const disabled = owner && !mine ? 'disabled' : '';
      return `<button class="class-card ${mine ? 'selected' : ''}" data-act="class" data-cls="${id}" ${disabled} style="--cls:${c.color}">
        <img class="class-sprite" src="${spriteUrl(id, c.color)}" alt="">
        <div class="class-name">${c.name}</div>
        <div class="muted" title="Speed: seconds between turns in a fight, and to walk a tunnel. Lower is faster.">${c.role} · ${c.maxHp} HP · Speed ${c.speed}s</div>
        <div class="blurb">${c.blurb}</div>
        ${owner && !mine ? `<div class="muted">taken by ${esc(owner.name)}</div>` : ''}
      </button>`;
    }).join('');
    // Solo: no one to wait for, so Descend readies you up itself.
    const allReady = SOLO ? !!you.cls : lobby.members.every((m) => m.ready && m.cls);
    const link = `${location.origin}${location.pathname}?lobby=${lobby.code}`;
    return `<div class="card wide">
      ${SOLO ? '<div class="muted">Pick a class. Bots take the other three.</div>' : `<div class="lobby-head">
        <div><div class="muted">Lobby code</div><div class="code-big">${lobby.code}</div></div>
        <div class="muted small">Share the code, or this link:<br><a href="${link}">${esc(link)}</a></div>
      </div>`}
      <ul class="slots">${slots.join('')}</ul>
      <div class="classes">${cards}</div>
      <div class="row">
        <label>Name <input id="name-input" maxlength="16" value="${esc(you.name)}"></label>
        ${SOLO ? '' : `<button data-act="ready" ${you.cls ? '' : 'disabled'}>${you.ready ? 'Not ready' : 'Ready'}</button>`}
        ${isHost ? `<button data-act="start" ${allReady ? '' : 'disabled'} class="primary">Descend</button>` : `<span class="muted">Waiting for the host to start…</span>`}
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
