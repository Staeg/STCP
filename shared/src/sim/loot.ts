import {
  GEAR_SLOTS, GOLD_PER_SLOT, goldRoom, ITEMS, LOOT, LOOT_TABLE, packFits, packRank, packSlots, packSlotsUsed, INVENTORY_SLOTS, slotOf, RESOURCE_TABLE,
  type GearSlot, type ItemDef, type ItemId,
} from '../content/items';
import { LIGHT_MAX } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { addStress, inDungeon, isConscious, monstersIn, reviveHero, type Monster } from './combat';
import { ENEMIES } from '../content/enemies';
import { notify } from './notify';
import { chargeable, healBy, moveCharges, pullPackCharge, reliefBy, ward, type ItemCharge } from './gear';
import { CROWNED, STRESS } from '../content/events';
import { chronicle, crGold, roomName, type Hero, type World } from './world';

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
  /** voterId → recipient hero id. (Voting LEAVE isn't stored: it takes you out of this item's vote.) */
  votes: Record<string, string>;
  /** When the people now around it first saw it (bots defer). */
  startedAt: number;
  /** Heroes who have stood in the room with it; once they walk out they've passed it by. */
  seen: string[];
  /** Heroes who walked past it, dropped it or voted to leave it: they ignore it from now on. */
  passed: string[];
  /** Someone asked for it back: it's up for grabs again while they're here. */
  claimedBy: string | null;
  /** A piece that goes off by itself (Cloth) keeps its charge on the floor (none yet: a fresh one). */
  charge?: ItemCharge;
}

export interface Pile {
  gold: number;
  items: FloorItem[];
  /** Gold the dead dropped, by whose it was: an Undertaker who Raises them gives it back; anyone else just splits it. */
  corpseGold?: Record<string, number>;
  /** Gold a hero put down (user, 2026-10-11): split among everyone else present, never back to them. */
  dropped?: { by: string; gold: number }[];
}

/** All the loose gold in a pile (what's split, and what someone put down). */
export function pileGold(pile: Pile | undefined): number {
  return (pile?.gold ?? 0) + (pile?.dropped ?? []).reduce((s, d) => s + d.gold, 0);
}

/** Gold here this hero could take a share of: theirs to split, not dropped by them, and room in the pack for it. */
export function goldFor(h: Hero, pile: Pile | undefined): number {
  if (!pile || goldRoom(h.items, h.gold) <= 0) return 0;
  return pile.gold + (pile.dropped ?? []).filter((d) => d.by !== h.id).reduce((s, d) => s + d.gold, 0);
}

/** A pile with nothing left in it. */
function emptyPile(pile: Pile): boolean {
  return pile.gold === 0 && !pile.corpseGold && !pile.dropped && pile.items.length === 0;
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
    // Resources lie anywhere (behind the guards, too); Relics only in lairs.
    if (rng.chance(LOOT.resourceChance)) items.push(rollResource(world));
    if (deadEnd && rng.chance(LOOT.deadEndResourceChance)) items.push(rollResource(world));
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
export function rollResource(world: World): ItemId {
  const total = RESOURCE_TABLE.reduce((s, e) => s + e.weight, 0);
  let roll = world.rng.float(0, total);
  for (const e of RESOURCE_TABLE) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return RESOURCE_TABLE[0].item;
}

/** What a slain monster adds to its room's drop: tougher monsters (and later Escalations) are worth more. */
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
  if (world.rng.chance(LOOT.dropResourceChance)) items.push(rollResource(world));
  addToPile(world, room, 0, items);
}

/**
 * Crowned in Dread: the Dead King's treasure, worth `CROWNED.lairs` Lairs (their gold, Relic chances and bounty),
 * spills where the last of his procession fell. The bounty pays out with the rest when the room is clear.
 */
export function dropKingsTreasure(world: World, room: number) {
  const rng = world.rng;
  let gold = 0;
  const items: ItemId[] = [];
  for (let i = 0; i < CROWNED.lairs; i++) {
    gold += rng.int(...LOOT.lairGold);
    if (rng.chance(LOOT.relicChance)) items.push('relic');
  }
  addToPile(world, room, gold, items);
  world.bounty[room] = (world.bounty[room] ?? 0) + CROWNED.lairs * LOOT.lairBounty;
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
  const dropper = droppedBy ? world.heroes[droppedBy] : undefined;
  for (const item of items) {
    pile.items.push({
      id: world.nextId++, item, by: droppedBy, votes: {}, startedAt: world.time, seen: [], passed: droppedBy ? [droppedBy] : [], claimedBy: null,
      // What a hero puts down takes its charge with it (out of their pack's).
      ...(dropper && chargeable(item) ? { charge: pullPackCharge(dropper, item) } : {}),
    });
  }
}

/** Is there room on this floor for one more thing you put down? */
export function floorFull(world: World, room: number): boolean {
  return (world.piles[room]?.items.length ?? 0) >= LOOT.maxDrops;
}

// ---------------------------------------------------------------------------
// Inventory

/** Room in the pack: a free slot, or (given a resource) room on a stack of the same. */
export function hasSpace(h: Hero, item?: ItemId): boolean {
  return item ? packFits(h.items, item, h.gold) : packSlotsUsed(h.items, h.gold) < INVENTORY_SLOTS;
}

/**
 * Gear picked up goes on only if its slot is empty; otherwise it goes in the pack, whatever its rarity, to be put on
 * from there (user 2026-10-11).
 */
export function putsOn(h: Hero, item: ItemId): boolean {
  const slot = slotOf(item);
  return !!slot && !h[slot];
}

/** Gear that goes on (into an empty slot) can always be taken; the rest needs room. */
export function canTake(h: Hero, item: ItemId): boolean {
  // Gem Rite: no consumables at all.
  if (h.rites.includes('gem') && ITEMS[item].kind === 'consumable') return false;
  return putsOn(h, item) || hasSpace(h, item);
}

/** What this hero has on: weapon, armor, amulet, ring. */
export function wornDefs(h: Hero): ItemDef[] {
  return GEAR_SLOTS.map((s) => h[s]).filter((x): x is ItemId => !!x).map((x) => ITEMS[x]);
}

type WornNumber = 'maxHp' | 'hurt' | 'thorns' | 'regen' | 'stressMult' | 'lightDrainMult';

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
  moveCharges(h, slot, item, old);
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

/** Gear goes on if its slot is empty (see `putsOn`); everything else goes in the pack. */
export function giveItem(h: Hero, item: ItemId) {
  const slot = slotOf(item);
  if (slot && putsOn(h, item)) equip(h, slot, item);
  else stow(h, item);
}

/** Into the pack. Consumables always sit at the top (the first few get number keys), then Gear; resources stack below. */
function stow(h: Hero, item: ItemId) {
  const rank = packRank(item);
  const at = h.items.findIndex((x) => packRank(x) > rank);
  h.items.splice(at < 0 ? h.items.length : at, 0, item);
}

/** Put on a piece of Gear from the pack; what was worn there takes its place in the pack. */
export function equipFromPack(world: World, h: Hero, index: number): string | null {
  const item = h.items[index];
  const slot = item === undefined ? null : slotOf(item);
  if (!slot) return "You can't wear that.";
  if (h.encounter !== null || !isConscious(h)) return 'Not now.';
  takeItem(h, index);
  const old = equip(h, slot, item);
  if (old) stow(h, old);
  notify(world, h, `You put on the ${ITEMS[item].name}.`);
  return null;
}

export function takeItem(h: Hero, index: number): ItemId | null {
  const item = h.items[index];
  if (item === undefined) return null;
  h.items.splice(index, 1);
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

/** Would this hero bother with it? Not if they walked past it before or can't carry it. */
export function wants(h: Hero, f: FloorItem): boolean {
  return !f.passed.includes(h.id) && canTake(h, f.item);
}

/** Who has a say on this item: the voters here who haven't passed it by or left it (unless they claimed it back). */
export function decidersOf(f: FloorItem, voters: Hero[]): Hero[] {
  return voters.filter((v) => v.id === f.claimedBy || !f.passed.includes(v.id));
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
  // Before anyone splits the dead's things, an Undertaker standing over them Raises them, things and all.
  raiseTheFallen(world);
  for (const [key, pile] of Object.entries(world.piles)) {
    const room = Number(key);
    passBy(world, room, pile);
    if (world.encounters[room] || monstersIn(world, room).length > 0) continue;
    const voters = votersIn(world, room);
    if (voters.length === 0) continue;

    if (pile.corpseGold) claimCorpseGold(pile);
    if (pile.gold > 0 || pile.dropped) splitGold(world, room, pile);
    for (const f of pile.items) {
      if (f.seen.length === 0) f.startedAt = world.time;
      for (const v of voters) if (!f.seen.includes(v.id)) f.seen.push(v.id);
    }

    // Every item has its own vote, all at once; each goes as soon as everyone agrees on it.
    for (const f of activeItems(world, room, voters)) {
      if (!pile.items.includes(f)) continue;
      // Only those still in on this item decide: leaving it is like walking out, for this item alone.
      const deciders = decidersOf(f, voters);
      const ids = new Set(deciders.map((v) => v.id));
      for (const id of Object.keys(f.votes)) if (!ids.has(id)) delete f.votes[id];
      // A vote for someone who can no longer take it is void.
      for (const [id, choice] of Object.entries(f.votes)) if (!validChoice(world, room, choice, f)) delete f.votes[id];
      const values = deciders.map((v) => f.votes[v.id]);
      if (values.every((v) => v !== undefined && v === values[0])) resolveItem(world, room, pile, f, values[0]!);
    }
    if (emptyPile(pile)) delete world.piles[room];
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

/** Gold off the dead, once someone finds it and nobody Raised them: just gold to split. */
function claimCorpseGold(pile: Pile) {
  for (const gold of Object.values(pile.corpseGold ?? {})) pile.gold += gold;
  delete pile.corpseGold;
}

// ---------------------------------------------------------------------------
// Risen allies (the Undertaker's Mortician perk)

/** Where a dead hero's body (and what they dropped) lies. */
export function bodyRoom(h: Hero): number {
  return h.pos.kind === 'room' ? h.pos.room : h.pos.from;
}

/**
 * Mortician: a conscious Undertaker out of a fight, in a room with no monsters, Raises every fallen ally lying
 * there who hasn't been Raised before. The ally gets back up at full HP with what's left of their things (gear on,
 * pack and gold), and follows the Undertaker into every fight like the Unholy Uprising's dead.
 */
function raiseTheFallen(world: World) {
  for (const u of Object.values(world.heroes)) {
    if (u.cls !== 'undertaker' || !isConscious(u) || u.encounter !== null || u.pos.kind !== 'room') continue;
    const room = u.pos.room;
    if (world.encounters[room] || monstersIn(world, room).length > 0) continue;
    for (const dead of Object.values(world.heroes)) {
      if (!dead.dead || dead.raised || bodyRoom(dead) !== room) continue;
      raiseAlly(world, u, dead, room);
    }
  }
}

function raiseAlly(world: World, u: Hero, dead: Hero, room: number) {
  dead.raised = true;
  const pile = world.piles[room];
  if (pile) {
    // Whatever of theirs still lies here goes back on them (or in their pack). What won't fit stays down, fair game.
    for (const f of pile.items.filter((x) => x.by === dead.id)) {
      if (!canTake(dead, f.item)) continue;
      pile.items.splice(pile.items.indexOf(f), 1);
      giveItem(dead, f.item);
    }
    dead.gold += pile.corpseGold?.[dead.id] ?? 0;
    if (pile.corpseGold) {
      delete pile.corpseGold[dead.id];
      if (Object.keys(pile.corpseGold).length === 0) delete pile.corpseGold;
    }
    if (emptyPile(pile)) delete world.piles[room];
  }
  u.legion.push({ hero: dead.id, hp: dead.maxHp, maxHp: dead.maxHp, dmgMult: 1, turns: 1, permanent: true });
  chronicle(world, `${u.name} raised ${dead.name} from the dead.`);
  for (const x of presentIn(world, room)) {
    notify(world, x, x === u ? `${dead.name} rises at your word. Bring them to the exit and their Village keeps what they carry.` : `${u.name} raises ${dead.name}. Their empty eyes find you.`);
  }
  notify(world, dead, `${u.name} raises you. If they bring you out, your Village keeps what you carry.`);
}

/** A Risen ally is destroyed (or its Undertaker died): it falls where it stands, and its things are anyone's now. */
export function risenAllyFalls(world: World, dead: Hero, room: number) {
  dead.pos = { kind: 'room', room };
  dropEverything(world, dead);
  chronicle(world, `${dead.name}'s risen body fell again in ${roomName(world, dead)}.`);
}

/** A Risen ally made it out with its Undertaker: everything it carries goes to its Village. */
export function risenAllyEscapes(world: World, u: Hero, dead: Hero) {
  dead.legacy += dead.gold;
  dead.gold = 0;
  dead.legacyItems.push(...dead.items.splice(0));
  for (const slot of GEAR_SLOTS) {
    const worn = equip(dead, slot, null);
    if (worn) dead.legacyItems.push(worn);
  }
  dead.fate = `${dead.fate ?? 'died'}; ${u.name} raised them and walked them out`;
  chronicle(world, `${u.name} brought the risen ${dead.name} out, and what they carried home to their Village.`);
}

/** Give a floor item to a hero. */
function take(world: World, room: number, pile: Pile, h: Hero, f: FloorItem) {
  pile.items.splice(pile.items.indexOf(f), 1);
  if (f.charge) h.packCharges.push({ item: f.item, charge: f.charge });
  const def = ITEMS[f.item];
  const verb = putsOn(h, f.item) ? ['put on', 'puts on'] : ['take', 'takes'];
  giveItem(h, f.item);
  for (const x of presentIn(world, room)) notify(world, x, x === h ? `You ${verb[0]} the ${def.name}.` : `${h.name} ${verb[1]} the ${def.name}.`);
}

function splitGold(world: World, room: number, pile: Pile) {
  const present = presentIn(world, room);
  const before = pileGold(pile);
  const got = new Map<Hero, number>();
  pile.gold = shareGold(world, pile.gold, present, got);
  if (pile.dropped) {
    for (const d of pile.dropped) d.gold = shareGold(world, d.gold, present.filter((h) => h.id !== d.by), got);
    pile.dropped = pile.dropped.filter((d) => d.gold > 0);
    if (!pile.dropped.length) delete pile.dropped;
  }
  for (const [h, amount] of got) notify(world, h, present.length > 1 ? `+${amount} gold (split ${present.length} ways)` : `+${amount} gold`);
  // Only when something moved: a full pack doesn't nag every tick.
  const left = pileGold(pile);
  if (left > 0 && left < before) {
    for (const h of present) if (goldRoom(h.items, h.gold) <= 0 && isConscious(h)) notify(world, h, `Your pack is full: ${left} gold stays on the floor.`);
  }
}

/**
 * Gold carried takes pack space (user, 2026-10-11): hand `gold` out evenly among `heroes`, each up to what their pack
 * holds, passing the full ones' shares on to the rest. Returns what nobody could carry.
 */
function shareGold(world: World, gold: number, heroes: Hero[], got: Map<Hero, number>): number {
  let left = gold;
  let open = world.rng.shuffle(heroes.filter((h) => goldRoom(h.items, h.gold) > 0));
  while (left > 0 && open.length) {
    const each = Math.floor(left / open.length);
    let extra = left - each * open.length;
    for (const h of open) {
      const want = each + (extra-- > 0 ? 1 : 0);
      if (want <= 0) continue;
      const gain = Math.min(goldRoom(h.items, h.gold), want);
      h.gold += gain;
      left -= gain;
      got.set(h, (got.get(h) ?? 0) + gain);
    }
    open = open.filter((h) => goldRoom(h.items, h.gold) > 0);
  }
  return left;
}

/** Put down a slot's worth of gold (up to GOLD_PER_SLOT): the others here split it; it never comes back to you. */
export function dropGold(world: World, h: Hero, amount: number): string | null {
  if (h.pos.kind !== 'room' || h.encounter !== null) return 'Not now.';
  const n = Math.min(Math.floor(amount), GOLD_PER_SLOT, h.gold);
  if (n <= 0) return 'You have no gold.';
  h.gold -= n;
  const pile = (world.piles[h.pos.room] ??= { gold: 0, items: [] });
  const mine = pile.dropped?.find((d) => d.by === h.id);
  if (mine) mine.gold += n;
  else (pile.dropped ??= []).push({ by: h.id, gold: n });
  notify(world, h, `You put down ${n} gold.`);
  return null;
}

/** Can it go to them? Only to someone here who can carry it and hasn't left it (as if they'd walked out). */
function validChoice(world: World, room: number, choice: string, f: FloorItem): boolean {
  const h = world.heroes[choice];
  return !!h && !h.dead && h.pos.kind === 'room' && h.pos.room === room && canTake(h, f.item)
    && (h.id === f.claimedBy || !f.passed.includes(h.id));
}

/** Everyone still in on it agreed: hand it over. */
function resolveItem(world: World, room: number, pile: Pile, f: FloorItem, choice: string) {
  f.votes = {};
  take(world, room, pile, world.heroes[choice], f);
}

function floorItem(world: World, h: Hero, id: number): FloorItem | undefined {
  return h.pos.kind === 'room' ? world.piles[h.pos.room]?.items.find((f) => f.id === id) : undefined;
}

/**
 * Vote on who gets a floor item (alone, voting for yourself just picks it up). LEAVE takes you out of this item's
 * vote, as walking out would: the others settle it without you, and you can still claim it back. Returns an error
 * message or null.
 */
export function castVote(world: World, h: Hero, id: number, choice: string): string | null {
  const f = floorItem(world, h, id);
  if (!f || h.pos.kind !== 'room') return 'Nothing to vote on.';
  const room = h.pos.room;
  if (!votersIn(world, room).includes(h)) return 'You cannot vote right now.';
  if (!activeItems(world, room).includes(f) || !decidersOf(f, [h]).length) return 'You left that. Claim it first.';
  if (choice === LEAVE) {
    delete f.votes[h.id];
    if (!f.passed.includes(h.id)) f.passed.push(h.id);
    if (f.claimedBy === h.id) f.claimedBy = null;
    const name = ITEMS[f.item].name;
    for (const x of presentIn(world, room)) notify(world, x, x === h ? `You leave the ${name}.` : `${h.name} leaves the ${name}.`);
    return null;
  }
  if (!validChoice(world, room, choice, f)) return 'They cannot carry it.';
  f.votes[h.id] = choice;
  return null;
}

/** Pick an ignored item back up off the floor: if nobody else here is in on it, you just take it; else you rejoin its vote. */
export function claimItem(world: World, h: Hero, id: number): string | null {
  if (h.pos.kind !== 'room' || !isConscious(h) || h.encounter !== null) return 'Not now.';
  const room = h.pos.room;
  const pile = world.piles[room];
  const f = floorItem(world, h, id);
  if (!pile || !f || world.encounters[room] || monstersIn(world, room).length > 0) return 'Nothing there.';
  f.passed = f.passed.filter((x) => x !== h.id);
  // Nobody else here is still in on it (alone, or they all left it): it's yours.
  if (decidersOf(f, votersIn(world, room)).length === 1) {
    if (!canTake(h, f.item)) return 'Your pack is full.';
    take(world, room, pile, h, f);
    return null;
  }
  f.claimedBy = h.id;
  f.startedAt = world.time;
  return null;
}

/**
 * Put an item from your pack on the floor of your room (a whole stack of resources at once). Others there can then
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
/** Tome Rite: the hero's gold and consumables go home whatever happens to them (consumables: user 2026-10-10). */
export function tomeLegacy(h: Hero) {
  h.legacy += h.gold;
  h.gold = 0;
  h.legacyItems.push(...h.items.filter((it) => ITEMS[it].kind === 'consumable'));
  h.items = h.items.filter((it) => ITEMS[it].kind !== 'consumable');
}

export function dropEverything(world: World, h: Hero) {
  const room = h.pos.kind === 'room' ? h.pos.room : h.pos.from;
  // Tome Rite: the gold and consumables are bound to the Village, and go home whatever happens.
  if (h.rites.includes('tome')) tomeLegacy(h);
  const items: ItemId[] = [];
  while (h.items.length) items.push(takeItem(h, 0)!);
  for (const slot of GEAR_SLOTS) {
    const worn = equip(h, slot, null);
    if (worn) items.push(worn);
  }
  addToPile(world, room, 0, items, h.id);
  const pile = world.piles[room];
  if (h.gold > 0) (pile.corpseGold ??= {})[h.id] = (pile.corpseGold?.[h.id] ?? 0) + h.gold;
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
        .filter((x) => inDungeon(x) && x.downedAt !== null && x.pos.kind === 'room' && near.has(x.pos.room))
        .map((x) => x.id);
    }
    case 'enemies':
      return [];
  }
}

/** Who an item would go to: the one named, else yourself (or the first downed hero in reach, for Salts). */
function itemTarget(world: World, h: Hero, index: number, targetId?: string): string | undefined {
  const def = ITEMS[h.items[index]];
  return targetId ?? (def.target === 'self' || def.target === 'ally' ? h.id : itemTargets(world, h, index)[0]);
}

/** Why a (non-Firebomb) item can't go to that target, or null if it can. */
function itemTargetError(world: World, h: Hero, index: number, targetId?: string): string | null {
  const item = h.items[index];
  const tid = itemTarget(world, h, index, targetId);
  if (!tid || !itemTargets(world, h, index).includes(tid)) return 'No valid target.';
  const t = world.heroes[tid];
  if (item === 'bandage' && t.hp >= t.maxHp && !t.st.poison) return `${t === h ? "You're" : `${t.name} is`} not hurt.`;
  if (item === 'tonic' && t.stress <= 0) return 'You feel steady already.';
  return null;
}

/** Why this hero can't use pack item `index` out of a fight (null = they can). Checks only; nothing is used up. */
export function fieldItemError(world: World, h: Hero, index: number, targetId?: string): string | null {
  const def = ITEMS[h.items[index]];
  if (!def) return 'Nothing there.';
  if (h.rites.includes('gem') && def.kind === 'consumable') return 'The Gem Rite forbids it. Drop it for an ally.';
  if (!def.field) return def.kind === 'consumable' ? 'Only in a fight.' : "You can't use that.";
  if (h.encounter !== null) return 'Use it as your combat action.';
  return itemTargetError(world, h, index, targetId);
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
  const err = itemTargetError(world, h, index, targetId);
  if (err) return `!${err}`;
  const t = world.heroes[itemTarget(world, h, index, targetId)!];
  takeItem(h, index);
  // Elixir: this one counts double.
  const x = h.elixir ? 2 : 1;
  h.elixir = false;
  const boost = x > 1 ? ' (Elixir: double!)' : '';
  // Warding Staff: healing and easing someone with an item shields them too.
  const warded = () => {
    const shield = ward(h, t);
    return shield ? ` (+${shield} Shield)` : '';
  };
  switch (item) {
    case 'bandage': {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + healBy(h, 12 * x));
      delete t.st.poison;
      return `${h.name} bandages ${t === h ? 'themself' : t.name} (+${t.hp - before}).${boost}${warded()}`;
    }
    case 'torch':
      t.light = Math.min(LIGHT_MAX, t.light + 50 * x);
      return `${h.name} lights a fresh torch.${boost}`;
    case 'tonic': {
      const eased = reliefBy(h, STRESS.tonic * x);
      addStress(t, -eased);
      return `${h.name} drinks a tonic. (−${eased} stress)${boost}${warded()}`;
    }
    case 'salts':
      reviveHero(t, Math.min(1, healBy(h, 50 * x) / 100), world, h);
      return `${h.name} revives ${t.name} with smelling salts!${boost}${warded()}`;
  }
  return `${h.name} uses ${def.name}.`;
}

export function useItemInField(world: World, h: Hero, index: number, targetId?: string): string | null {
  const err = fieldItemError(world, h, index, targetId);
  if (err) return err;
  const result = applyItem(world, h, index, targetId);
  if (result.startsWith('!')) return result.slice(1);
  notify(world, h, result);
  return null;
}

/** Cat's-Eye lets you see through dimness (and keeps you from forgetting paths). */
export function seesInDark(h: Hero): boolean {
  return wornDefs(h).some((d) => d.seeDim);
}

