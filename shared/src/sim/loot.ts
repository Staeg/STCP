import {
  GEAR_SLOTS, gearGain, isGear, itemTier, ITEMS, LOOT, LOOT_TABLE, packFits, packRank, packSlots, packSlotsUsed, INVENTORY_SLOTS, slotOf, VALUABLE_TABLE,
  type GearSlot, type ItemDef, type ItemId,
} from '../content/items';
import { LIGHT_MAX } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { addStress, inDungeon, isConscious, monstersIn, reviveHero, type Monster } from './combat';
import { ENEMIES } from '../content/enemies';
import { notify } from './notify';
import { STRESS } from '../content/events';
import { crGold, type Hero, type World } from './world';

export const LEAVE = 'leave';
/** Bots defer to the humans' majority after this many seconds. */
export const BOT_DEFER_AFTER = 2;

/** One thing lying on the floor, with its own vote: everything in a room is divvied up at once. */
export interface FloorItem {
  /** Stable id: votes, claims and the client's cards refer to it. */
  id: number;
  item: ItemId;
  /** Who last put it on the floor (null: found there). */
  by: string | null;
  /** voterId → recipient hero id, or LEAVE. */
  votes: Record<string, string>;
  /** When the people now around it first saw it (bots defer, Selfish grace). */
  startedAt: number;
  /** Heroes who have stood in the room with it; once they walk out they've passed it by. */
  seen: string[];
  /** Heroes who walked past it, dropped it or voted to leave it: they ignore it from now on. */
  passed: string[];
  /** Someone asked for it back: it's up for grabs again while they're here. */
  claimedBy: string | null;
}

export interface Pile {
  gold: number;
  items: FloorItem[];
  /** Gold the dead dropped, by whose it was: an Undertaker carries it out for them; anyone else just splits it. */
  corpseGold?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Seeding

export function spawnInitialLoot(world: World) {
  const d = world.dungeon;
  const rng = world.rng;
  for (const room of d.rooms) {
    if (room.kind !== 'normal') continue;
    // Guarded rooms get their items when the monsters die (see dropBounty).
    const guarded = monstersIn(world, room.id).length > 0;
    const lair = (world.bounty[room.id] ?? 0) > 0;
    const deadEnd = room.corridors.length === 1;
    const items: ItemId[] = [];
    let gold = 0;
    if (lair) gold = rng.int(...LOOT.lairGold);
    else if (guarded ? rng.chance(LOOT.guardedChance) : rng.chance(LOOT.emptyChance)) {
      const [lo, hi] = guarded ? LOOT.guardedGold : LOOT.emptyGold;
      gold = rng.int(lo, hi);
    }
    if (!guarded && rng.chance(LOOT.emptyItemChance)) items.push(rollItem(world));
    if (deadEnd && rng.chance(LOOT.deadEndBonusItemChance)) items.push(rollItem(world));
    // Valuables lie anywhere (behind the guards, too); Relics only in lairs.
    if (rng.chance(LOOT.valuableChance)) items.push(rollValuable(world));
    if (deadEnd && rng.chance(LOOT.deadEndValuableChance)) items.push(rollValuable(world));
    if (lair && rng.chance(LOOT.relicChance)) items.push('relic');
    if (gold || items.length) addToPile(world, room.id, gold, items);
  }
}

/** A random item. `quality` 1–3 favours items of that rarity and makes rarer ones scarce. */
export function rollItem(world: World, quality = 1): ItemId {
  const weight = (e: (typeof LOOT_TABLE)[number]) =>
    e.weight * (e.rarity === quality ? LOOT.qualityMatchBonus : 1) * LOOT.qualityAbovePenalty ** Math.max(0, e.rarity - quality);
  const total = LOOT_TABLE.reduce((s, e) => s + weight(e), 0);
  let roll = world.rng.float(0, total);
  for (const e of LOOT_TABLE) {
    roll -= weight(e);
    if (roll <= 0) return e.item;
  }
  return LOOT_TABLE[0].item;
}

/** An Effigy, Gem or Tome, weighted toward the cheap end. */
export function rollValuable(world: World): ItemId {
  const total = VALUABLE_TABLE.reduce((s, e) => s + e.weight, 0);
  let roll = world.rng.float(0, total);
  for (const e of VALUABLE_TABLE) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return VALUABLE_TABLE[0].item;
}

/** What a slain monster adds to its room's drop: tougher monsters (and later tiers) are worth more. */
export function monsterPoints(m: Monster): number {
  return ENEMIES[m.type].maxHp * m.dmgMult;
}

/** The last monster in a room fell: everything slain there drops loot, better the more (and stronger) they were. */
export function dropBounty(world: World, room: number) {
  const points = world.bounty[room] ?? 0;
  delete world.bounty[room];
  if (points <= 0) return;
  const quality = points >= LOOT.dropQuality3 ? 3 : points >= LOOT.dropQuality2 ? 2 : 1;
  const count = Math.min(LOOT.maxDrops, 1 + Math.floor(points / LOOT.dropPointsPerItem));
  const items = Array.from({ length: count }, () => rollItem(world, quality));
  if (world.rng.chance(LOOT.dropValuableChance)) items.push(rollValuable(world));
  addToPile(world, room, 0, items);
}

/**
 * Put things on a room's floor. Found loot (`droppedBy` null) never takes a room past LOOT.maxDrops; whoever drops
 * something ignores it from then on (they just put it down), so it won't pop up for them again.
 */
export function addToPile(world: World, room: number, gold: number, items: ItemId[], droppedBy: string | null = null) {
  const pile = (world.piles[room] ??= { gold: 0, items: [] });
  // Found gold is worth more at higher Challenge Rating.
  pile.gold += droppedBy === null ? crGold(world, gold) : gold;
  if (droppedBy === null) items = items.slice(0, Math.max(0, LOOT.maxDrops - pile.items.length));
  for (const item of items) {
    pile.items.push({
      id: world.nextId++, item, by: droppedBy, votes: {}, startedAt: world.time, seen: [], passed: droppedBy ? [droppedBy] : [], claimedBy: null,
    });
  }
}

/** Is there room on this floor for one more thing you put down? */
export function floorFull(world: World, room: number): boolean {
  return (world.piles[room]?.items.length ?? 0) >= LOOT.maxDrops;
}

// ---------------------------------------------------------------------------
// Inventory

/** Room in the pack: a free slot, or (given a valuable) room on a stack of the same. */
export function hasSpace(h: Hero, item?: ItemId): boolean {
  return item ? packFits(h.items, item) : packSlotsUsed(h.items) < INVENTORY_SLOTS;
}

/**
 * Weapons and armor swap with what you wear, unless they're a lower tier than that (take yours off first if you
 * really want it); amulets and rings always swap; anything else needs room in the pack.
 */
export function canTake(h: Hero, item: ItemId): boolean {
  const slot = slotOf(item);
  if (slot === 'weapon' || slot === 'armor') {
    const worn = h[slot];
    return !worn || itemTier(item) >= itemTier(worn);
  }
  if (slot) return true;
  return hasSpace(h, item);
}

/** What this hero has on: weapon, armor, amulet, ring. */
export function wornDefs(h: Hero): ItemDef[] {
  return GEAR_SLOTS.map((s) => h[s]).filter((x): x is ItemId => !!x).map((x) => ITEMS[x]);
}

type WornNumber = 'maxHp' | 'hurt' | 'thorns' | 'regen' | 'stressMult' | 'goldMult' | 'lightDrainMult';

/** A worn bonus that adds up (Thorn Ring's damage back, Bloodstone's regen…). */
export function wornStat(h: Hero, key: WornNumber): number {
  return wornDefs(h).reduce((s, d) => s + (d[key] ?? 0), 0);
}

/** A worn multiplier (Ward Charm's stress, Ember Pendant's torch…): 1 if nothing worn touches it. */
export function wornMult(h: Hero, key: WornNumber): number {
  return wornDefs(h).reduce((m, d) => m * (d[key] ?? 1), 1);
}

/** Put something on (or take it off, with null). Max HP follows the amulet or ring. Returns what was there. */
export function equip(h: Hero, slot: GearSlot, item: ItemId | null): ItemId | null {
  const old = h[slot];
  const hpOf = (id: ItemId | null) => (id ? ITEMS[id].maxHp ?? 0 : 0);
  const delta = hpOf(item) - hpOf(old);
  h[slot] = item;
  if (delta !== 0) {
    h.maxHp = Math.max(1, h.maxHp + delta);
    // Gaining max HP fills the new part; losing it never takes a standing hero below 1.
    if (h.downedAt === null) h.hp = Math.max(1, Math.min(h.maxHp, h.hp + Math.max(0, delta)));
    else h.hp = Math.min(h.hp, h.maxHp);
  }
  return old;
}

/** Returns the gear this displaced, if any (the caller puts it on the floor). */
export function giveItem(h: Hero, item: ItemId): ItemId | null {
  const slot = slotOf(item);
  if (slot) return equip(h, slot, item);
  // Consumables always sit at the top of the pack (the first few get number keys); valuables stack below.
  const rank = packRank(item);
  const at = h.items.findIndex((x) => packRank(x) > rank);
  h.items.splice(at < 0 ? h.items.length : at, 0, item);
  return null;
}

export function takeItem(h: Hero, index: number): ItemId | null {
  const item = h.items[index];
  if (item === undefined) return null;
  h.items.splice(index, 1);
  return item;
}

/** On the way out: Effigies, Gems, Tomes and Relics are sold for gold (found treasure: worth more at higher CR). */
export function sellValuables(world: World, h: Hero) {
  const sold = h.items.filter((x) => ITEMS[x].kind === 'valuable');
  if (!sold.length) return;
  const gold = crGold(world, sold.reduce((s, x) => s + (ITEMS[x].value ?? 0), 0));
  h.items = h.items.filter((x) => ITEMS[x].kind !== 'valuable');
  h.gold += gold;
  notify(world, h, `Sold ${sold.length} valuable${sold.length > 1 ? 's' : ''} for ${gold} gold.`);
}

/** Who's in a room: everyone not dead (downed heroes still get a share). */
function presentIn(world: World, room: number): Hero[] {
  return Object.values(world.heroes).filter((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room);
}

/** Conscious, not fighting: the people who must agree on an item. */
export function votersIn(world: World, room: number): Hero[] {
  return presentIn(world, room).filter((h) => isConscious(h) && h.encounter === null);
}

/**
 * Would this hero bother with it? Not if they walked past it before, can't carry it, or it's gear no better than
 * what they wear (same tier or lower).
 */
export function wants(h: Hero, f: FloorItem): boolean {
  if (f.passed.includes(h.id) || !canTake(h, f.item)) return false;
  const slot = slotOf(f.item);
  if (slot === 'weapon' || slot === 'armor') {
    const worn = h[slot];
    return !worn || itemTier(f.item) > itemTier(worn);
  }
  // A different amulet or ring is always worth a look.
  if (slot) return h[slot] !== f.item;
  return true;
}

/** The floor items up for grabs right now: someone here wants it, or asked for it back. The rest lie ignored. */
export function activeItems(world: World, room: number, voters = votersIn(world, room)): FloorItem[] {
  const pile = world.piles[room];
  if (!pile || world.encounters[room] || monstersIn(world, room).length > 0) return [];
  return pile.items.filter((f) => voters.some((v) => v.id === f.claimedBy || wants(v, f)));
}

// ---------------------------------------------------------------------------
// Pickup & voting

export function tickLoot(world: World) {
  for (const [key, pile] of Object.entries(world.piles)) {
    const room = Number(key);
    passBy(world, room, pile);
    if (world.encounters[room] || monstersIn(world, room).length > 0) continue;
    const voters = votersIn(world, room);
    if (voters.length === 0) continue;

    if (pile.corpseGold) claimCorpseGold(world, pile, voters);
    const undertaker = voters.find((v) => v.cls === 'undertaker');
    if (undertaker) mortician(world, room, pile, undertaker);
    if (pile.gold > 0) splitGold(world, room, pile);
    for (const f of pile.items) {
      if (f.seen.length === 0) f.startedAt = world.time;
      for (const v of voters) if (!f.seen.includes(v.id)) f.seen.push(v.id);
    }

    // Every item has its own vote, all at once; each goes as soon as everyone agrees on it.
    for (const f of activeItems(world, room, voters)) {
      if (!pile.items.includes(f)) continue;
      let deciders = voters;
      // Selfish heroes always claim it, and get outvoted by being ignored after a grace period.
      for (const v of voters) if (v.affliction === 'selfish' && canTake(v, f.item)) f.votes[v.id] = v.id;
      if (world.time - f.startedAt > STRESS.selfishGrace) {
        const fair = voters.filter((v) => v.affliction !== 'selfish');
        if (fair.length) deciders = fair;
      }
      const ids = new Set(deciders.map((v) => v.id));
      for (const id of Object.keys(f.votes)) if (!ids.has(id)) delete f.votes[id];
      // A vote for someone who can no longer take it is void.
      for (const [id, choice] of Object.entries(f.votes)) if (!validChoice(world, room, choice, f.item)) delete f.votes[id];
      const values = deciders.map((v) => f.votes[v.id]);
      if (values.every((v) => v !== undefined && v === values[0])) resolveItem(world, room, pile, f, values[0]!);
    }
    if (pile.gold === 0 && !pile.corpseGold && pile.items.length === 0) delete world.piles[room];
  }
}

/** Whoever saw an item and has since walked out passed it by: it won't pop up for them again unless claimed. */
function passBy(world: World, room: number, pile: Pile) {
  const here = new Set(presentIn(world, room).map((h) => h.id));
  for (const f of pile.items) {
    for (const id of f.seen) if (!here.has(id) && !f.passed.includes(id)) f.passed.push(id);
    f.seen = f.seen.filter((id) => here.has(id));
    if (f.claimedBy && !here.has(f.claimedBy)) f.claimedBy = null;
  }
}

/** Gold off the dead: the Undertaker keeps each share apart for its owner; without one, it's just gold to split. */
function claimCorpseGold(world: World, pile: Pile, voters: Hero[]) {
  const undertaker = voters.find((v) => v.cls === 'undertaker');
  for (const [id, gold] of Object.entries(pile.corpseGold ?? {})) {
    if (undertaker) {
      undertaker.bodies[id] = (undertaker.bodies[id] ?? 0) + gold;
      notify(world, undertaker, `You gather ${world.heroes[id]?.name ?? 'the fallen'}'s ${gold} gold, to carry home for them.`);
    } else {
      pile.gold += gold;
    }
  }
  delete pile.corpseGold;
}

/** Was this floor item dropped by someone now dead? */
function fromTheDead(world: World, by: string | null | undefined): boolean {
  return !!by && !!world.heroes[by]?.dead;
}

/** Mortician: the Undertaker takes what the fallen carried without a vote (gear only if it's an upgrade). */
function mortician(world: World, room: number, pile: Pile, u: Hero) {
  const wanted = (item: ItemId) => {
    const slot = slotOf(item);
    if (slot === 'weapon' || slot === 'armor') return gearGain(item, u[slot]) > 0;
    if (slot) return !u[slot];
    return hasSpace(u, item);
  };
  for (const f of [...pile.items]) if (fromTheDead(world, f.by) && wanted(f.item)) take(world, room, pile, u, f);
}

/** Give a floor item to a hero; gear they had on goes back on the floor as theirs. */
function take(world: World, room: number, pile: Pile, h: Hero, f: FloorItem) {
  pile.items.splice(pile.items.indexOf(f), 1);
  const def = ITEMS[f.item];
  const old = giveItem(h, f.item);
  const verb = slotOf(f.item) ? ['put on', 'puts on'] : ['take', 'takes'];
  for (const x of presentIn(world, room)) notify(world, x, x === h ? `You ${verb[0]} the ${def.name}.` : `${h.name} ${verb[1]} the ${def.name}.`);
  // The piece it replaced goes on the floor, up for grabs like any other find (but not for them).
  if (old) addToPile(world, room, 0, [old], h.id);
}

function splitGold(world: World, room: number, pile: Pile) {
  const present = presentIn(world, room);
  const share = Math.floor(pile.gold / present.length);
  let remainder = pile.gold - share * present.length;
  for (const h of world.rng.shuffle(present)) {
    let amount = share + (remainder-- > 0 ? 1 : 0);
    amount = Math.round(amount * wornMult(h, 'goldMult'));
    h.gold += amount;
    notify(world, h, present.length > 1 ? `+${amount} gold (split ${present.length} ways)` : `+${amount} gold`);
  }
  pile.gold = 0;
}

function validChoice(world: World, room: number, choice: string, item: ItemId): boolean {
  if (choice === LEAVE) return true;
  const h = world.heroes[choice];
  return !!h && !h.dead && h.pos.kind === 'room' && h.pos.room === room && canTake(h, item);
}

/** Everyone agreed: hand it over, or leave it lying (ignored by all of them from now on). */
function resolveItem(world: World, room: number, pile: Pile, f: FloorItem, choice: string) {
  f.votes = {};
  if (choice === LEAVE) {
    for (const v of votersIn(world, room)) if (!f.passed.includes(v.id)) f.passed.push(v.id);
    f.claimedBy = null;
    for (const h of presentIn(world, room)) notify(world, h, `Left the ${ITEMS[f.item].name} behind.`);
    return;
  }
  take(world, room, pile, world.heroes[choice], f);
}

function floorItem(world: World, h: Hero, id: number): FloorItem | undefined {
  return h.pos.kind === 'room' ? world.piles[h.pos.room]?.items.find((f) => f.id === id) : undefined;
}

/** Vote on who gets a floor item (alone, voting for yourself just picks it up). Returns an error message or null. */
export function castVote(world: World, h: Hero, id: number, choice: string): string | null {
  const f = floorItem(world, h, id);
  if (!f || h.pos.kind !== 'room') return 'Nothing to vote on.';
  const room = h.pos.room;
  if (!votersIn(world, room).includes(h)) return 'You cannot vote right now.';
  if (!activeItems(world, room).includes(f)) return 'Nobody wants that. Claim it first.';
  if (!validChoice(world, room, choice, f.item)) return 'They cannot carry it.';
  if (h.affliction === 'selfish' && canTake(h, f.item) && choice !== h.id) return 'Mine! (Selfish)';
  f.votes[h.id] = choice;
  return null;
}

/** Pick an ignored item back up off the floor: alone, you just take it; with company, it goes up for grabs again. */
export function claimItem(world: World, h: Hero, id: number): string | null {
  if (h.pos.kind !== 'room' || !isConscious(h) || h.encounter !== null) return 'Not now.';
  const room = h.pos.room;
  const pile = world.piles[room];
  const f = floorItem(world, h, id);
  if (!pile || !f || world.encounters[room] || monstersIn(world, room).length > 0) return 'Nothing there.';
  f.passed = f.passed.filter((x) => x !== h.id);
  if (votersIn(world, room).length === 1) {
    if (!canTake(h, f.item)) return isGear(f.item) ? 'Take yours off first.' : 'Your pack is full.';
    take(world, room, pile, h, f);
    return null;
  }
  f.claimedBy = h.id;
  f.startedAt = world.time;
  return null;
}

/**
 * Put an item from your pack on the floor of your room (a whole stack of valuables at once). Others there can then
 * take it; you'll ignore it.
 */
export function dropItem(world: World, h: Hero, index: number): string | null {
  if (h.pos.kind !== 'room' || h.encounter !== null) return 'Not now.';
  if (floorFull(world, h.pos.room)) return 'No room on the floor here.';
  const stack = packSlots(h.items).find((s) => s.indices.includes(index));
  if (!stack) return 'Nothing there.';
  // Highest index first, so the others don't shift.
  const items = [...stack.indices].reverse().map((i) => takeItem(h, i)!);
  addToPile(world, h.pos.room, 0, items, h.id);
  return null;
}

/** Take off a weapon, armor, amulet or ring and put it on the floor of your room. */
export function unequip(world: World, h: Hero, slot: GearSlot): string | null {
  if (h.pos.kind !== 'room' || h.encounter !== null) return 'Not now.';
  if (floorFull(world, h.pos.room)) return 'No room on the floor here.';
  const item = equip(h, slot, null);
  if (!item) return 'Nothing there.';
  addToPile(world, h.pos.room, 0, [item], h.id);
  return null;
}

/** A hero died: everything they carried hits the floor. */
export function dropEverything(world: World, h: Hero) {
  const room = h.pos.kind === 'room' ? h.pos.room : h.pos.from;
  const items: ItemId[] = [];
  while (h.items.length) items.push(takeItem(h, 0)!);
  for (const slot of GEAR_SLOTS) {
    const worn = equip(h, slot, null);
    if (worn) items.push(worn);
  }
  addToPile(world, room, 0, items, h.id);
  const pile = world.piles[room];
  const corpse = (pile.corpseGold ??= {});
  if (h.gold > 0) corpse[h.id] = (corpse[h.id] ?? 0) + h.gold;
  // A fallen Undertaker drops what they carried for others, still marked as theirs.
  for (const [id, gold] of Object.entries(h.bodies)) corpse[id] = (corpse[id] ?? 0) + gold;
  if (Object.keys(corpse).length === 0) delete pile.corpseGold;
  h.gold = 0;
  h.bodies = {};
}

// ---------------------------------------------------------------------------
// Using items

export function itemTargets(world: World, h: Hero, index: number): string[] {
  const def = ITEMS[h.items[index]];
  if (!def || h.pos.kind !== 'room') return [];
  const room = h.pos.room;
  const here = presentIn(world, room);
  switch (def.target) {
    case 'self':
      return [h.id];
    case 'ally':
      return here.filter(isConscious).map((x) => x.id);
    case 'downed': {
      const near = new Set([room, ...neighbours(world.dungeon, room)]);
      return Object.values(world.heroes)
        .filter((x) => inDungeon(x) && x.downedAt !== null && x.pos.kind === 'room' && near.has(x.pos.room))
        .map((x) => x.id);
    }
    case 'enemies':
      return [];
  }
}

/**
 * Apply an item's effect (consumes it). Shared by field use and combat.
 * Returns a description of what happened, or an error prefixed with '!'.
 */
export function applyItem(world: World, h: Hero, index: number, targetId?: string): string {
  const item = h.items[index];
  if (!item) return '!Nothing there.';
  const def = ITEMS[item];
  if (def.kind !== 'consumable') return "!You can't use that.";
  if (def.target === 'enemies') {
    const room = h.encounter;
    if (room === null) return '!Only in a fight.';
    takeItem(h, index);
    const doubled = h.elixir;
    h.elixir = false;
    return `${h.name} hurls a Firebomb!${doubled ? ' (Elixir: double!)' : ''}`; // damage applied by combat
  }
  const targets = itemTargets(world, h, index);
  const tid = targetId ?? (def.target === 'self' || def.target === 'ally' ? h.id : targets[0]);
  if (!tid || !targets.includes(tid)) return '!No valid target.';
  const t = world.heroes[tid];
  if (t !== h && t.affliction === 'paranoid' && item !== 'salts') return `!${t.name} refuses your help. (Paranoid)`;
  if (item === 'bandage' && t.hp >= t.maxHp && !t.st.bleed) return `!${t === h ? "You're" : `${t.name} is`} not hurt.`;
  if (item === 'tonic' && t.stress <= 0) return '!You feel steady already.';
  takeItem(h, index);
  // Elixir: this one counts double.
  const x = h.elixir ? 2 : 1;
  h.elixir = false;
  const boost = x > 1 ? ' (Elixir: double!)' : '';
  switch (item) {
    case 'bandage': {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + 12 * x);
      delete t.st.bleed;
      return `${h.name} bandages ${t === h ? 'themself' : t.name} (+${t.hp - before}).${boost}`;
    }
    case 'torch':
      t.light = Math.min(LIGHT_MAX, t.light + 50 * x);
      return `${h.name} lights a fresh torch.${boost}`;
    case 'tonic':
      addStress(t, -25 * x);
      return `${h.name} drinks a tonic. (−${25 * x} stress)${boost}`;
    case 'salts':
      reviveHero(t, Math.min(1, 0.5 * x), world, h);
      return `${h.name} revives ${t.name} with smelling salts!${boost}`;
  }
  return `${h.name} uses ${def.name}.`;
}

export function useItemInField(world: World, h: Hero, index: number, targetId?: string): string | null {
  const def = ITEMS[h.items[index]];
  if (!def) return 'Nothing there.';
  if (!def.field) return def.kind === 'consumable' ? 'Only in a fight.' : "You can't use that.";
  if (h.encounter !== null) return 'Use it as your combat action.';
  const result = applyItem(world, h, index, targetId);
  if (result.startsWith('!')) return result.slice(1);
  notify(world, h, result);
  return null;
}

/** Cat's-Eye lets you see through dimness. */
export function seesInDark(h: Hero): boolean {
  return wornDefs(h).some((d) => d.seeDim);
}

