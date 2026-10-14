import { forgetChance, LIGHT_DIM } from '../content/constants';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { seesInDark } from './loot';
import { knowsCorridor, type Hero, type World } from './world';

/**
 * Forgetting (user, 2026-10-11; driven by light since 2026-10-14, when Stress and Insanity went): rules in
 * content/events.ts. Rolls use `world.mindRng`, so they don't shift the dice the rest of the run rolls.
 */

/** Rooms a hero can see into right now: their own, and (with light) the ones next door; in a tunnel, both ends. */
function roomsInSight(world: World, h: Hero): number[] {
  const pos = h.pos;
  if (pos.kind === 'corridor') return [pos.from, pos.to];
  if (h.light >= LIGHT_DIM || seesInDark(h)) return [pos.room, ...neighbours(world.dungeon, pos.room)];
  return [pos.room];
}

/** Every path touching a room in sight (and the tunnel you're in). */
export function pathsInSight(world: World, h: Hero): number[] {
  const out = new Set<number>();
  if (h.pos.kind === 'corridor') out.add(h.pos.corridor);
  for (const r of roomsInSight(world, h)) for (const c of world.dungeon.rooms[r].corridors) out.add(c);
  return [...out];
}

/**
 * Forgetting: each known path that has just dropped out of sight is forgotten with a chance of (75 − light)%, none
 * while Bright. Called every tick, after everyone has moved.
 */
export function tickForgetting(world: World) {
  const d = world.dungeon;
  for (const h of Object.values(world.heroes)) {
    if (h.dead || h.extracted) continue;
    const now = pathsInSight(world, h);
    // Cat's-Eye: nothing slips the wearer's mind.
    const chance = seesInDark(h) ? 0 : forgetChance(h.light);
    const lost: number[] = [];
    for (const cid of h.inSight) {
      if (now.includes(cid)) continue;
      const c = d.corridors[cid];
      if (chance > 0 && knowsCorridor(h, c) && !h.elite.cant && world.mindRng.chance(chance)) lost.push(cid);
    }
    h.inSight = now;
    if (!lost.length) continue;
    for (const cid of lost) h.forgotten.push(cid);
    world.stats.forgotten += lost.length;
    // A room with no known way in is gone from the map too (the exit is never forgotten: everyone knows where it is).
    const touched = new Set(lost.flatMap((cid) => [d.corridors[cid].a, d.corridors[cid].b]));
    for (const r of touched) {
      if (r === d.exit || !(h.explored.includes(r) || h.seen.includes(r))) continue;
      if (d.rooms[r].corridors.some((cid) => knowsCorridor(h, d.corridors[cid]))) continue;
      forgetRoom(h, r);
    }
    // A walk planned down a path you've forgotten stops where your memory does.
    let from = h.pos.kind === 'room' ? h.pos.room : h.pos.to;
    for (let i = 0; i < h.path.length; i++) {
      const c = corridorBetween(d, from, h.path[i]);
      if (!c || h.forgotten.includes(c.id)) {
        h.path = h.path.slice(0, i);
        if (!h.path.length) h.heading = null;
        break;
      }
      from = h.path[i];
    }
  }
}

function forgetRoom(h: Hero, room: number) {
  h.explored = h.explored.filter((r) => r !== room);
  h.seen = h.seen.filter((r) => r !== room);
  delete h.knownThreat[room];
  delete h.knownLoot[room];
  delete h.knownEvents[room];
  delete h.knownContents[room];
  delete h.knownChalk[room];
}

/** Standing in a room (or at the mouth of a tunnel) brings back what you'd forgotten of its paths. */
export function relearnPaths(world: World, h: Hero, room: number) {
  const here = world.dungeon.rooms[room].corridors;
  if (h.forgotten.some((c) => here.includes(c))) h.forgotten = h.forgotten.filter((c) => !here.includes(c));
}
