/** Global timing and tuning constants. All times in seconds. */
export const ESCALATION_INTERVAL = 120;
export const MAX_ESCALATION = 6;
export const EXIT_OPENS_AT = 600;
export const COLLAPSE_AT = 780;

export const SERVER_TICK = 0.1;

export const LIGHT_MAX = 100;
/** Per second. A full torch lasts ~8 minutes; plan expects 1–2 refills per run. */
export const LIGHT_DRAIN = 0.2;
/** Below this, you are Dim: neighbouring rooms are not revealed. */
export const LIGHT_DIM = 25;

/** Speed (seconds per turn / per tunnel) of an ordinary hero or monster. */
export const DEFAULT_SPEED = 5;
/** Nothing gets faster than this, whatever it carries or drinks. */
export const MIN_SPEED = 2;

export function escalationAt(time: number): number {
  return Math.min(MAX_ESCALATION, Math.floor(time / ESCALATION_INTERVAL));
}
