/** Global timing and tuning constants. All times in seconds. */
export const ESCALATION_INTERVAL = 120;
export const MAX_ESCALATION = 6;
/** Waves start pouring toward the exit (Escalation 5). The exit itself is open from the start (user, 2026-10-12). */
export const WAVES_AT = 600;
export const COLLAPSE_AT = 780;

export const SERVER_TICK = 0.1;

export const LIGHT_MAX = 100;
/** Per second. A full torch lasts ~8 minutes; plan expects 1–2 refills per run. */
export const LIGHT_DRAIN = 0.2;
/** Below this, you are Dim: neighbouring rooms are not revealed. */
export const LIGHT_DIM = 25;
/** Above this, you are Bright: you forget nothing (user, 2026-10-14). Below it, 1% chance per point of light lost. */
export const LIGHT_BRIGHT = 75;

/** Light stages (user, 2026-10-14): Bright above 75, Lit, Dim below 25, Dark at 0. */
export type LightStage = 'bright' | 'lit' | 'dim' | 'dark';

export function lightStage(light: number): LightStage {
  if (light > LIGHT_BRIGHT) return 'bright';
  if (light <= 0) return 'dark';
  return light < LIGHT_DIM ? 'dim' : 'lit';
}

/** Forgetting (user, 2026-10-14): the chance a path that drops out of sight is forgotten, from 0 (Bright) to 0.75 (Dark). */
export function forgetChance(light: number): number {
  return Math.max(0, Math.min(LIGHT_BRIGHT, LIGHT_BRIGHT - light)) / 100;
}

/** Speed (seconds per turn / per tunnel) of an ordinary hero or monster. */
export const DEFAULT_SPEED = 5;
/** Nothing gets faster than this, whatever it carries or drinks. */
export const MIN_SPEED = 2;

export function escalationAt(time: number): number {
  return Math.min(MAX_ESCALATION, Math.floor(time / ESCALATION_INTERVAL));
}
