import {
  BUILDING_IDS, BUILDINGS, ISSUED_KIT, ISSUED_WEIGHT, issuedDesc, CLASSES, GEAR_KIND_NAMES, GEAR_KIND_PLURALS, GEAR_KINDS, GEAR_SLOTS, INJURY_NAMES, injuredMaxHp, isGear, ITEMS, gearCr, KIT_RULES, kitCr, LEVEL_NAMES,
  LOOT_TABLE, pluralName, RESOURCE_IDS, rerollPool, riteCost, RITES, SERVICES, slotOf, talentPending, TALENTS, talentsFor, VILLAGE_RULES, VILLAGE_UPKEEP, forgeable, anvilInto,
  REGALIA_RULES, SHARDS, SPECS, specFits, talentsOf,
  type BuildingId, type ClassId, type GearKind, type GearSlot, type ItemId, type Kit, type LobbyView, type ResourceId, type ServiceId, type VillageView,
} from '@stcp/shared';
import { itemName } from './loot';
import { CODEX_TABS } from './codex';
import { spriteUrl } from './render/sprites';
import { iconNum } from './icons';

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Services that need something picked before they're used: Gear from the Stash, or what the Seer looks for. */
export const PICKED: readonly ServiceId[] = ['reroll', 'upgrade', 'seeConsumable', 'seeResource', 'seeGear'];

const CONSUMABLES = LOOT_TABLE.map((e) => e.item).filter((it) => ITEMS[it].kind === 'consumable');
/** One glyph per kind of Gear, for the Seer's picks. */
const KIND_GLYPH: Record<GearKind, string> = Object.fromEntries(GEAR_KINDS.map((k) => {
  const it = LOOT_TABLE.find((e) => isGear(e.item) && (ITEMS[e.item].gearType ?? ITEMS[e.item].kind) === k)!.item;
  return [k, ITEMS[it].glyph];
})) as Record<GearKind, string>;

const costText = (cost: Partial<Record<ResourceId, number>>) =>
  (Object.entries(cost) as [ResourceId, number][]).map(([r, n]) => `${ITEMS[r].glyph}${n}`).join(' ');

/** What a service can do now: 'locked' (not built), 'used' (done this time), 'ready'. */
function serviceState(v: VillageView, s: ServiceId): 'locked' | 'used' | 'ready' {
  const b = BUILDING_IDS.find((id) => BUILDINGS[id].levels.some((l) => l.service === s))!;
  const level = BUILDINGS[b].levels.findIndex((l) => l.service === s) + 1;
  if (v.buildings[b] < level) return 'locked';
  return v.used.includes(s) ? 'used' : 'ready';
}

/** A Relic short for a Master's service. */
function relicShort(v: VillageView, s: ServiceId): boolean {
  return !!SERVICES[s].relic && (v.resources.relic ?? 0) < 1;
}

// ---------------------------------------------------------------------------
// The screen

/**
 * The Village on one screen: a header bar (purse, upkeep, Wellbeing, back), the Emergency and the last run's story,
 * then the Characters on the left and Resources, buildings and the Stash on the right.
 */
export function villageHtml(v: VillageView, lobby: LobbyView | null, picking: ServiceId | null, emergency: string, fate: string | null): string {
  const locked = lobby?.state === 'game';
  const report = v.report.length ? `<div class="vv-report" title="${esc(v.report.join('\n'))}"><span class="muted">Last run:</span> ${v.report.map(esc).join(' · ')}</div>` : '';
  return `<div class="card village">
    <div class="vv-head">
      <h1>The Village</h1>
      <span class="vv-stat">Purse <b class="gold">${v.purse}g</b></span>
      <span class="vv-stat" title="Paid from the purse after every run: ${VILLAGE_UPKEEP}g for the Village itself, plus its buildings. If the purse can't cover it, buildings lose levels at random until it can; if it can't even cover the Village's ${VILLAGE_UPKEEP}g, it pays what it has and the Village loses 1 Wellbeing.">Upkeep <b class="${v.upkeep > v.purse ? 'danger' : 'gold'}">${v.upkeep}g</b>/run</span>
      ${v.notice ? `<span class="vv-notice">${esc(v.notice)}</span>` : ''}
      <span class="vv-books">${CODEX_TABS.map((t) => `<button data-act="codex" data-tab="${t.id}" title="Every one of the ${t.what} your heroes have come across.">${t.name}</button>`).join('')}</span>
      <button class="primary vv-back" data-act="village-close">Back</button>
    </div>
    <div class="vv-top">${fate ?? emergency}${report}</div>
    <div class="vv-main">
      <div class="vv-chars">${v.characters.map((c) => characterCard(v, c, lobby)).join('')}</div>
      <div class="vv-side">
        ${resourcesHtml(v)}
        ${regaliaHtml(v)}
        <div class="vv-buildings">${BUILDING_IDS.map((id) => buildingHtml(v, id, picking, locked)).join('')}</div>
        ${stashHtml(v, picking, locked)}
      </div>
    </div>
  </div>`;
}

/** A Character: name, class, HP and Speed, XP or Talent, and wounds (the Elder's services work right on them). */
function characterCard(v: VillageView, c: VillageView['characters'][number], lobby: LobbyView | null): string {
  const cls = CLASSES[c.cls];
  const locked = lobby?.state === 'game';
  const coming = lobby?.members.find((m) => m.id === lobby.youId)?.cls === c.cls;
  const hp = injuredMaxHp(c.cls, c.injuries);
  const majors = c.injuries.filter((i) => i === 'major').length;
  const heal = serviceState(v, 'heal') === 'ready';
  const cure = serviceState(v, 'cure') === 'ready';
  const train = serviceState(v, 'train') === 'ready' && !relicShort(v, 'train');
  let growth: string;
  // Talents show by name (hover for what they do), except when one is waiting to be chosen.
  if (c.talent) {
    growth = talentsOf(c).map((t) => `<span class="talent-star" title="${esc(TALENTS[t].desc)}">★ ${esc(TALENTS[t].name)}</span>`).join(' ');
    if (c.spec) {
      growth += ` <span class="spec-tag" title="${esc(`Specialization: ${SPECS[c.spec].desc}`)}">${esc(SPECS[c.spec].name)}</span>`;
    } else {
      // Specializations, once the Village's Shards unlock them: gold, for good.
      const fits = v.specs.filter((sp) => specFits(sp, c.cls));
      growth += fits.map((sp) => {
        const short = v.purse < REGALIA_RULES.specCost;
        const tip = `Specialization: ${SPECS[sp].desc} ${REGALIA_RULES.specCost} gold, for good.${short ? ` You have ${v.purse}.` : ''}`;
        return ` <button class="mini spec-buy" data-act="spec" data-char="${c.id}" data-spec="${sp}" ${short || locked ? 'disabled' : ''} title="${esc(tip)}">${esc(SPECS[sp].name)} ${REGALIA_RULES.specCost}g</button>`;
      }).join('');
    }
  } else if (talentPending(c)) {
    growth = `<div class="vc-pick">${talentsFor(c.cls).map((t) =>
      `<button data-act="talent" data-char="${c.id}" data-talent="${t}"><span class="gold">★ ${esc(TALENTS[t].name)}</span><span class="vc-desc">${esc(TALENTS[t].desc)}</span></button>`).join('')}</div>`;
  } else {
    const pips = Array.from({ length: VILLAGE_RULES.xpForTalent }, (_, i) => (i < c.xp ? '●' : '○')).join('');
    const options = talentsFor(c.cls).map((t) => `<span class="chip" title="${esc(TALENTS[t].desc)}">${esc(TALENTS[t].name)}</span>`).join('');
    growth = `<div>XP <span class="gold">${pips}</span>${
      train ? ` <button class="mini" data-act="service" data-service="train" data-char="${c.id}" title="Elder: ${esc(SERVICES.train.desc)} Costs a Relic.">+1 ♛</button>` : ''}</div>
      <div class="vc-talents"><span class="muted small" title="A Talent at ${VILLAGE_RULES.xpForTalent} XP: one of these.">Talent at ${VILLAGE_RULES.xpForTalent}:</span>${options}</div>`;
  }
  const wounds = [
    ...c.injuries.map((i) => heal
      ? `<button class="chip injury ${i}" data-act="service" data-service="heal" data-char="${c.id}" data-injury="${i}" title="Elder: heal this ${INJURY_NAMES[i]}.">${INJURY_NAMES[i].split(' ')[0]} ✚</button>`
      : `<span class="chip injury ${i}" title="${i === 'major' ? `−${VILLAGE_RULES.majorHpLoss * 100}% max HP, +${VILLAGE_RULES.majorSpeed}s Speed` : `−${VILLAGE_RULES.minorHpLoss * 100}% max HP`}. An Elder can heal it.">${INJURY_NAMES[i].split(' ')[0]}</span>`),
    ...(c.insane ? [cure
      ? `<button class="chip injury major" data-act="service" data-service="cure" data-char="${c.id}" title="Elder: cure the Insanity.">Insane ✚</button>`
      : '<span class="chip injury major" title="Starts the next run Insane, at 50 stress. A Journeyman Elder can cure it.">Insane</span>'] : []),
  ];
  return `<div class="vc ${coming ? 'coming' : ''}" style="--cls:${cls.color}">
    <img class="vc-sprite" src="${spriteUrl(c.cls, cls.color)}" alt="">
    <div class="vc-body">
      <div class="vc-name">${esc(c.name)}</div>
      <div class="vc-meta">${cls.name}${coming ? ' · <span class="gold">coming</span>' : ''}</div>
      <div class="vc-meta">${iconNum('hp', hp)}${hp < cls.maxHp ? `<span class="muted">/${cls.maxHp}</span>` : ''} ${iconNum('speed', `${cls.speed + majors * VILLAGE_RULES.majorSpeed}s`)} <span class="muted" title="Runs survived">✓${c.survived}</span></div>
    </div>
    <div class="vc-growth">${growth}</div>
    <div class="vc-wounds">${wounds.join('')}</div>
  </div>`;
}

/** Resources: counts (hover for their Rite, which is performed from the New Run screen's loadout). */
function resourcesHtml(v: VillageView): string {
  const tiles = RESOURCE_IDS.map((r) => {
    const have = v.resources[r] ?? 0;
    const on = v.kit.rites.includes(r);
    const tip = `${pluralName(r)}: ${have}\n${RITES[r].name} (${riteCost(r)}): ${RITES[r].desc}\n${on ? 'Performed next run.' : 'Perform it from the New Run screen.'}`;
    return `<span class="rite ${on ? 'on' : ''}" title="${esc(tip)}"><span class="rite-glyph">${ITEMS[r].glyph}</span><span class="rite-count">${have}${on ? ' ✦' : ''}</span></span>`;
  }).join('');
  return `<div class="vv-res"><span class="muted" title="Resources build buildings; ${KIT_RULES.riteCost} of one (1 Relic) power a Rite for your next run.">Resources</span>${tiles}</div>`;
}

/** Shards of Bosses' regalia brought home, and what they unlock. */
function regaliaHtml(v: VillageView): string {
  if (!v.shards.length) {
    return `<div class="vv-regalia muted small" title="A Boss killed drops a Shard of its regalia for every player inside whose Village lacks it. Carry one out: the first unlocks Specializations.">Regalia: none yet. Bosses carry Shards.</div>`;
  }
  const tiles = v.shards.map((x) => `<span class="shard-tile" title="${esc(`${SHARDS[x].name}: unlocks the ${SPECS[SHARDS[x].spec].name} Specialization (${SPECS[SHARDS[x].spec].desc})`)}">${SHARDS[x].glyph} ${esc(SHARDS[x].name)}</span>`).join('');
  return `<div class="vv-regalia"><span class="muted" title="Specializations: a Character with a Talent can take one, for ${REGALIA_RULES.specCost} gold, for good.">Regalia</span>${tiles}</div>`;
}

/** Rite toggles for the New Run loadout: a click performs (or cancels) one for the next run. */
function ritesHtml(v: VillageView): string {
  return RESOURCE_IDS.map((r) => {
    const have = v.resources[r] ?? 0;
    const on = v.kit.rites.includes(r);
    const can = on || have >= riteCost(r);
    const status = on ? 'Performed next run. Click to cancel.' : can ? 'Click to perform it next run.' : `Needs ${riteCost(r)}.`;
    const tip = `${pluralName(r)}: ${have}\n${RITES[r].name} (${riteCost(r)}): ${RITES[r].desc}\n${status}`;
    return `<button class="rite ${on ? 'on' : ''}" data-act="rite" data-rite="${r}" ${can ? '' : 'disabled'} title="${esc(tip)}">
      <span class="rite-glyph">${ITEMS[r].glyph}</span><span class="rite-count">${have}${on ? ' ✦' : ''}</span></button>`;
  }).join('');
}

/** One building: level pips, upkeep, build/tear down, and its three services. */
function buildingHtml(v: VillageView, id: BuildingId, picking: ServiceId | null, locked: boolean): string {
  const def = BUILDINGS[id];
  const level = v.buildings[id];
  const next = def.levels[level];
  const upkeep = def.levels.slice(0, level).reduce((s, l) => s + l.upkeep, 0);
  const affordable = next && (Object.entries(next.cost) as [ResourceId, number][]).every(([r, n]) => (v.resources[r] ?? 0) >= n);
  const pips = def.levels.map((_, i) => (i < level ? '●' : '○')).join('');
  const build = next
    ? `<button class="mini" data-act="build" data-building="${id}" ${locked || !affordable ? 'disabled' : ''} title="Build a ${LEVEL_NAMES[level + 1]} ${def.name}: ${esc(costText(next.cost))}, then ${next.upkeep}g more upkeep a run. Adds ${SERVICES[next.service].name}.">▲ ${LEVEL_NAMES[level + 1]} ${costText(next.cost)} · −${next.upkeep}g</button>`
    : '';
  const tear = level ? `<button class="mini quiet-x" data-act="demolish" data-building="${id}" ${locked ? 'disabled' : ''} title="Tear down the ${LEVEL_NAMES[level]} level (free; its Resources are lost).">✕</button>` : '';
  const services = def.levels.map((l, i) => serviceButton(v, l.service, i + 1, picking, locked)).join('');
  let extra = '';
  if (picking && def.levels.some((l) => l.service === picking) && picking.startsWith('see')) extra = seerPicks(picking);
  if (id === 'seer' && (v.sight.consumable || v.sight.resource || v.sight.gear)) {
    const seen = [v.sight.consumable && `${ITEMS[v.sight.consumable].glyph} ${pluralName(v.sight.consumable)}`, v.sight.resource && `${ITEMS[v.sight.resource].glyph} ${pluralName(v.sight.resource)}`,
      v.sight.gear && `${KIND_GLYPH[v.sight.gear]} ${GEAR_KIND_PLURALS[v.sight.gear]}`].filter(Boolean);
    extra += `<div class="vb-note">Next run shows: ${seen.join(', ')}</div>`;
  }
  return `<div class="vb ${level ? '' : 'unbuilt'}">
    <div class="vb-head"><span class="vb-name">${def.glyph} ${def.name}</span> <span class="gold" title="${LEVEL_NAMES[level]}">${pips}</span>
      <span class="muted small">${level ? `${LEVEL_NAMES[level]} · −${upkeep}g/run` : 'not built'}</span><span class="vb-acts">${build}${tear}</span></div>
    <div class="vb-services">${services}</div>${extra}
  </div>`;
}

function serviceButton(v: VillageView, s: ServiceId, level: number, picking: ServiceId | null, locked: boolean): string {
  const st = serviceState(v, s);
  const def = SERVICES[s];
  const relic = def.relic ? ' ♛' : '';
  const tip = `${def.name} (${LEVEL_NAMES[level]}): ${def.desc}${def.relic ? ' Costs a Relic.' : ''} Once before each run.`;
  if (st === 'locked') return `<span class="vs locked" title="${esc(tip)}">${def.name}${relic}</span>`;
  if (st === 'used') return `<span class="vs used" title="${esc(tip)}">✓ ${def.name}</span>`;
  // The Elder's services are used on a Character's card.
  if (s === 'heal' || s === 'cure' || s === 'train') return `<span class="vs ready" title="${esc(`${tip} Click the Character's ${s === 'train' ? '+1 ♛ by their XP' : s === 'cure' ? 'Insane tag' : 'injury'}.`)}">${def.name}${relic}</span>`;
  const short = relicShort(v, s);
  return `<button class="vs ready ${picking === s ? 'sel' : ''}" data-act="service" data-service="${s}" ${locked || short ? 'disabled' : ''} title="${esc(short ? `${tip} You have no Relic.` : tip)}">${def.name}${relic}${PICKED.includes(s) ? '…' : ''}</button>`;
}

/** The Seer's choices, inline under the Seer. */
function seerPicks(s: ServiceId): string {
  const opts: [string, string, string][] = s === 'seeConsumable' ? CONSUMABLES.map((it) => [it, ITEMS[it].glyph, ITEMS[it].name])
    : s === 'seeResource' ? RESOURCE_IDS.map((r) => [r, ITEMS[r].glyph, ITEMS[r].name])
    : GEAR_KINDS.map((k) => [k, KIND_GLYPH[k], GEAR_KIND_NAMES[k]]);
  return `<div class="vb-picks">${opts.map(([id, g, name]) => `<button class="mini" data-act="service" data-service="${s}" data-pick="${id}" title="${esc(name)}">${g} ${esc(name)}</button>`).join('')}
    <button class="mini" data-act="pick-cancel">cancel</button></div>`;
}

const SLOT_NAMES: Record<GearSlot, string> = { weapon: 'Weapon', armor: 'Armor', amulet: 'Amulet', ring: 'Ring' };

/**
 * The Stash. In the Village it's to look at, or to pick a piece for the Blacksmith;
 * on the New Run screen (`packing`) a click packs a piece into the loadout.
 */
function stashListHtml(v: VillageView, picking: ServiceId | null, locked: boolean, packing: boolean): string {
  const kit = v.kit;
  const gem = kit.rites.includes('gem');
  // Picking for the Blacksmith: Gear that can take the work lights up; everything else waits.
  const smith = !packing && (picking === 'reroll' || picking === 'upgrade') ? picking : null;
  const counts = new Map<ItemId, number>();
  for (const it of v.items) counts.set(it, (counts.get(it) ?? 0) + 1);
  const stash = [...counts].map(([it, n]) => {
    const left = n - inKit(kit, it);
    if (smith) {
      const ok = smith === 'reroll' ? isGear(it) && rerollPool(it).length > 0 : forgeable(it);
      const what = smith === 'reroll' ? 'another of its type and rarity' : anvilInto(it);
      return `<button class="stash-item ${ok ? 'target' : ''}" data-act="service" data-service="${smith}" data-item="${it}" ${ok && !locked ? '' : 'disabled'} title="${esc(ok ? `${SERVICES[smith].name}: into ${what}.` : 'The Blacksmith can’t work this.')}">${ITEMS[it].glyph} ${itemName(it)}${n > 1 ? ` <span class="muted">×${n}</span>` : ''}</button>`;
    }
    const count = n > 1 ? ` <span class="muted">×${left}/${n}</span>` : left <= 0 ? ' <span class="muted">(packed)</span>' : '';
    if (!packing) return `<span class="stash-item" title="${esc(ITEMS[it].desc)}">${ITEMS[it].glyph} ${itemName(it)}${count}</span>`;
    const isCons = ITEMS[it].kind === 'consumable';
    const full = isCons && (gem || kit.consumables.length >= KIT_RULES.consumables);
    const why = left <= 0 ? 'All of them are packed.' : isCons && gem ? 'The Gem Rite forbids consumables.' : full ? `Only ${KIT_RULES.consumables} consumables.` : isCons ? 'Click to pack it (free).' : `Click to wear it (${gearCrText(it)}).`;
    return `<button class="stash-item" data-act="kit-add" data-item="${it}" ${left <= 0 || full ? 'disabled' : ''} title="${esc(`${ITEMS[it].desc} ${why}`)}">${ITEMS[it].glyph} ${itemName(it)}${count}</button>`;
  }).join('');
  return `<div class="stash-list">${stash || '<span class="muted">Empty. Bring something home.</span>'}</div>`;
}

const gearCrText = (it: ItemId) => `+${gearCr(it).toFixed(1)} CR`;

/** The Village's Stash panel. */
function stashHtml(v: VillageView, picking: ServiceId | null, locked: boolean): string {
  const smith = picking === 'reroll' || picking === 'upgrade' ? picking : null;
  return `<div class="vv-stash">
    <div class="vv-sub">${smith ? `<span class="gold">${SERVICES[smith].name}: pick a piece</span> <button class="mini" data-act="pick-cancel">cancel</button>` : '<span class="gold">Stash</span> <span class="muted small">(pack your loadout on the New Run screen)</span>'}</div>
    ${stashListHtml(v, picking, locked, false)}
  </div>`;
}

/** The New Run screen's loadout: Gear slots, free consumables, Rites, and the Stash to fill it from. */
export function loadoutHtml(v: VillageView, cls: ClassId | null = null): string {
  const kit = v.kit;
  const gem = kit.rites.includes('gem');
  const slots = [
    ...GEAR_SLOTS.map((s) => {
      const it = kit.gear[s];
      if (it) return `<button class="kit-slot full" data-act="kit-remove" data-slot="${s}" title="${esc(`${ITEMS[it].desc} ${gearCrText(it)}. Click to leave it at home.`)}">${ITEMS[it].glyph} ${itemName(it)}</button>`;
      // An empty slot gets free Issued Gear in the dungeon, unless you choose to go without (quicker, but a Fumble in your deck).
      const bare = kit.bare?.includes(s);
      const issued = cls ? ISSUED_KIT[cls][s] : null;
      const what = issued ? `Issued ${itemName(issued)}` : `Issued ${SLOT_NAMES[s].toLowerCase()}`;
      const tip = bare
        ? `Going without: no ${SLOT_NAMES[s].toLowerCase()}, so ${ISSUED_WEIGHT}s quicker, but a Fumble in your deck. Click to take the Issued one.`
        : `${issued ? `${issuedDesc(issued)} ` : `+${ISSUED_WEIGHT}s Speed. `}Free and ephemeral.`;
      return `<button class="kit-slot issued ${bare ? 'bare' : ''}" data-act="kit-bare" data-slot="${s}" title="${esc(tip)}">${bare ? `<s>${SLOT_NAMES[s]}</s>` : what}</button>`;
    }),
    ...(gem ? ['<div class="kit-slot" title="The Gem Rite forbids consumables.">no consumables</div>'] : Array.from({ length: KIT_RULES.consumables }, (_, i) => {
      const it = kit.consumables[i];
      return it
        ? `<button class="kit-slot full" data-act="kit-remove" data-slot="c${i}" title="${esc(`${ITEMS[it].desc} Free. Click to leave it at home.`)}">${ITEMS[it].glyph} ${itemName(it)}</button>`
        : '<div class="kit-slot">Consumable</div>';
    })),
  ];
  const cr = kitCr(kit);
  return `<div class="lb-panel loadout">
    <div class="vv-sub"><span class="gold">Loadout</span>${cr ? ` <span class="muted">CR ${cr > 0 ? '+' : ''}${cr}</span>` : ''} <span class="muted small" title="Gear adds ${KIT_RULES.crPerGearLevel} CR per level (common 1, uncommon 2, rare 3), a Legendary ${KIT_RULES.legendaryCr}. Up to ${KIT_RULES.consumables} consumables, free. ${KIT_RULES.riteCost} of a Resource (1 Relic) performs its Rite. If your Character dies, what they took is lost.">(?)</span>
      <span class="lb-rites">${ritesHtml(v)}</span></div>
    <div class="kit-slots">${slots.join('')}</div>
    <div class="vv-sub"><span class="gold">Stash</span></div>
    ${stashListHtml(v, null, false, true)}
  </div>`;
}

/** How many of `item` the kit already takes. */
function inKit(kit: Kit, item: ItemId): number {
  return Object.values(kit.gear).filter((x) => x === item).length + kit.consumables.filter((x) => x === item).length;
}

/** Gear goes on its slot (replacing what was chosen there); a consumable takes a free place. */
export function addToKit(kit: Kit, item: ItemId) {
  const slot = slotOf(item);
  if (slot) {
    // Only one Legendary can be worn: a new one takes the place of any other.
    if (ITEMS[item].legend) for (const s of GEAR_SLOTS) if (s !== slot && kit.gear[s] && ITEMS[kit.gear[s]!].legend) delete kit.gear[s];
    kit.gear[slot] = item;
  }
  else if (kit.consumables.length < KIT_RULES.consumables) kit.consumables.push(item);
}

/** `slot` is a Gear slot, or "c0"/"c1" for a consumable place. */
export function removeFromKit(kit: Kit, slot: string) {
  if (slot.startsWith('c')) kit.consumables.splice(Number(slot.slice(1)), 1);
  else delete kit.gear[slot as GearSlot];
}

/** Go without a Gear slot's Issued piece, or take it again. */
export function toggleBare(kit: Kit, slot: GearSlot) {
  const bare = kit.bare ?? [];
  kit.bare = bare.includes(slot) ? bare.filter((x) => x !== slot) : [...bare, slot];
}

export function toggleRite(kit: Kit, r: ResourceId) {
  kit.rites = kit.rites.includes(r) ? kit.rites.filter((x) => x !== r) : [...kit.rites, r];
  // The Gem Rite forbids consumables: taking it leaves them at home.
  if (kit.rites.includes('gem')) kit.consumables = [];
}
