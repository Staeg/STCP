import { INVENTORY_SLOTS, ITEMS, LEAVE, type PlayerView } from '@stcp/shared';
import type { Net } from './net';
import { digitClaimed, digitKey } from './events';

const $ = (id: string) => document.getElementById(id)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Use a pack item while exploring (Smelling Salts go to a downed ally you can see). */
export function useFromField(net: Net, slot: number) {
  const view = net.cur;
  const item = view?.you.items[slot];
  if (!view || !item) return;
  const def = ITEMS[item];
  let target: string | undefined;
  if (def.target === 'downed') {
    target = view.allies.find((a) => a.live && a.downed && !a.dead)?.id;
  }
  net.intent({ type: 'useItem', index: slot, target });
}

/** How long a slot's outline flashes when an item lands in it. */
const PICKUP_FLASH_MS = 900;

/** Loot vote panel, inventory, gold and the notification feed. */
export class LootUi {
  private lastVoteHtml = '';
  private lastInvHtml = '';
  private heroId = '';
  /** What you carried last update, to spot pickups: pack contents and worn gear. */
  private prevPack: string[] | null = null;
  private prevGear: Record<string, string | null> = {};
  /** Slot key ('p0'…, 'weapon', 'armor') → when something landed in it. */
  private pickedAt = new Map<string, number>();

  constructor(private net: Net) {
    $('loot').addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-vote],[data-claim]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.vote) net.intent({ type: 'vote', choice: el.dataset.vote });
      if (el.dataset.claim) net.intent({ type: 'claim', index: Number(el.dataset.claim) });
    });
    $('inventory').addEventListener('pointerdown', (e) => {
      const gear = (e.target as HTMLElement).closest('[data-gear]') as HTMLElement | null;
      if (gear && (e.target as HTMLElement).closest('.drop')) {
        net.intent({ type: 'unequip', slot: gear.dataset.gear as 'weapon' | 'armor' });
        return;
      }
      const el = (e.target as HTMLElement).closest('[data-slot]') as HTMLElement | null;
      if (!el) return;
      const slot = Number(el.dataset.slot);
      if ((e.target as HTMLElement).closest('.drop')) net.intent({ type: 'drop', index: slot });
      else this.useFromField(slot);
    });
    addEventListener('keydown', (e) => {
      const view = this.net.cur;
      if (!view || view.encounter || (e.target as HTMLElement).tagName === 'INPUT') return;
      const digit = digitKey(e.code);
      // While a vote is up, 1, 2, 3… pick who gets it (in panel order, "Leave it" last).
      const vote = view.loot?.vote;
      if (vote && digit !== null) {
        const choice = [...vote.candidates.map((c) => c.id), LEAVE][digit];
        if (choice && vote.voters.includes(view.you.id)) net.intent({ type: 'vote', choice });
      }
      if (digit !== null && digitClaimed(view, digit)) return;
      const n = ['Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
      if (n >= 0) this.useFromField(n);
    });
  }

  private useFromField(slot: number) {
    useFromField(this.net, slot);
  }

  update(view: PlayerView | null) {
    if (!view) {
      $('loot').hidden = true;
      return;
    }
    if (view.you.id !== this.heroId) {
      // New game/hero: don't replay old notices.
      this.heroId = view.you.id;
      this.feedSince = view.time;
      this.shown.clear();
      this.prevPack = null;
      this.pickedAt.clear();
    }
    this.renderVote(view);
    this.renderInventory(view);
    this.feed(view);
  }

  private renderVote(view: PlayerView) {
    const loot = view.loot;
    const panel = $('loot');
    const showAbandoned = loot && loot.abandoned.length > 0 && !view.encounter;
    if (!loot || view.encounter || (!loot.vote && !showAbandoned)) {
      panel.hidden = true;
      this.lastVoteHtml = '';
      return;
    }
    panel.hidden = false;
    let html = '';
    const vote = loot.vote;
    if (vote) {
      const def = ITEMS[vote.item];
      const nameOf = (id: string) => (id === view.you.id ? 'You' : view.allies.find((a) => a.id === id)?.name ?? '?');
      const colorOf = (id: string) => (id === view.you.id ? view.you.color : view.allies.find((a) => a.id === id)?.color ?? '#888');
      const backers = (choice: string) =>
        vote.voters.filter((v) => vote.votes[v] === choice).map((v) => `<span class="dot" style="background:${colorOf(v)}" title="${esc(nameOf(v))}"></span>`).join('');
      const mine = vote.votes[view.you.id];
      const canVote = vote.voters.includes(view.you.id);
      const options = vote.candidates.map((c, i) => `
        <button class="vote-opt ${mine === c.id ? 'sel' : ''}" data-vote="${c.id}" ${canVote ? '' : 'disabled'}>
          <kbd>${i + 1}</kbd> ${esc(c.id === view.you.id ? 'Me' : c.name)}${c.isBot ? ' <span class="muted">(bot)</span>' : ''}
          <span class="muted small">${c.wearing !== undefined ? (c.wearing ? `has ${esc(ITEMS[c.wearing].name)}` : 'nothing worn') : `${c.free} free`}</span>
          <div class="backers">${backers(c.id)}</div>
        </button>`).join('');
      const pending = vote.voters.filter((v) => !vote.votes[v]).map(nameOf);
      const agreed = vote.voters.every((v) => vote.votes[v] && vote.votes[v] === vote.votes[vote.voters[0]]);
      html += `
        <div class="loot-head"><span class="item-glyph">${def.glyph}</span> <b>${def.name}</b> <span class="muted">— ${esc(def.desc)}</span></div>
        <div class="muted">Who takes it?${loot.queued.length ? ` <span class="small">(${loot.queued.length} more after this)</span>` : ''}</div>
        <div class="vote-opts">${options}
          <button class="vote-opt leave ${mine === LEAVE ? 'sel' : ''}" data-vote="${LEAVE}" ${canVote ? '' : 'disabled'}><kbd>${vote.candidates.length + 1}</kbd> Leave it<div class="backers">${backers(LEAVE)}</div></button>
        </div>
        <div class="lock">${agreed ? 'Agreed!' : `Everyone here must agree. Walking out takes you out of the vote.${pending.length ? ` Waiting on: ${esc(pending.join(', '))}` : ' You disagree.'}`}</div>`;
    }
    if (showAbandoned) {
      html += `<div class="abandoned muted">Left here: ${loot.abandoned.map((it, i) => `${ITEMS[it].glyph} ${ITEMS[it].name} <button class="mini" data-claim="${i}">claim</button>`).join(' ')}</div>`;
    }
    if (html !== this.lastVoteHtml) {
      panel.innerHTML = html;
      this.lastVoteHtml = html;
    }
  }

  /** Flash the outline of whatever just went into your pack or onto your back. */
  private spotPickups(view: PlayerView) {
    const you = view.you;
    const now = performance.now();
    if (this.prevPack) {
      // Anything there are more of than before is new; picked-up items go on the end of the pack.
      const left = new Map<string, number>();
      for (const it of this.prevPack) left.set(it, (left.get(it) ?? 0) + 1);
      const fresh = new Set<number>();
      for (let i = you.items.length - 1; i >= 0; i--) {
        const n = left.get(you.items[i]) ?? 0;
        if (n > 0) left.set(you.items[i], n - 1);
        else fresh.add(i);
      }
      for (const i of fresh) this.pickedAt.set(`p${i}`, now);
      for (const slot of ['weapon', 'armor'] as const) {
        if (you[slot] && you[slot] !== this.prevGear[slot]) this.pickedAt.set(slot, now);
      }
    }
    this.prevPack = [...you.items];
    this.prevGear = { weapon: you.weapon, armor: you.armor };
    for (const [k, t] of this.pickedAt) if (now - t > PICKUP_FLASH_MS) this.pickedAt.delete(k);
  }

  /** ` picked` plus an animation offset, while a slot's pickup flash is playing. */
  private flashAttr(key: string): { cls: string; style: string } {
    const t = this.pickedAt.get(key);
    if (t === undefined) return { cls: '', style: '' };
    return { cls: ' picked', style: ` style="animation-delay:-${Math.round(performance.now() - t)}ms"` };
  }

  private renderInventory(view: PlayerView) {
    this.spotPickups(view);
    const you = view.you;
    const slots = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const item = you.items[i];
      if (!item) {
        slots.push(`<div class="slot-item empty"><kbd>${i + 4}</kbd></div>`);
        continue;
      }
      const def = ITEMS[item];
      const f = this.flashAttr(`p${i}`);
      slots.push(`<div class="slot-item ${def.kind}${f.cls}"${f.style} data-slot="${i}" title="${esc(`${def.name}: ${def.desc}`)}">
        <kbd>${i + 4}</kbd><span class="item-glyph">${def.glyph}</span><span class="item-name">${def.name}</span>
        <span class="drop" title="Drop on the floor">✕</span></div>`);
    }
    const gear = (['weapon', 'armor'] as const).map((slot) => {
      const item = you[slot];
      if (!item) return `<div class="slot-item gear empty" title="No ${slot}"><span class="muted small">${slot === 'weapon' ? 'No weapon' : 'No armor'}</span></div>`;
      const def = ITEMS[item];
      const f = this.flashAttr(slot);
      return `<div class="slot-item gear ${slot}${f.cls}"${f.style} data-gear="${slot}" title="${esc(`${def.name}: ${def.desc}`)}">
        <span class="item-glyph">${def.glyph}</span><span class="item-name">${def.name}</span>
        <span class="drop" title="Take it off and drop it">✕</span></div>`;
    });
    const html = `<div class="gold">⛀ ${you.gold} gold</div><div class="slots-row gear-row">${gear.join('')}</div><div class="slots-row">${slots.join('')}</div>`;
    if (html !== this.lastInvHtml) {
      $('inventory').innerHTML = html;
      this.lastInvHtml = html;
    }
  }

  /** Toast any messages newer than the last one we showed. */
  private feed(view: PlayerView) {
    for (const m of view.you.messages) {
      const key = `${m.time}|${m.text}`;
      // Skip old news (e.g. a background tab catching up): toasts are for the last few seconds.
      if (m.time < this.feedSince || m.time < view.time - 4 || this.shown.has(key)) continue;
      this.shown.add(key);
      this.toast(m.text);
    }
    if (this.shown.size > 200) this.shown = new Set([...this.shown].slice(-50));
  }
  private shown = new Set<string>();
  private feedSince = 0;

  private toast(text: string) {
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.textContent = text;
    $('feed').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
}
