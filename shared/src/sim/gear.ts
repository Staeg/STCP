import { ITEMS, STAFF, type ClothEffect, type GearSlot, type ItemId, type StaffEffect } from '../content/items';
import type { Statuses } from './combat';
import type { Hero } from './world';

/** Staves (user 2026-10-11): the effect of the staff this hero carries in their weapon slot, if any. */
export function staffOf(h: Pick<Hero, 'weapon'>): StaffEffect | null {
  return h.weapon ? ITEMS[h.weapon].staff ?? null : null;
}

/** Shepherd's Crook: healing this hero gives (to anyone, themself included). */
export function healBy(h: Pick<Hero, 'weapon'>, n: number): number {
  return staffOf(h) === 'heal' ? Math.round(n * STAFF.healMult) : n;
}

/** Censer Staff: light this hero gives someone else (Vigil, Take Their Sins, Rekindle…; it was stress relief until 2026-10-14). */
export function lightBy(h: Pick<Hero, 'weapon'>, t: unknown, n: number): number {
  return staffOf(h) === 'relief' && t !== h ? Math.round(n * STAFF.reliefMult) : n;
}

/** Rowan Staff: turns a debuff this hero places lasts. */
export function debuffTurns(h: Pick<Hero, 'weapon'>, turns: number): number {
  return staffOf(h) === 'linger' ? turns + STAFF.lingerTurns : turns;
}

/** Twinned Staff: how many times each debuff this hero places lands. */
export function debuffCopies(h: Pick<Hero, 'weapon'>): number {
  return staffOf(h) === 'twin' ? 2 : 1;
}

/** Evergreen Staff: how long a buff this hero places lasts (turns or seconds). */
export function buffLength(h: Pick<Hero, 'weapon'>, n: number): number {
  return staffOf(h) === 'evergreen' ? n * STAFF.evergreenMult : n;
}

/** Hourglass Staff: a cooldown this hero is put on (it can reach 0). */
export function cooldownFor(h: Pick<Hero, 'weapon'>, cd: number): number {
  return staffOf(h) === 'hourglass' ? Math.max(0, cd - STAFF.hourglassCut) : cd;
}

/** Warding Staff: whoever this hero heals, buffs or relieves (in a fight or not) gains Shield. Returns how much. */
export function ward(h: Pick<Hero, 'weapon'>, t: { st: Statuses }): number {
  if (staffOf(h) !== 'ward') return 0;
  t.st.shield = (t.st.shield ?? 0) + STAFF.wardShield;
  return STAFF.wardShield;
}

/** Witchwood Staff: a debuff this hero placed marks the target to take more from everyone while any debuff lasts. */
export function markWitchwood(h: Pick<Hero, 'weapon'>, st: Statuses) {
  if (staffOf(h) === 'witch') st.witchwood = true;
}

/** Is anything weakening this unit right now (Hexed, Acid, Poison, Weak or Stun)? */
export function debuffed(st: Statuses): boolean {
  return !!(st.hexed?.length || st.acid || st.poison?.length || st.weak || st.stun);
}

/** Witchwood's extra damage on a marked target, while it still carries a debuff (the mark goes when they're all gone). */
export function witchwoodMult(st: Statuses): number {
  if (!st.witchwood) return 1;
  if (debuffed(st)) return STAFF.witchMult;
  delete st.witchwood;
  return 1;
}

// ---------------------------------------------------------------------------
// Cloth charges (user 2026-10-11): each copy keeps its own cooldown and uses, wherever it goes (worn, in a pack,
// on the floor), so a spent piece stays spent when it changes hands. Cooldowns only run while it's worn.

export interface ItemCharge {
  /** Seconds of cooldown left (counted down only while worn). */
  cdLeft: number;
  /** Uses left this run (null: no limit). */
  usesLeft: number | null;
  /** Once-a-fight pieces: already went off in this fight. */
  usedThisFight: boolean;
  /** Gravecloth: the room it has been holding the wearer up in (until they leave it). */
  graveRoom: number | null;
  /** Turned off by its wearer: it never goes off and spends nothing. */
  disabled: boolean;
}

/** Does this piece keep a charge (anything that goes off by itself)? */
export function chargeable(item: ItemId): boolean {
  return !!ITEMS[item].auto;
}

export function freshCharge(item: ItemId): ItemCharge {
  return { cdLeft: 0, usesLeft: ITEMS[item].cloth?.usesPerRun ?? null, usedThisFight: false, graveRoom: null, disabled: false };
}

/** The charge of a piece in the hero's pack (the first of that kind), taken out; a fresh one if none was kept. */
export function pullPackCharge(h: Hero, item: ItemId): ItemCharge {
  const i = h.packCharges.findIndex((c) => c.item === item);
  if (i < 0) return freshCharge(item);
  return h.packCharges.splice(i, 1)[0].charge;
}

/** Called by `equip`: the charge follows the piece into the slot, and the old piece's into the pack. */
export function moveCharges(h: Hero, slot: GearSlot, item: ItemId | null, old: ItemId | null) {
  if (old && chargeable(old)) h.packCharges.push({ item: old, charge: h.charges[slot] ?? freshCharge(old) });
  delete h.charges[slot];
  if (item && chargeable(item)) h.charges[slot] = pullPackCharge(h, item);
}

/** The worn armor's charge, if it's this Cloth and ready to go off. */
export function clothReady(h: Hero, effect: ClothEffect): ItemCharge | null {
  const def = h.armor ? ITEMS[h.armor].cloth : undefined;
  if (!def || def.effect !== effect) return null;
  const c = wornCharge(h, 'armor')!;
  if (c.disabled) return null;
  if (effect === 'grave' && c.graveRoom !== null && h.pos.kind === 'room' && c.graveRoom === h.pos.room) return c;
  if (c.cdLeft > 0 || c.usesLeft === 0 || (def.perFight && c.usedThisFight)) return null;
  return c;
}

/** The charge of what's worn in this slot (put on without `equip`, as kits and tests do: a fresh one). */
export function wornCharge(h: Hero, slot: GearSlot): ItemCharge | null {
  const item = h[slot];
  if (!item || !chargeable(item)) return null;
  return (h.charges[slot] ??= freshCharge(item));
}

/** It went off: start its cooldown, use one up. */
export function spendCloth(h: Hero, c: ItemCharge) {
  const def = ITEMS[h.armor!].cloth!;
  c.cdLeft = def.cooldown ?? 0;
  if (c.usesLeft !== null) c.usesLeft = Math.max(0, c.usesLeft - 1);
  if (def.perFight) c.usedThisFight = true;
}

/** Worn cooldowns run down (pack and floor copies wait). */
export function tickCharges(h: Hero, dt: number) {
  for (const c of Object.values(h.charges)) if (c && c.cdLeft > 0) c.cdLeft = Math.max(0, c.cdLeft - dt);
}

/** This hero joins a fight: once-a-fight pieces are ready for it. */
export function chargesForFight(h: Hero) {
  for (const c of Object.values(h.charges)) if (c) c.usedThisFight = false;
}

/** The hero walked out of a room: Softstep's cover and Gravecloth's hold on that room end. */
export function leftRoom(h: Hero) {
  h.unnoticedIn = null;
  const c = h.charges.armor;
  if (c) c.graveRoom = null;
}

/** Turn an auto-trigger piece off or on (click). Returns an error, or null. */
export function toggleAuto(h: Hero, slot: GearSlot): string | null {
  const c = wornCharge(h, slot);
  if (!c) return 'Nothing there goes off by itself.';
  c.disabled = !c.disabled;
  return null;
}
