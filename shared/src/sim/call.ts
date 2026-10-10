import { theRoom } from '../dungeon/gen';
import { inDungeon, monstersIn, spawnGroup } from './combat';
import { groupFor, makePack } from './escalation';
import { notify } from './notify';
import { chronicle, type Hero, type World } from './world';

/**
 * Call for Help (C, user 2026-10-10): once per run, even while Downed, a hero cries out. Each other hero hears it
 * with chance 1 − falloff × (tunnels between you), and learns where it came from. The price: a group fit for the
 * current Escalation appears in an empty room up to `spawnWithin` tunnels away and makes straight for the call,
 * where it stays until killed.
 */
export const CALL_RULES = {
  falloff: 0.1,
  spawnWithin: 3,
  /** Heard calls stay on the map (and in bots' minds) this long, in seconds. */
  shown: 60,
};

export interface Call {
  by: string;
  room: number;
  time: number;
  /** Heroes who heard it (the caller always knows). */
  heard: string[];
}

/** Tunnels between `from` and every room reachable from it (collapsed ones too, unless `open`). */
export function hopsFrom(world: World, from: number, open = false): Map<number, number> {
  const d = world.dungeon;
  const hops = new Map([[from, 0]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const cid of d.rooms[cur].corridors) {
      if (open && world.collapsed.includes(cid)) continue;
      const c = d.corridors[cid];
      const n = c.a === cur ? c.b : c.a;
      if (!hops.has(n)) (hops.set(n, hops.get(cur)! + 1), q.push(n));
    }
  }
  return hops;
}

/** Returns an error message, or null if this hero may call for help now. */
export function callError(h: Hero): string | null {
  if (!inDungeon(h)) return 'You are out of the dungeon.';
  if (h.called) return 'You have already called for help this run.';
  if (h.pos.kind !== 'room') return 'Not while walking a tunnel.';
  return null;
}

/** Cry out. Instant, and costs no turn: the price is what else hears it. */
export function callForHelp(world: World, h: Hero): string | null {
  const err = callError(h);
  if (err || h.pos.kind !== 'room') return err;
  h.called = true;
  const room = h.pos.room;
  const where = theRoom(world.dungeon.rooms[room].name);
  // Sound carries through the rock, rubble or not.
  const hops = hopsFrom(world, room);
  const call: Call = { by: h.id, room, time: world.time, heard: [] };
  for (const o of Object.values(world.heroes)) {
    if (o === h || !inDungeon(o)) continue;
    const x = hops.get(o.pos.kind === 'room' ? o.pos.room : o.pos.to);
    if (x === undefined || !world.rng.chance(1 - CALL_RULES.falloff * x)) continue;
    call.heard.push(o.id);
    if (!o.seen.includes(room)) o.seen.push(room);
    o.lastKnown[h.id] = {
      pos: { ...h.pos }, heading: null, time: world.time, hp: h.hp, maxHp: h.maxHp, downed: h.downedAt !== null, dead: false, affliction: h.affliction,
    };
    notify(world, o, `${h.name} calls for help from ${where}!`);
  }
  world.calls.push(call);
  chronicle(world, `${h.name} called for help from ${where}${call.heard.length ? '' : ', and nobody heard'}.`);
  notify(world, h, 'You call for help. Something else heard it too.');
  summon(world, room);
  return null;
}

/** The price of a call: a fresh group in an empty room nearby, coming for the caller's room. */
function summon(world: World, goal: number) {
  const d = world.dungeon;
  const near = hopsFrom(world, goal, true);
  const occupied = (r: number) => Object.values(world.heroes).some((o) => inDungeon(o) && o.pos.kind === 'room' && o.pos.room === r);
  const candidates = [...near]
    .filter(([r, n]) => n >= 1 && n <= CALL_RULES.spawnWithin && d.rooms[r].kind === 'normal')
    .map(([r]) => r)
    .filter((r) => !occupied(r) && !world.encounters[r] && monstersIn(world, r).length === 0);
  if (!candidates.length) return;
  const from = world.rng.pick(candidates);
  const pack = makePack(world, spawnGroup(world, from, groupFor(world, world.escalation, from), world.escalation), from, goal);
  pack.restUntil = world.time + 2;
  chronicle(world, `Monsters in ${theRoom(d.rooms[from].name)} answered the call instead.`);
}
