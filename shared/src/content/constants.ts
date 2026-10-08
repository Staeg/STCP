/** Global timing and tuning constants. All times in seconds. */
export const TIER_INTERVAL = 120;
export const MAX_TIER = 6;
export const EXIT_OPENS_AT = 600;
export const COLLAPSE_AT = 780;

export const SERVER_TICK = 0.1;

export const LIGHT_MAX = 100;
/** Per second. A full torch lasts ~8 minutes; plan expects 1–2 refills per run. */
export const LIGHT_DRAIN = 0.2;
/** Below this, you are Dim: neighbouring rooms are not revealed. */
export const LIGHT_DIM = 25;

export function tierAt(time: number): number {
  return Math.min(MAX_TIER, Math.floor(time / TIER_INTERVAL));
}
