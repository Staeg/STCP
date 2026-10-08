import { CLASSES, nextTitle, type PlayerView } from '@stcp/shared';
import { hallOfFortune } from './screens';
import { fmtTime } from './hud';
import type { Net } from './net';

const $ = (id: string) => document.getElementById(id)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** End-of-run screen: everyone's fate, and the full story the fog was hiding. */
export class ResultsUi {
  private lastHtml = '';

  constructor(private net: Net) {
    $('results').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="lobby"]')) net.send({ t: 'toLobby' });
      if ((e.target as HTMLElement).closest('[data-act="map"]')) $('results').classList.toggle('peek');
    });
  }

  update(view: PlayerView | null) {
    const el = $('results');
    const res = view?.results;
    if (!view || !res) {
      el.hidden = true;
      el.classList.remove('peek');
      this.lastHtml = '';
      return;
    }
    el.hidden = false;
    const me = res.heroes.find((h) => h.id === view.you.id)!;
    const title = me.outcome === 'escaped' ? `You escaped with ${me.gold} gold` : `You ${me.fate}`;
    const sub =
      view.phase === 'wiped' ? 'Nobody made it out.'
      : view.phase === 'collapsed' ? 'The dungeon has collapsed.'
      : 'The expedition is over.';
    const isHost = this.net.lobby?.hostId === this.net.lobby?.youId;
    const member = this.net.lobby?.members.find((m) => m.id === view.you.id);
    const stash = member?.stash;
    const next = stash !== undefined ? nextTitle(stash) : null;
    const rows = res.heroes
      .slice()
      .sort((a, b) => Number(b.outcome === 'escaped') - Number(a.outcome === 'escaped') || b.gold - a.gold)
      .map((h) => `<tr class="${h.outcome}">
        <td><span class="swatch" style="background:${h.color}"></span> ${esc(h.name)}${h.isBot ? ' <span class="muted">(bot)</span>' : ''}</td>
        <td class="muted">${CLASSES[h.cls].name}</td>
        <td>${h.outcome === 'escaped' ? '⚑' : '✝'} ${esc(h.fate)}</td>
        <td class="muted">${h.time !== null ? fmtTime(h.time) : ''}</td>
      </tr>`)
      .join('');
    const story = res.chronicle
      .map((c) => `<div class="chron"><span class="muted">${fmtTime(c.time)}</span> ${esc(c.text)}</div>`)
      .join('');
    const html = `<div class="card wide results-card">
      <h1 class="${me.outcome}">${esc(title)}</h1>
      <div class="muted">${sub}${stash !== undefined ? ` · Career: <span class="gold">${stash} gold</span> · <span class="title-tag">${esc(member!.title)}</span>${next ? ` (${next.at - stash} more for ${esc(next.title)})` : ''}` : ''}</div>
      <table class="fates">${rows}</table>
      ${hallOfFortune(this.net.leaderboard, this.net.name)}
      <h3>What really happened</h3>
      <div class="chronicle">${story}</div>
      <div class="row">
        ${isHost ? '<button class="primary" data-act="lobby">Return to lobby</button>' : '<span class="muted">Waiting for the host…</span>'}
        <button class="quiet" data-act="map">Toggle map</button>
      </div>
    </div>`;
    if (html !== this.lastHtml) {
      el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
