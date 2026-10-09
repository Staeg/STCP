import { gearGain, INVENTORY_SLOTS, isGear, itemTier, ITEMS, LOOT, LOOT_TABLE, type GearSlot, type ItemId } from '../content/items';
import { LIGHT_MAX } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { addStress, inDungeon, isConscious, monstersIn, reviveHero, type Monster } from './combat';
import { ENEMIES } from '../content/enemies';
import { notify } from './notify';
import { STRESS } from '../content/events';
import type { Hero, World } from './world';

export const LEAVE = 'leave';
/** Bots defer to the humans' majority after this many seconds. */
export const BOT_DEFER_AFTER = 2;

export interface Vote {
  item: ItemId;
  /** voterId → recipient hero id, or LEAVE. */
  votes: Record<string, string>;
  startedAt: number;
  /** Who last put it on the floor (null: found there). They don't pick it up automatically. */
  droppedBy: string | null;
}

export interface Pile {
  gold: number;
  /** Items waiting to be voted on (first one is next). */
  items: ItemId[];
  /** Items everyone agreed to leave. Anyone can claim one to start a new vote. */
  abandoned: ItemId[];
  vote: Vote | null;
  /** Who dropped each item, parallel to `items` and `abandoned` (null: found there). */
  itemsBy: (string | null)[];
  abandonedBy: (string | null)[];
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
  const count = 1 + Math.floor(points / LOOT.dropPointsPerItem);
  const items = Array.from({ length: count }, () => rollItem(world, quality));
  addToPile(world, room, 0, items);
}

export function addToPile(world: World, room: number, gold: number, items: ItemId[], droppedBy: string | null = null) {
  const pile = (world.piles[room] ??= { gold: 0, items: [], abandoned: [], vote: null, itemsBy: [], abandonedBy: [] });
  pile.gold += gold;
  pile.items.push(...items);
  pile.itemsBy.push(...items.map(() => droppedBy));
}

// ---------------------------------------------------------------------------
// Inventory

export function hasSpace(h: Hero): boolean {
  return h.items.length < INVENTORY_SLOTS;
}

/**
 * Gear swaps with what you wear, unless it's a lower tier than that (take yours off first if you
 * really want it); anything else needs a free pack slot.
 */
export function canTake(h: Hero, item: ItemId): boolean {
  const kind = ITEMS[item].kind;
  if (kind === 'weapon' || kind === 'armor') {
    const worn = h[kind];
    return !worn || itemTier(item) >= itemTier(worn);
  }
  return hasSpace(h);
}

/** Returns the gear this displaced, if any (the caller puts it on the floor). */
export function giveItem(h: Hero, item: ItemId): ItemId | null {
  const def = ITEMS[item];
  if (def.kind === 'weapon' || def.kind === 'armor') {
    const old = h[def.kind];
    h[def.kind] = item;
    return old;
  }
  h.items.push(item);
  if (item === 'locket') {
    h.maxHp += 8;
    if (h.downedAt === null) h.hp += 8;
  }
  return null;
}

export function takeItem(h: Hero, index: number): ItemId | null {
  const item = h.items[index];
  if (item === undefined) return null;
  h.items.splice(index, 1);
  if (item === 'locket') {
    h.maxHp -= 8;
    h.hp = Math.min(h.hp, h.maxHp);
  }
  return item;
}


/** Who's in a room: everyone not dead (downed heroes still get a share). */
function presentIn(world: World, room: number): Hero[] {
  return Object.values(world.heroes).filter((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room);
}

/** Conscious, not fighting: the people who must agree on an item. */
export function votersIn(world: World, room: number): Hero[] {
  return presentIn(world, room).filter((h) => isConscious(h) && h.encounter === null);
}

// ---------------------------------------------------------------------------
// Pickup & voting

export function tickLoot(world: World) {
  for (const [key, pile] of Object.entries(world.piles)) {
    const room = Number(key);
    if (world.encounters[room] || monstersIn(world, room).length > 0) continue;
    const voters = votersIn(world, room);
    if (voters.length === 0) continue;

    if (pile.corpseGold) claimCorpseGold(world, pile, voters);
    const undertaker = voters.find((v) => v.cls === 'undertaker');
    if (undertaker) mortician(world, room, pile, undertaker);
    if (pile.gold > 0) splitGold(world, room, pile);
    if (voters.length === 1) autoPickup(world, room, voters[0]);
    if (!pile.vote && pile.items.length) {
      pile.vote = { item: pile.items.shift()!, votes: {}, startedAt: world.time, droppedBy: pile.itemsBy.shift() ?? null };
    }

    const vote = pile.vote;
    if (vote) {
      // Selfish heroes always claim it, and get outvoted by being ignored after a grace period.
      const graceOver = world.time - vote.startedAt > STRESS.selfishGrace;
      for (const v of voters) if (v.affliction === 'selfish' && canTake(v, vote.item)) vote.votes[v.id] = v.id;
      if (graceOver) {
        const fair = voters.filter((v) => v.affliction !== 'selfish');
        if (fair.length) voters.splice(0, voters.length, ...fair);
      }
      const ids = new Set(voters.map((v) => v.id));
      for (const id of Object.keys(vote.votes)) if (!ids.has(id)) delete vote.votes[id];
      // A vote for someone who can no longer take it is void.
      for (const [id, choice] of Object.entries(vote.votes)) if (!validChoice(world, room, choice, vote.item)) delete vote.votes[id];
      const values = voters.map((v) => vote.votes[v.id]);
      if (values.every((v) => v !== undefined && v === values[0])) resolveVote(world, room, pile, values[0]!);
    }
    if (pile.gold === 0 && !pile.corpseGold && pile.items.length === 0 && pile.abandoned.length === 0 && !pile.vote) delete world.piles[room];
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
    const def = ITEMS[item];
    if (def.kind === 'weapon' || def.kind === 'armor') return gearGain(item, u[def.kind]) > 0;
    return hasSpace(u);
  };
  if (pile.vote && fromTheDead(world, pile.vote.droppedBy) && wanted(pile.vote.item)) resolveVote(world, room, pile, u.id);
  for (const [list, by] of [[pile.items, pile.itemsBy], [pile.abandoned, pile.abandonedBy]] as const) {
    for (let i = 0; i < list.length; ) {
      if (!fromTheDead(world, by[i]) || !wanted(list[i])) {
        i++;
        continue;
      }
      const [item] = list.splice(i, 1);
      by.splice(i, 1);
      take(world, room, u, item);
    }
  }
}

/**
 * Alone in a room, you just take everything you can carry, except what you dropped yourself
 * (the last person to drop an item is remembered, so it can change hands and be dropped again).
 */
export function autoPickup(world: World, room: number, h: Hero) {
  const pile = world.piles[room];
  if (!pile || world.encounters[room] || monstersIn(world, room).length > 0) return;
  const mine = (by: string | null | undefined) => by === h.id;
  if (pile.vote && !mine(pile.vote.droppedBy) && canTake(h, pile.vote.item)) resolveVote(world, room, pile, h.id);
  for (const [list, by] of [[pile.items, pile.itemsBy], [pile.abandoned, pile.abandonedBy]] as const) {
    for (let i = 0; i < list.length; ) {
      if (mine(by[i]) || !canTake(h, list[i])) {
        i++;
        continue;
      }
      const [item] = list.splice(i, 1);
      by.splice(i, 1);
      take(world, room, h, item);
    }
  }
}

/** Give a floor item to a hero; gear they had on goes back on the floor as theirs. */
function take(world: World, room: number, h: Hero, item: ItemId) {
  const def = ITEMS[item];
  const old = giveItem(h, item);
  const verb = isGear(item) ? ['equip', 'equips'] : ['take', 'takes'];
  for (const x of presentIn(world, room)) notify(world, x, x === h ? `You ${verb[0]} the ${def.name}.` : `${h.name} ${verb[1]} the ${def.name}.`);
  // The piece it replaced goes on the floor, to be voted on like any other find.
  if (old) addToPile(world, room, 0, [old], h.id);
}

function splitGold(world: World, room: number, pile: Pile) {
  const present = presentIn(world, room);
  const share = Math.floor(pile.gold / present.length);
  let remainder = pile.gold - share * present.length;
  for (const h of world.rng.shuffle(present)) {
    let amount = share + (remainder-- > 0 ? 1 : 0);
    if (h.items.includes('coin')) amount = Math.round(amount * 1.1);
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

function resolveVote(world: World, room: number, pile: Pile, choice: string) {
  const vote = pile.vote!;
  const def = ITEMS[vote.item];
  pile.vote = null;
  if (choice === LEAVE) {
    pile.abandoned.push(vote.item);
    pile.abandonedBy.push(vote.droppedBy);
    for (const h of presentIn(world, room)) notify(world, h, `Left the ${def.name} behind.`);
    return;
  }
  take(world, room, world.heroes[choice], vote.item);
}

/** Returns an error message or null. */
export function castVote(world: World, h: Hero, choice: string): string | null {
  if (h.pos.kind !== 'room') return 'Nothing to vote on.';
  const pile = world.piles[h.pos.room];
  if (!pile?.vote) return 'Nothing to vote on.';
  if (!votersIn(world, h.pos.room).includes(h)) return 'You cannot vote right now.';
  if (!validChoice(world, h.pos.room, choice, pile.vote.item)) return 'They cannot carry it.';
  if (h.affliction === 'selfish' && canTake(h, pile.vote.item) && choice !== h.id) return 'Mine! (Selfish)';
  pile.vote.votes[h.id] = choice;
  return null;
}

export function claimAbandoned(world: World, h: Hero, index: number): string | null {
  if (h.pos.kind !== 'room' || !isConscious(h) || h.encounter !== null) return 'Not now.';
  const pile = world.piles[h.pos.room];
  const item = pile?.abandoned[index];
  if (!pile || item === undefined) return 'Nothing there.';
  pile.abandoned.splice(index, 1);
  pile.items.push(item);
  pile.itemsBy.push(pile.abandonedBy.splice(index, 1)[0] ?? null);
  return null;
}

/** Put an item from your pack on the floor of your room. Everyone present then votes on it. */
export function dropItem(world: World, h: Hero, index: number): string | null {
  if (h.pos.kind !== 'room' || h.encounter !== null) return 'Not now.';
  const item = takeItem(h, index);
  if (!item) return 'Nothing there.';
  addToPile(world, h.pos.room, 0, [item], h.id);
  return null;
}

/** Take off a weapon or armor and put it on the floor of your room for a vote. */
export function unequip(world: World, h: Hero, slot: GearSlot): string | null {
  if (h.pos.kind !== 'room' || h.encounter !== null) return 'Not now.';
  const item = h[slot];
  if (!item) return 'Nothing there.';
  h[slot] = null;
  addToPile(world, h.pos.room, 0, [item], h.id);
  return null;
}

/** A hero died: everything they carried hits the floor. */
export function dropEverything(world: World, h: Hero) {
  const room = h.pos.kind === 'room' ? h.pos.room : h.pos.from;
  const items: ItemId[] = [];
  while (h.items.length) items.push(takeItem(h, 0)!);
  for (const slot of ['weapon', 'armor'] as const) {
    if (h[slot]) items.push(h[slot]!);
    h[slot] = null;
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
  if (def.kind === 'trinket') return '!Trinkets work on their own.';
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
  if (!def.field) return def.kind === 'trinket' ? 'Trinkets work on their own.' : 'Only in a fight.';
  if (h.encounter !== null) return 'Use it as your combat action.';
  const result = applyItem(world, h, index, targetId);
  if (result.startsWith('!')) return result.slice(1);
  notify(world, h, result);
  return null;
}

/** Cat's-Eye lets you see through dimness. */
export function seesInDark(h: Hero): boolean {
  return h.items.includes('catseye');
}

