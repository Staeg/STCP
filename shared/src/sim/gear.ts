import { ITEMS, STAFF, type StaffEffect } from '../content/items';
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

/** Censer Staff: stress this hero takes off anyone (and what Take Their Sins can move). */
export function reliefBy(h: Pick<Hero, 'weapon'>, n: number): number {
  return staffOf(h) === 'relief' ? Math.round(n * STAFF.reliefMult) : n;
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
