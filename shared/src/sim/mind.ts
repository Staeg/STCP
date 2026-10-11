import { crUnitChance, ENCOUNTER_GROUPS, ROSTER_RULES, TIERS, type EnemyId } from '../content/enemies';
import { LIGHT_DIM } from '../content/constants';
import { INSANITY, STRESS } from '../content/events';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { seesInDark } from './loot';
import { notify } from './notify';
import { chronicle, knowsCorridor, type Hero, type World } from './world';

/**
 * The mind under strain (user, 2026-10-11): Forgetting and Insanity (rules in content/events.ts).
 * Rolls use `world.mindRng`, so they don't shift the dice the rest of the run rolls.
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
 * Forgetting: each known path that has just dropped out of sight is forgotten with a chance of Stress %. Called every
 * tick, after everyone has moved.
 */
export function tickForgetting(world: World) {
  const d = world.dungeon;
  for (const h of Object.values(world.heroes)) {
    if (h.dead || h.extracted) continue;
    const now = pathsInSight(world, h);
    const chance = Math.min(1, h.stress / 100);
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
  delete h.phantoms[room];
  delete h.misjudged[room];
}

/** Standing in a room (or at the mouth of a tunnel) brings back what you'd forgotten of its paths. */
export function relearnPaths(world: World, h: Hero, room: number) {
  const here = world.dungeon.rooms[room].corridors;
  if (h.forgotten.some((c) => here.includes(c))) h.forgotten = h.forgotten.filter((c) => !here.includes(c));
}

/** Stress has reached the line: the hero goes Insane for the rest of the run. Never the Zealot. */
export function goInsane(world: World, h: Hero, cause: string) {
  if (h.insane || h.cls === 'zealot') return;
  h.insane = true;
  world.stats.insanity++;
  chronicle(world, `${h.name} went Insane (${cause}).`);
  notify(world, h, `You have gone INSANE: ${INSANITY.desc}`);
}

/** Hallucinations: an Insane hero who discovers a room may see monsters in it that aren't there. */
export function hallucinate(world: World, h: Hero, room: number) {
  if (!h.insane || room === world.dungeon.exit) return;
  if (!world.mindRng.chance(Math.min(1, STRESS.phantomPerStress * h.stress))) return;
  const rng = world.mindRng;
  const groups = ENCOUNTER_GROUPS.filter((g) => (g.minEscalation ?? 0) <= world.escalation && g.tiers.every((t) => ROSTER_RULES.escalation[t] <= world.escalation));
  const total = groups.reduce((s, g) => s + g.weight, 0);
  let roll = rng.float(0, total);
  const g = groups.find((x) => (roll -= x.weight) <= 0) ?? groups[0];
  const units = g.tiers.map((t) => world.roster.main[t]).filter((opts) => opts.length).map((opts) => rng.pick(opts));
  if (units.length) h.phantoms[room] = units;
}

/** How many monsters an ordinary group could have right now: [fewest, most], at the current Escalation and CR. */
export function groupSizeRange(world: World): [number, number] {
  const esc = world.escalation;
  const sizes = ENCOUNTER_GROUPS.filter((g) => (g.minEscalation ?? 0) <= esc && g.tiers.every((t) => ROSTER_RULES.escalation[t] <= esc))
    .map((g) => g.tiers.length);
  const extra = (esc >= 4 ? 1 : 0) + TIERS.filter((t) => world.roster.cr[t] && crUnitChance(t, world.cr) > 0).length;
  return [Math.min(...sizes), Math.max(...sizes) + extra];
}

/**
 * What a hero makes of the monsters in a room they're looking into (not standing in). Insane: a phantom group in an
 * empty room, or a misjudged number, flipped to the far end of what could be there (3 of 3–5 looks like 5).
 * The judgement holds until the real number changes, so it doesn't flicker.
 */
export function perceive(world: World, h: Hero, room: number, real: EnemyId[]): EnemyId[] {
  if (!h.insane) return real;
  if (!real.length) {
    delete h.misjudged[room];
    return h.phantoms[room] ?? real;
  }
  delete h.phantoms[room];
  let m = h.misjudged[room];
  if (!m || m.real !== real.length) {
    let seen = real.length;
    if (world.mindRng.chance(Math.min(1, STRESS.misjudgePerStress * h.stress))) {
      const [lo, hi] = groupSizeRange(world);
      seen = Math.max(lo, Math.min(hi, lo + hi - real.length));
    }
    m = h.misjudged[room] = { real: real.length, seen };
  }
  if (m.seen <= real.length) return real.slice(0, m.seen);
  return Array.from({ length: m.seen }, (_, i) => real[i % real.length]);
}

/** You're in the room: you see it as it is. */
export function seeTruly(h: Hero, room: number) {
  delete h.phantoms[room];
  delete h.misjudged[room];
}
