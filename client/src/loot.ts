import { INVENTORY_SLOTS, itemTier, ITEMS, LEAVE, type ItemId, type LootItemView, type PlayerView } from '@stcp/shared';
import type { Net } from './net';
import { iconize } from './icons';
import { digitClaimed, digitKey, keyedLootItem } from './events';

const $ = (id: string) => document.getElementById(id)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** An item's name, coloured by tier (white · blue · purple). */
export function itemName(item: ItemId): string {
  return `<span class="tier-${itemTier(item)}">${esc(ITEMS[item].name)}</span>`;
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
/** A picked-up card's flight to your character sheet. */
const FLY_MS = 480;
/** How long a vanished card waits for its item to turn up in your pack (else someone else got it). */
const GONE_MS = 1500;
/** Cards side by side at most (rooms hold no more finds than this); any extra go in the small row. */
const MAX_CARDS = 6;

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
  /** Cards that just left the panel: where they were, in case their item lands in your pack. */
  private gone: { item: ItemId; rect: DOMRect; at: number }[] = [];
  /** Slots something landed in this update, waiting for their flight once the inventory is drawn. */
  private landed: { key: string; item: ItemId }[] = [];

  constructor(private net: Net) {
    $('loot').addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest('[data-vote],[data-claim],[data-take]') as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const me = this.net.cur?.you.id;
      if (el.dataset.take && me) net.intent({ type: 'vote', item: Number(el.dataset.take), choice: me });
      if (el.dataset.vote) net.intent({ type: 'vote', item: Number(el.dataset.item), choice: el.dataset.vote });
      if (el.dataset.claim) net.intent({ type: 'claim', item: Number(el.dataset.claim) });
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
      // Alone, 1, 2, 3… take that card. With others, they pick who gets the highlighted card ("Leave it" last).
      const loot = view.loot;
      if (loot && digit !== null && loot.voters.includes(view.you.id)) {
        if (loot.voters.length === 1) {
          const f = loot.items[digit];
          if (f && digit < MAX_CARDS) net.intent({ type: 'vote', item: f.id, choice: view.you.id });
        } else {
          const f = keyedLootItem(view);
          const choice = f && [...f.candidates.map((c) => c.id), LEAVE][digit];
          if (f && choice) net.intent({ type: 'vote', item: f.id, choice });
        }
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

  /**
   * Everything on the floor at once, as cards. Alone: click a card to take it (walking on leaves it). With others:
   * each card has its own vote on who gets it. Items nobody here wants lie in a quiet row underneath.
   */
  private renderVote(view: PlayerView) {
    const loot = view.loot;
    const panel = $('loot');
    const items = loot?.items ?? [];
    const ignored = loot?.ignored ?? [];
    if (!loot || view.encounter || view.results || (items.length === 0 && ignored.length === 0)) {
      if (!panel.hidden) {
        this.noteGone(new Set());
        panel.innerHTML = '';
      }
      panel.hidden = true;
      this.lastVoteHtml = '';
      return;
    }
    const me = view.you.id;
    const canVote = loot.voters.includes(me);
    const solo = canVote && loot.voters.length === 1;
    const nameOf = (id: string) => (id === me ? 'You' : view.allies.find((a) => a.id === id)?.name ?? '?');
    const colorOf = (id: string) => (id === me ? view.you.color : view.allies.find((a) => a.id === id)?.color ?? '#888');
    const keyed = solo ? null : keyedLootItem(view);
    const shown = items.slice(0, MAX_CARDS);

    const card = (f: LootItemView, i: number) => {
      const def = ITEMS[f.item];
      const head = `<div class="lc-glyph item-glyph">${def.glyph}</div>
        <div class="lc-name">${itemName(f.item)}</div>
        <div class="lc-desc">${iconize(def.desc)}</div>`;
      if (solo) {
        return `<button class="loot-card take" data-id="${f.id}" data-what="${f.item}" data-take="${f.id}" title="Take it"><kbd>${i + 1}</kbd>${head}</button>`;
      }
      const backers = (choice: string) =>
        loot.voters.filter((v) => f.votes[v] === choice).map((v) => `<span class="dot" style="background:${colorOf(v)}" title="${esc(nameOf(v))}"></span>`).join('');
      const mine = f.votes[me];
      const hot = keyed?.id === f.id;
      const opt = (choice: string, n: number, label: string, extra = '') => `
        <button class="vote-opt ${mine === choice ? 'sel' : ''} ${choice === LEAVE ? 'leave' : ''}" data-item="${f.id}" data-vote="${choice}" ${canVote ? '' : 'disabled'}>
          ${hot ? `<kbd>${n + 1}</kbd> ` : ''}${label}${extra}<span class="backers">${backers(choice)}</span>
        </button>`;
      const opts = f.candidates.map((c, n) => opt(c.id, n, esc(c.id === me ? 'Me' : c.name),
        ` <span class="muted small">${c.wearing !== undefined ? (c.wearing ? `has ${itemName(c.wearing)}` : 'nothing worn') : `${c.free} free`}</span>`));
      const agreed = loot.voters.every((v) => f.votes[v] && f.votes[v] === f.votes[loot.voters[0]]);
      return `<div class="loot-card ${hot ? 'hot' : ''} ${agreed ? 'agreed' : ''}" data-id="${f.id}" data-what="${f.item}">${head}
        <div class="lc-opts">${opts.join('')}${opt(LEAVE, f.candidates.length, 'Leave it')}</div></div>`;
    };

    let html = '';
    if (shown.length) {
      const cols = shown.length <= 3 ? shown.length : shown.length === 4 ? 2 : 3;
      const pending = loot.voters.filter((v) => items.some((f) => !f.votes[v])).map(nameOf);
      const hint = solo
        ? 'Click what you want to take. Walk on to leave the rest.'
        : `Everyone here must agree on each one. Walking out takes you out of the vote.${pending.length ? ` Waiting on: ${esc(pending.join(', '))}` : ''}`;
      html += `<div class="loot-grid ${solo ? 'solo' : 'group'} n${shown.length}" style="--cols:${cols}">${shown.map(card).join('')}</div>
        <div class="lock">${hint}</div>`;
    }
    const rest = [...items.slice(MAX_CARDS), ...ignored];
    if (rest.length) {
      const verb = solo || (canVote && loot.voters.length === 1) ? 'take' : 'claim';
      html += `<div class="abandoned muted">${items.length ? 'Also here' : 'Lying here, passed over'}: ${rest.map((f) =>
        `${ITEMS[f.item].glyph} ${itemName(f.item)} <button class="mini" data-id="${f.id}" data-claim="${f.id}">${verb}</button>`).join(' ')}</div>`;
    }
    panel.hidden = false;
    panel.classList.toggle('quiet', shown.length === 0);
    panel.style.setProperty('--card-w', solo ? '190px' : '230px');
    if (html !== this.lastVoteHtml) {
      this.noteGone(new Set(items.map((f) => f.id)));
      panel.innerHTML = html;
      this.lastVoteHtml = html;
    }
  }

  /** Before a re-render: remember where cards that are about to vanish sat, so a pickup can fly from there. */
  private noteGone(stillHere: Set<number>) {
    const now = performance.now();
    for (const el of $('loot').querySelectorAll<HTMLElement>('.loot-card[data-id]')) {
      const id = Number(el.dataset.id);
      const item = el.dataset.what;
      if (stillHere.has(id) || !item) continue;
      const glyph = el.querySelector('.lc-glyph');
      this.gone.push({ item: item as ItemId, rect: (glyph ?? el).getBoundingClientRect(), at: now });
    }
    this.gone = this.gone.filter((g) => now - g.at < GONE_MS);
  }

  /** A card's item just landed in a slot: send a ghost of it flying over there, then flash the slot. */
  private flyIn(item: ItemId, key: string, now: number): boolean {
    const i = this.gone.findIndex((g) => g.item === item);
    const target = $('inventory').querySelector<HTMLElement>(key.startsWith('p') ? `[data-slot="${key.slice(1)}"]` : `[data-gear="${key}"]`);
    if (i < 0 || !target) return false;
    const from = this.gone.splice(i, 1)[0].rect;
    const to = target.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'fly-ghost item-glyph';
    ghost.innerHTML = ITEMS[item].glyph;
    document.body.appendChild(ghost);
    const size = Math.max(32, Math.min(from.width, from.height));
    ghost.style.cssText = `left:${from.left + from.width / 2 - size / 2}px;top:${from.top + from.height / 2 - size / 2}px;width:${size}px;height:${size}px;font-size:${size * 0.8}px`;
    const dx = to.left + 14 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    ghost.animate(
      [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${16 / size})`, opacity: 0.9 }],
      { duration: FLY_MS, easing: 'cubic-bezier(0.45, 0, 0.7, 0.4)' },
    ).onfinish = () => ghost.remove();
    this.pickedAt.set(key, now + FLY_MS); // the slot flashes as it lands
    return true;
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
      for (const i of fresh) this.landed.push({ key: `p${i}`, item: you.items[i] });
      for (const slot of ['weapon', 'armor'] as const) {
        if (you[slot] && you[slot] !== this.prevGear[slot]) this.landed.push({ key: slot, item: you[slot]! });
      }
      for (const l of this.landed) this.pickedAt.set(l.key, now);
    }
    this.prevPack = [...you.items];
    this.prevGear = { weapon: you.weapon, armor: you.armor };
    for (const [k, t] of this.pickedAt) if (now - t > PICKUP_FLASH_MS) this.pickedAt.delete(k);
  }

  /** ` picked` plus an animation offset, while a slot's pickup flash is playing. */
  private flashAttr(key: string): { cls: string; style: string } {
    const t = this.pickedAt.get(key);
    if (t === undefined) return { cls: '', style: '' };
    // Negative once it's playing (pick up where it is); positive while a pickup is still flying in.
    return { cls: ' picked', style: ` style="animation-delay:${Math.round(t - performance.now())}ms"` };
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
        <kbd>${i + 4}</kbd><span class="item-glyph">${def.glyph}</span><span class="item-name">${itemName(item)}</span>
        <span class="drop" title="Drop on the floor">✕</span></div>`);
    }
    const gear = (['weapon', 'armor'] as const).map((slot) => {
      const item = you[slot];
      if (!item) return `<div class="slot-item gear empty" title="No ${slot}"><span class="muted small">${slot === 'weapon' ? 'No weapon' : 'No armor'}</span></div>`;
      const def = ITEMS[item];
      const f = this.flashAttr(slot);
      return `<div class="slot-item gear ${slot}${f.cls}"${f.style} data-gear="${slot}" title="${esc(`${def.name}: ${def.desc}`)}">
        <span class="item-glyph">${def.glyph}</span><span class="item-name">${itemName(item)}</span>
        <span class="drop" title="Take it off and drop it">✕</span></div>`;
    });
    const html = `<div class="gold">⛀ ${you.gold} gold</div><div class="slots-row gear-row">${gear.join('')}</div><div class="slots-row">${slots.join('')}</div>`;
    if (html !== this.lastInvHtml) {
      $('inventory').innerHTML = html;
      this.lastInvHtml = html;
    }
    // Now the slots exist: whatever just landed flies in from its card, if it came off one.
    const now = performance.now();
    for (const l of this.landed.splice(0)) this.flyIn(l.item, l.key, now);
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
