import type { Hero, World } from './world';

/** A sound the client plays with a notice: for things heard across the dungeon (bells, calls, the Dead King). */
export type SoundCue = 'toll' | 'call' | 'king';

/** Queue a short notice for one player ("+12 gold", "Agree on the loot first"), with a sound if it's a big one. */
export function notify(world: World, h: Hero, text: string, sound?: SoundCue) {
  h.messages.push({ time: world.time, text, ...(sound ? { sound } : {}) });
  if (h.messages.length > 12) h.messages.shift();
}
