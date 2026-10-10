import { CLASSES, type EventChoice, type LootItemView, type PlayerView } from '@stcp/shared';
import type { Net } from './net';
import { iconize } from './icons';
import { spriteUrl } from './render/sprites';

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
    // 1, 2, 3…: the choices in order.
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || $('event').hidden) return;
      const n = digitKey(e.code);
      const btn = n === null ? null : ($('event').querySelectorAll('button[data-choice]')[n] as HTMLButtonElement | undefined);
      if (btn && !btn.disabled) net.intent({ type: 'event', choice: btn.dataset.choice! });
    });
  }

  update(view: PlayerView | null) {
    const panel = $('event');
    const ev = view?.event;
    if (!view || !ev || view.loot?.items.length) {
      panel.hidden = true;
      this.lastHtml = '';
      return;
    }
    panel.hidden = false;
    const channelling = view.you.channel?.kind === 'event';
    const w = ev.worker;
    const who = w
      ? `<div class="ev-worker ${w.you ? 'you' : ''}">${w.you ? 'You are' : `${esc(w.name)} is`} ${esc(w.doing)} · ${Math.ceil(w.secondsLeft)}s left${w.you ? ' <span class="muted small">(moving away starts it over)</span>' : ''}</div>`
      : '';
    const progress = w || (ev.progress ?? 0) > 0
      ? `<div class="ev-progress"><div style="width:${((ev.progress ?? 0) * 100).toFixed(0)}%"></div></div>
         ${who || `<div class="muted small">${Math.round((ev.progress ?? 0) * 100)}% done</div>`}`
      : '';
    const choices = ev.blocked
      ? '<div class="muted">Deal with the monsters first.</div>'
      : ev.choices.map((c, i) => {
          // Picked: it starts when your timer runs out.
          const queued = view.you.queuedEvent === c.id
            ? `<div class="small">✔ starts in ${Math.max(0, view.you.turnAt - view.time).toFixed(1)}s</div>` : '';
          return `<button data-choice="${c.id}" ${c.disabled || channelling ? 'disabled' : ''} title="${esc(c.disabled ?? '')}">
          <kbd>${i + 1}</kbd> ${perkIcon(c)}${iconize(c.label)}${perkText(c)}${c.disabled ? `<div class="muted small">${esc(c.disabled)}</div>` : ''}${queued}</button>`;
        }).join('');
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

/** A class twist on this choice: the class's sprite beside the label… */
function perkIcon(c: EventChoice): string {
  if (!c.perk) return '';
  const cls = CLASSES[c.perk.cls];
  return `<img class="ev-perk-icon" src="${spriteUrl(cls.id, cls.color)}" alt="${cls.name}" title="${cls.name}"> `;
}

/** …and under it only what's special about doing it as that class. */
function perkText(c: EventChoice): string {
  return c.perk ? `<div class="ev-perk" style="--cls:${CLASSES[c.perk.cls].color}">${esc(c.perk.text)}</div>` : '';
}

/** Digit1…Digit9 → 0…8, anything else → null. */
export function digitKey(code: string): number | null {
  const m = /^Digit([1-9])$/.exec(code);
  return m ? Number(m[1]) - 1 : null;
}

/** Number keys that an event or loot vote on screen claims, so the item hotkeys leave them alone. */
export function digitClaimed(view: PlayerView, n: number): boolean {
  if (view.encounter) return false;
  const loot = view.loot;
  if (loot?.items.length && loot.voters.includes(view.you.id)) {
    if (loot.voters.length === 1) return n < Math.min(loot.items.length, 6); // alone: take that card
    const f = keyedLootItem(view);
    return !!f && n <= f.candidates.length; // candidates, then "Leave it"
  }
  return !!view.event && !view.event.blocked && n < view.event.choices.length;
}

/** With others around, the loot card the number keys vote on: the first you haven't voted on, else the first unsettled. */
export function keyedLootItem(view: PlayerView): LootItemView | null {
  const loot = view.loot;
  if (!loot || !loot.voters.includes(view.you.id)) return null;
  const me = view.you.id;
  const settled = (f: LootItemView) => loot.voters.every((v) => f.votes[v] && f.votes[v] === f.votes[me]);
  const cards = loot.items.slice(0, 6);
  return cards.find((f) => !f.votes[me]) ?? cards.find((f) => !settled(f)) ?? null;
}
