import {
  CLASSES, CODEX_ENEMIES, ESCALATION, CODEX_EVENTS, CODEX_ITEMS, ELITE_NOTE, ENEMIES, EVENT_RULES, EVENTS, fmtSpeed, ITEMS, slotOf, type EnemyId, type EventKind, type ItemId,
  type TwistId, TWISTS, type VillageView,
} from '@stcp/shared';
import { iconize, iconNum } from './icons';
import { itemName } from './loot';
import { spriteUrl } from './render/sprites';

/** The Village's three books of what you've come across (user, 2026-10-11). */
export type CodexTab = 'armory' | 'bestiary' | 'archive';
export const CODEX_TABS: { id: CodexTab; name: string; what: string }[] = [
  { id: 'armory', name: 'Armory', what: 'items' },
  { id: 'bestiary', name: 'Bestiary', what: 'monsters' },
  { id: 'archive', name: 'Archive', what: 'events' },
];

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The Armory, Bestiary or Archive: every entry, those not come across yet as "???". */
export function codexHtml(v: VillageView, tab: CodexTab): string {
  const c = v.codex;
  const counts: Record<CodexTab, string> = {
    armory: `${c.items.length}/${CODEX_ITEMS.length}`,
    bestiary: `${c.enemies.length}/${CODEX_ENEMIES.length}`,
    archive: `${c.events.length}/${CODEX_EVENTS.length}`,
  };
  const tabs = CODEX_TABS.map((t) => `<button class="cx-tab ${t.id === tab ? 'selected' : ''}" data-act="codex" data-tab="${t.id}">${t.name} <span class="muted">${counts[t.id]}</span></button>`).join('');
  const body = tab === 'armory' ? armoryHtml(c.items) : tab === 'bestiary' ? bestiaryHtml(c.enemies) : archiveHtml(c.events, c.twists ?? []);
  const what = CODEX_TABS.find((t) => t.id === tab)!.what;
  return `<div class="card codex">
    <div class="vv-head">
      <h1>${CODEX_TABS.find((t) => t.id === tab)!.name}</h1>
      <span class="cx-tabs">${tabs}</span>
      <button class="primary vv-back" data-act="codex-close">Back to the Village</button>
    </div>
    <div class="muted cx-sub">Every ${what.slice(0, -1)} your heroes have come across in the dungeon. The rest are still out there.</div>
    <div class="cx-body">${body}</div>
  </div>`;
}

const unknown = () => '<div class="cx-entry unknown"><div class="cx-glyph">?</div><div class="cx-name">???</div></div>';

function section(title: string, entries: string[]): string {
  return entries.length ? `<div class="cx-section"><div class="cx-title">${title}</div><div class="cx-grid">${entries.join('')}</div></div>` : '';
}

const ITEM_GROUPS: { title: string; has: (it: ItemId) => boolean }[] = [
  { title: 'Consumables', has: (it) => ITEMS[it].kind === 'consumable' },
  { title: 'Resources and valuables', has: (it) => ITEMS[it].kind === 'resource' || ITEMS[it].kind === 'valuable' },
  { title: 'Weapons', has: (it) => slotOf(it) === 'weapon' },
  { title: 'Armour', has: (it) => slotOf(it) === 'armor' },
  { title: 'Amulets', has: (it) => slotOf(it) === 'amulet' },
  { title: 'Rings', has: (it) => slotOf(it) === 'ring' },
];

function armoryHtml(found: readonly ItemId[]): string {
  return ITEM_GROUPS.map((g) => section(g.title, CODEX_ITEMS.filter(g.has).map((it) => {
    if (!found.includes(it)) return unknown();
    const d = ITEMS[it];
    return `<div class="cx-entry"><div class="cx-glyph">${d.glyph}</div><div class="cx-name">${itemName(it)}</div><div class="cx-desc">${iconize(d.desc)}</div></div>`;
  }))).join('');
}

function bestiaryHtml(found: readonly EnemyId[]): string {
  const tiers = [0, 1, 2, 3, 4] as const;
  return tiers.map((t) => section(t === 4 ? 'Tier 4 · Bosses' : `Tier ${t}`, CODEX_ENEMIES.filter((e) => ENEMIES[e].tier === t).map((e) => {
    if (!found.includes(e)) return unknown();
    const d = ENEMIES[e];
    const stats = `${iconNum('hp', d.maxHp)} ${iconNum('speed', fmtSpeed(d.speed))} · ${d.dmg} dmg${d.block ? ` · Block ${d.block}` : ''}${d.undead ? ' · undead' : ''}`;
    return `<div class="cx-entry beast"><img class="cx-sprite" src="${spriteUrl(e)}" alt=""><div class="cx-name">${esc(d.name)}</div>
      <div class="cx-stats">${stats}</div><div class="cx-desc">${iconize(d.desc)}</div></div>`;
  }))).join('') + `<div class="muted cx-foot">Numbers are at Escalation 0: they grow by ${Math.round(ESCALATION.escalationScaling * 100)}% every Escalation, and more at high Challenge Rating.</div>`;
}

function archiveHtml(found: readonly EventKind[], twists: readonly TwistId[]): string {
  const entry = (k: EventKind) => {
    if (!found.includes(k)) return unknown();
    const d = EVENTS[k];
    const rules = EVENT_RULES[k];
    const elite = d.elite ? `<div class="cx-stats" style="color:${CLASSES[d.elite].color}">${CLASSES[d.elite].name} only</div>` : '';
    // Class twists you've found playing that class.
    const known = twists.filter((t) => TWISTS[t].event === k).map((t) => {
      const cls = CLASSES[TWISTS[t].cls];
      return `<div class="cx-twist" style="--cls:${cls.color}"><img src="${spriteUrl(cls.id, cls.color)}" alt="" title="${cls.name}"><span><b>${cls.name}</b>: ${esc(TWISTS[t].text)}</span></div>`;
    }).join('');
    return `<div class="cx-entry"><div class="cx-glyph">${d.glyph}</div><div class="cx-name">${esc(d.name)}</div>${elite}
      <div class="cx-desc"><i>${esc(d.text)}</i>${rules ? `<br>${iconize(rules)}` : ''}</div>${known}</div>`;
  };
  return section('Events', CODEX_EVENTS.filter((k) => !EVENTS[k].elite).map(entry))
    + section(`Elite Events <span class="muted cx-note">${esc(ELITE_NOTE)}</span>`, CODEX_EVENTS.filter((k) => EVENTS[k].elite).map(entry));
}
