import { CLASSES, nextTitle, TALENTS, type PlayerView } from '@stcp/shared';
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
  private lastView: PlayerView | null = null;
  /** Chronicle entries (fights) opened to show their play-by-play. */
  private open = new Set<number>();

  constructor(private net: Net) {
    $('results').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="lobby"]')) {
        // Already back in the lobby (just looking at the old map): only switch views.
        if (net.reviewing) net.review(false);
        else net.send({ t: 'toLobby' });
      }
      if ((e.target as HTMLElement).closest('[data-act="map"]')) $('results').classList.toggle('peek');
      const fight = (e.target as HTMLElement).closest<HTMLElement>('[data-fight]');
      if (fight) {
        const i = Number(fight.dataset.fight);
        if (!this.open.delete(i)) this.open.add(i);
        this.update(this.lastView);
      }
    });
  }

  update(view: PlayerView | null) {
    const el = $('results');
    const res = view?.results;
    this.lastView = view;
    if (!view || !res) {
      el.hidden = true;
      el.classList.remove('peek');
      this.lastHtml = '';
      this.open.clear();
      return;
    }
    // Coming over from the lobby to look at the old map: open straight onto the map.
    if (el.hidden && this.net.reviewing) el.classList.add('peek');
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
        <td><span class="swatch" style="background:${h.color}"></span> ${esc(h.name)}${h.talent ? ` <span class="talent-star" title="${esc(TALENTS[h.talent].name)}">★</span>` : ''}${h.isBot ? ' <span class="muted">(bot)</span>' : ''}</td>
        <td class="muted">${CLASSES[h.cls].name}</td>
        <td>${h.outcome === 'escaped' ? '⚑' : '✝'} ${esc(h.fate)}</td>
        <td class="muted">${h.time !== null ? fmtTime(h.time) : ''}</td>
      </tr>`)
      .join('');
    // Fights open (click) to show their play-by-play, timed from the fight's start.
    const story = res.chronicle
      .map((c, i) => {
        if (!c.fight) return `<div class="chron"><span class="muted">${fmtTime(c.time)}</span> ${esc(c.text)}</div>`;
        const open = this.open.has(i);
        const lines = open
          ? `<div class="fight-log">${c.fight.lines.map((l) => `<div><span class="muted">+${l.t.toFixed(1)}s</span> ${esc(l.text)}</div>`).join('')}</div>`
          : '';
        return `<div class="chron fight${open ? ' open' : ''}" data-fight="${i}" title="Show the play-by-play"><span class="muted">${fmtTime(c.time)}</span> <span class="fight-caret">${open ? '▾' : '▸'}</span> ${esc(c.text)}</div>${lines}`;
      })
      .join('');
    // What the run did to your Village Character (the server sends it as the run ends).
    const report = this.net.village?.report.length
      ? `<div class="results-report">${this.net.village.report.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : '';
    const cr = view.cr > 0 ? ` · Challenge Rating ${view.cr}` : '';
    const html = `<div class="card wide results-card">
      <h1 class="${me.outcome}">${esc(title)}</h1>
      <div class="muted">${sub}${cr}${stash !== undefined ? ` · Career: <span class="gold">${stash} gold</span> · <span class="title-tag">${esc(member!.title)}</span>${next ? ` (${next.at - stash} more for ${esc(next.title)})` : ''}` : ''}</div>
      ${report}
      <table class="fates">${rows}</table>
      ${hallOfFortune(this.net.leaderboard, this.net.name)}
      <h3>What really happened</h3>
      <div class="chronicle">${story}</div>
      <div class="row">
        ${this.net.reviewing ? '<button class="primary" data-act="lobby">Back to lobby</button>'
          : isHost ? '<button class="primary" data-act="lobby">Return to lobby</button>' : '<span class="muted">Waiting for the host…</span>'}
        <button class="quiet" data-act="map">Toggle map</button>
      </div>
    </div>`;
    if (html !== this.lastHtml) {
      // Keep the chronicle where it was scrolled to (opening a fight re-renders it).
      const scroll = el.querySelector('.chronicle')?.scrollTop ?? 0;
      el.innerHTML = html;
      this.lastHtml = html;
      const chron = el.querySelector('.chronicle');
      if (chron) chron.scrollTop = scroll;
    }
  }
}
