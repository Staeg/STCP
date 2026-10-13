import { CLASS_RULES } from '../content/innates';
import { CLASSES } from '../content/classes';
import { MIN_SPEED } from '../content/constants';
import { CLASS_EVENTS, ELITE_EVENTS, EVENTS, EVENT_SEEDING } from '../content/events';
import { GEAR_SLOTS, ISSUED_WEIGHT, ITEMS } from '../content/items';
import type { Hero } from './world';

/**
 * Speed: a hero's personal timer. It's the seconds they take to walk a tunnel, and (M15) the wait before their first
 * action in a fight; after that, each card they play says how long until the next. Lower is faster. Class sets the base; worn weapons and
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
  for (const slot of GEAR_SLOTS) {
    const id = h[slot];
    if (!id) continue;
    // Issued Gear (M15) weighs the same whatever it is: taking it off makes you a little quicker.
    const cost = h.issued?.[slot] === id ? ISSUED_WEIGHT : ITEMS[id].speed ?? 0;
    if (cost) parts.push({ label: ITEMS[id].name, amount: cost });
  }
  // Valuables weigh you down while you carry them.
  for (const id of h.items) {
    const cost = ITEMS[id].kind === 'valuable' ? ITEMS[id].speed : undefined;
    if (cost) parts.push({ label: ITEMS[id].name, amount: cost });
  }
  for (const m of h.speedMods ?? []) {
    if (m.until === null || m.until > now) parts.push({ label: m.label, amount: m.amount });
  }
  const led = h.leading.length;
  if (led) parts.push({ label: led > 1 ? `Escorting ${led} villagers` : 'Escorting a villager', amount: led * escortSpeed(h) });
  if (h.cls === 'sorceress' && h.insane) parts.push({ label: 'Insane Sorceress', amount: CLASS_RULES.sorceressInsaneSpeed });
  // Elite Events.
  if (h.wanderers > 0) parts.push({ label: EVENTS.wanderers.name, amount: h.wanderers * CLASS_EVENTS.wardenEscortSpeed });
  if (h.elite.alacrity) {
    const n = h.items.filter((id) => ITEMS[id].kind === 'consumable').length;
    if (n) parts.push({ label: EVENTS.alacrity.name, amount: n * ELITE_EVENTS.alacrityPerItem });
  }
  // Sinful Sacrament: the fastest there is, whatever else would slow you.
  if (h.elite.sacrament) {
    const total = parts.reduce((s, p) => s + p.amount, 0);
    parts.push({ label: EVENTS.sacrament.name, amount: MIN_SPEED - total });
  }
  return parts;
}

/** What escorting one villager does to your Speed (each one counts): slower, except for the Warden, whom it hurries along. */
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
