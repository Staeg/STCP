import { INVENTORY_SLOTS, ITEMS, LOOT, LOOT_TABLE, type ItemId } from '../content/items';
import { LIGHT_MAX } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { addStress, isConscious, monstersIn, reviveHero } from './combat';
import { notify } from './notify';
import type { Hero, World } from './world';

export const LEAVE = 'leave';
/** Bots defer to the humans' majority after this many seconds. */
export const BOT_DEFER_AFTER = 2;

export interface Vote {
  item: ItemId;
  /** voterId → recipient hero id, or LEAVE. */
  votes: Record<string, string>;
  startedAt: number;
}

export interface Pile {
  gold: number;
  /** Items waiting to be voted on (first one is next). */
  items: ItemId[];
  /** Items everyone agreed to leave. Anyone can claim one to start a new vote. */
  abandoned: ItemId[];
  vote: Vote | null;
}

// ---------------------------------------------------------------------------
// Seeding

export function spawnInitialLoot(world: World) {
  const d = world.dungeon;
  const rng = world.rng;
  for (const room of d.rooms) {
    if (room.kind !== 'normal') continue;
    const guarded = monstersIn(world, room.id).length > 0;
    const deadEnd = room.corridors.length === 1;
    const items: ItemId[] = [];
    let gold = 0;
    if (guarded ? rng.chance(LOOT.guardedChance) : rng.chance(LOOT.emptyChance)) {
      const [lo, hi] = guarded ? LOOT.guardedGold : LOOT.emptyGold;
      gold = rng.int(lo, hi);
      if (rng.chance(guarded ? LOOT.guardedItemChance : LOOT.emptyItemChance)) items.push(rollItem(world));
    }
    if (deadEnd && rng.chance(LOOT.deadEndBonusItemChance)) items.push(rollItem(world));
    if (gold || items.length) addToPile(world, room.id, gold, items);
  }
}

export function rollItem(world: World): ItemId {
  const total = LOOT_TABLE.reduce((s, e) => s + e.weight, 0);
  let roll = world.rng.float(0, total);
  for (const e of LOOT_TABLE) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return LOOT_TABLE[0].item;
}

export function addToPile(world: World, room: number, gold: number, items: ItemId[]) {
  const pile = (world.piles[room] ??= { gold: 0, items: [], abandoned: [], vote: null });
  pile.gold += gold;
  pile.items.push(...items);
}

// ---------------------------------------------------------------------------
// Inventory

export function hasSpace(h: Hero): boolean {
  return h.items.length < INVENTORY_SLOTS;
}

export function giveItem(h: Hero, item: ItemId) {
  h.items.push(item);
  if (item === 'locket') {
    h.maxHp += 8;
    if (h.downedAt === null) h.hp += 8;
  }
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
  return Object.values(world.heroes).filter((h) => !h.dead && h.pos.kind === 'room' && h.pos.room === room);
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

    if (pile.gold > 0) splitGold(world, room, pile);
    if (!pile.vote && pile.items.length) pile.vote = { item: pile.items.shift()!, votes: {}, startedAt: world.time };

    const vote = pile.vote;
    if (vote) {
      const ids = new Set(voters.map((v) => v.id));
      for (const id of Object.keys(vote.votes)) if (!ids.has(id)) delete vote.votes[id];
      // A vote for someone who can no longer take it is void.
      for (const [id, choice] of Object.entries(vote.votes)) if (!validChoice(world, room, choice)) delete vote.votes[id];
      const values = voters.map((v) => vote.votes[v.id]);
      if (values.every((v) => v !== undefined && v === values[0])) resolveVote(world, room, pile, values[0]!);
    }
    if (pile.gold === 0 && pile.items.length === 0 && pile.abandoned.length === 0 && !pile.vote) delete world.piles[room];
  }
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

function validChoice(world: World, room: number, choice: string): boolean {
  if (choice === LEAVE) return true;
  const h = world.heroes[choice];
  return !!h && !h.dead && h.pos.kind === 'room' && h.pos.room === room && hasSpace(h);
}

function resolveVote(world: World, room: number, pile: Pile, choice: string) {
  const vote = pile.vote!;
  const def = ITEMS[vote.item];
  pile.vote = null;
  const present = presentIn(world, room);
  if (choice === LEAVE) {
    pile.abandoned.push(vote.item);
    for (const h of present) notify(world, h, `Left the ${def.name} behind.`);
    return;
  }
  const winner = world.heroes[choice];
  giveItem(winner, vote.item);
  for (const h of present) notify(world, h, h === winner ? `You take the ${def.name}.` : `${winner.name} takes the ${def.name}.`);
}

/** Returns an error message or null. */
export function castVote(world: World, h: Hero, choice: string): string | null {
  if (h.pos.kind !== 'room') return 'Nothing to vote on.';
  const pile = world.piles[h.pos.room];
  if (!pile?.vote) return 'Nothing to vote on.';
  if (!votersIn(world, h.pos.room).includes(h)) return 'You cannot vote right now.';
  if (!validChoice(world, h.pos.room, choice)) return 'They cannot carry it.';
  pile.vote.votes[h.id] = choice;
  return null;
}

/** True while an unresolved vote in your room keeps you from leaving. */
export function lockedByVote(world: World, h: Hero): boolean {
  if (h.pos.kind !== 'room' || !isConscious(h)) return false;
  const pile = world.piles[h.pos.room];
  return !!pile && (!!pile.vote || pile.items.length > 0) && !world.encounters[h.pos.room] && monstersIn(world, h.pos.room).length === 0;
}

export function claimAbandoned(world: World, h: Hero, index: number): string | null {
  if (h.pos.kind !== 'room' || !isConscious(h) || h.encounter !== null) return 'Not now.';
  const pile = world.piles[h.pos.room];
  const item = pile?.abandoned[index];
  if (!pile || item === undefined) return 'Nothing there.';
  pile.abandoned.splice(index, 1);
  pile.items.push(item);
  return null;
}

/** Put an item from your pack on the floor of your room. Everyone present then votes on it. */
export function dropItem(world: World, h: Hero, index: number): string | null {
  if (h.pos.kind !== 'room' || h.encounter !== null) return 'Not now.';
  const item = takeItem(h, index);
  if (!item) return 'Nothing there.';
  addToPile(world, h.pos.room, 0, [item]);
  return null;
}

/** A hero died: everything they carried hits the floor. */
export function dropEverything(world: World, h: Hero) {
  const room = h.pos.kind === 'room' ? h.pos.room : h.pos.from;
  const items: ItemId[] = [];
  while (h.items.length) items.push(takeItem(h, 0)!);
  addToPile(world, room, h.gold, items);
  h.gold = 0;
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
        .filter((x) => !x.dead && x.downedAt !== null && x.pos.kind === 'room' && near.has(x.pos.room))
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
    return `${h.name} hurls a Firebomb!`; // damage applied by combat
  }
  const targets = itemTargets(world, h, index);
  const tid = targetId ?? (def.target === 'self' || def.target === 'ally' ? h.id : targets[0]);
  if (!tid || !targets.includes(tid)) return '!No valid target.';
  const t = world.heroes[tid];
  if (item === 'bandage' && t.hp >= t.maxHp && !t.st.bleed) return `!${t === h ? "You're" : `${t.name} is`} not hurt.`;
  if (item === 'tonic' && t.stress <= 0) return '!You feel steady already.';
  takeItem(h, index);
  switch (item) {
    case 'bandage': {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + 12);
      delete t.st.bleed;
      return `${h.name} bandages ${t === h ? 'themself' : t.name} (+${t.hp - before}).`;
    }
    case 'torch':
      t.light = Math.min(LIGHT_MAX, t.light + 50);
      return `${h.name} lights a fresh torch.`;
    case 'tonic':
      addStress(t, -25);
      return `${h.name} drinks a tonic. (−25 stress)`;
    case 'salts':
      reviveHero(t, 0.5);
      return `${h.name} revives ${t.name} with smelling salts!`;
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

