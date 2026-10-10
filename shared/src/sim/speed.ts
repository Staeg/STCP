import { CLASS_RULES } from '../content/abilities';
import { CLASSES } from '../content/classes';
import { MIN_SPEED } from '../content/constants';
import { CLASS_EVENTS, EVENT_SEEDING } from '../content/events';
import { ITEMS } from '../content/items';
import type { Hero } from './world';

/**
 * Speed: a hero's personal timer. It's the seconds between their turns in a fight and the
 * seconds they take to walk a tunnel. Lower is faster. Class sets the base; worn weapons and
 * armor slow you, cursed amulets and rings quicken you, and some events add to it or take from it.
 */
export interface SpeedMod {
  /** Seconds added (negative = faster). */
  amount: number;
  /** Game time it wears off, or null for the rest of the run. */
  until: number | null;
  /** What caused it, for the breakdown tooltip ("Quicksilver"). */
  label: string;
}

export interface SpeedPart {
  label: string;
  amount: number;
}

/** Everything that makes up a hero's Speed right now: class base first, then what you wear, then effects. */
export function speedParts(h: Hero, now: number): SpeedPart[] {
  const parts: SpeedPart[] = [{ label: CLASSES[h.cls].name, amount: CLASSES[h.cls].speed }];
  for (const id of [h.weapon, h.armor, h.amulet, h.ring]) {
    const cost = id ? ITEMS[id].speed : undefined;
    if (cost) parts.push({ label: ITEMS[id!].name, amount: cost });
  }
  for (const m of h.speedMods ?? []) {
    if (m.until === null || m.until > now) parts.push({ label: m.label, amount: m.amount });
  }
  if (h.leading) parts.push({ label: 'Escorting a villager', amount: escortSpeed(h) });
  if (h.cls === 'witch' && h.affliction) parts.push({ label: 'Afflicted Witch', amount: CLASS_RULES.witchAfflictedSpeed });
  return parts;
}

/** What escorting a villager does to your Speed: slower, except for the Warden, whom it hurries along. */
export function escortSpeed(h: Pick<Hero, 'cls'>): number {
  return h.cls === 'warden' ? CLASS_EVENTS.wardenEscortSpeed : EVENT_SEEDING.villagerSlow;
}

/** Seconds per turn / per tunnel, to a tenth of a second. Never below MIN_SPEED. */
export function speedOf(h: Hero, now: number): number {
  const total = speedParts(h, now).reduce((s, p) => s + p.amount, 0);
  return Math.max(MIN_SPEED, Math.round(total * 10) / 10);
}

/** Give a hero a Speed effect (negative amount = faster). `duration` null = for the rest of the run. */
export function addSpeedMod(h: Hero, now: number, amount: number, duration: number | null, label: string) {
  h.speedMods = (h.speedMods ?? []).filter((m) => m.until === null || m.until > now);
  h.speedMods.push({ amount, until: duration === null ? null : now + duration, label });
}

/** "5.6s" */
export function fmtSpeed(s: number): string {
  return `${s.toFixed(1).replace(/\.0$/, '')}s`;
}
