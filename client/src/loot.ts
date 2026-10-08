import { INVENTORY_SLOTS, ITEMS, LEAVE, type PlayerView } from '@stcp/shared';
import type { Net } from './net';

const $ = (id: string) => document.getElementById(id)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Loot vote panel, inventory, gold and the notification feed. */
export class LootUi {
  private lastVoteHtml = '';
  private lastInvHtml = '';
  private heroId = '';

  constructor(private net: Net) {
    $('loot').addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-vote],[data-claim]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.vote) net.intent({ type: 'vote', choice: el.dataset.vote });
      if (el.dataset.claim) net.intent({ type: 'claim', index: Number(el.dataset.claim) });
    });
    $('inventory').addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-slot]') as HTMLElement | null;
      if (!el) return;
      const slot = Number(el.dataset.slot);
      if ((e.target as HTMLElement).closest('.drop')) net.intent({ type: 'drop', index: slot });
      else this.useFromField(slot);
    });
    addEventListener('keydown', (e) => {
      const view = this.net.cur;
      if (!view || view.encounter || (e.target as HTMLElement).tagName === 'INPUT') return;
      const n = ['Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
      if (n >= 0) this.useFromField(n);
    });
  }

  private useFromField(slot: number) {
    const view = this.net.cur;
    const item = view?.you.items[slot];
    if (!view || !item) return;
    const def = ITEMS[item];
    let target: string | undefined;
    if (def.target === 'downed') {
      target = view.allies.find((a) => a.live && a.downed && !a.dead)?.id;
    }
    this.net.intent({ type: 'useItem', index: slot, target });
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
      const options = vote.candidates.map((c) => `
        <button class="vote-opt ${mine === c.id ? 'sel' : ''}" data-vote="${c.id}" ${canVote ? '' : 'disabled'}>
          ${esc(c.id === view.you.id ? 'Me' : c.name)}${c.isBot ? ' <span class="muted">(bot)</span>' : ''}
          <span class="muted small">${c.free} free</span>
          <div class="backers">${backers(c.id)}</div>
        </button>`).join('');
      const pending = vote.voters.filter((v) => !vote.votes[v]).map(nameOf);
      const agreed = vote.voters.every((v) => vote.votes[v] && vote.votes[v] === vote.votes[vote.voters[0]]);
      html += `
        <div class="loot-head"><span class="item-glyph">${def.glyph}</span> <b>${def.name}</b> <span class="muted">— ${esc(def.desc)}</span></div>
        <div class="muted">Who takes it?${loot.queued.length ? ` <span class="small">(${loot.queued.length} more after this)</span>` : ''}</div>
        <div class="vote-opts">${options}
          <button class="vote-opt leave ${mine === LEAVE ? 'sel' : ''}" data-vote="${LEAVE}" ${canVote ? '' : 'disabled'}>Leave it<div class="backers">${backers(LEAVE)}</div></button>
        </div>
        <div class="lock">🔒 ${agreed ? 'Agreed!' : `Nobody here can leave until you all agree.${pending.length ? ` Waiting on: ${esc(pending.join(', '))}` : ' You disagree.'}`}</div>`;
    }
    if (showAbandoned) {
      html += `<div class="abandoned muted">Left here: ${loot.abandoned.map((it, i) => `${ITEMS[it].glyph} ${ITEMS[it].name} <button class="mini" data-claim="${i}">claim</button>`).join(' ')}</div>`;
    }
    if (html !== this.lastVoteHtml) {
      panel.innerHTML = html;
      this.lastVoteHtml = html;
    }
  }

  private renderInventory(view: PlayerView) {
    const you = view.you;
    const slots = [];
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const item = you.items[i];
      if (!item) {
        slots.push(`<div class="slot-item empty"><kbd>${i + 4}</kbd></div>`);
        continue;
      }
      const def = ITEMS[item];
      slots.push(`<div class="slot-item ${def.kind}" data-slot="${i}" title="${esc(`${def.name}: ${def.desc}`)}">
        <kbd>${i + 4}</kbd><span class="item-glyph">${def.glyph}</span><span class="item-name">${def.name}</span>
        <span class="drop" title="Drop on the floor">✕</span></div>`);
    }
    const html = `<div class="gold">⛀ ${you.gold} gold</div><div class="slots-row">${slots.join('')}</div>`;
    if (html !== this.lastInvHtml) {
      $('inventory').innerHTML = html;
      this.lastInvHtml = html;
    }
  }

  /** Toast any messages newer than the last one we showed. */
  private feed(view: PlayerView) {
    for (const m of view.you.messages) {
      const key = `${m.time}|${m.text}`;
      if (m.time < this.feedSince || this.shown.has(key)) continue;
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
