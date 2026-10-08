import type { Hero, World } from './world';

/** Queue a short notice for one player ("+12 gold", "Agree on the loot first"). */
export function notify(world: World, h: Hero, text: string) {
  h.messages.push({ time: world.time, text });
  if (h.messages.length > 12) h.messages.shift();
}
