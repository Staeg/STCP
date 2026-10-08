import type { PlayerView } from '@stcp/shared';
import type { Net } from './net';

const $ = (id: string) => document.getElementById(id)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The event in your room: flavour text, choices (first come, first served) and channel progress. */
export class EventUi {
  private lastHtml = '';

  constructor(net: Net) {
    $('event').addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement).closest('button[data-choice]') as HTMLButtonElement | null;
      if (btn && !btn.disabled) net.intent({ type: 'event', choice: btn.dataset.choice! });
    });
  }

  update(view: PlayerView | null) {
    const panel = $('event');
    const ev = view?.event;
    if (!view || !ev || view.loot?.vote) {
      panel.hidden = true;
      this.lastHtml = '';
      return;
    }
    panel.hidden = false;
    const channelling = view.you.channel?.kind === 'event';
    const w = ev.worker;
    const who = w
      ? `<div class="ev-worker ${w.you ? 'you' : ''}">${w.you ? 'You are' : `${esc(w.name)} is`} ${esc(w.doing)} · ${Math.ceil(w.secondsLeft)}s left${w.you ? ' <span class="muted small">(moving stops it; progress is kept)</span>' : ''}</div>`
      : '';
    const progress = w || (ev.progress ?? 0) > 0
      ? `<div class="ev-progress"><div style="width:${((ev.progress ?? 0) * 100).toFixed(0)}%"></div></div>
         ${who || `<div class="muted small">${Math.round((ev.progress ?? 0) * 100)}% done</div>`}`
      : '';
    const choices = ev.blocked
      ? '<div class="muted">Deal with the monsters first.</div>'
      : ev.choices.map((c) => `<button data-choice="${c.id}" ${c.disabled || channelling ? 'disabled' : ''} title="${esc(c.disabled ?? '')}">
          ${esc(c.label)}${c.disabled ? `<div class="muted small">${esc(c.disabled)}</div>` : ''}</button>`).join('');
    const html = `
      <div class="ev-head"><span class="item-glyph">${ev.glyph}</span> <b>${esc(ev.name)}</b></div>
      <div class="ev-text">${esc(ev.text)}</div>
      ${progress}
      <div class="ev-choices">${choices}<span class="muted small">or just walk away</span></div>`;
    if (html !== this.lastHtml) {
      panel.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
