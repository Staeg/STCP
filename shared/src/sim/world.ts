import { CLASSES, type ClassId } from '../content/classes';
import { COLLAPSE_AT, LIGHT_DIM, LIGHT_DRAIN, LIGHT_MAX } from '../content/constants';
import { corridorBetween, generateDungeon, neighbours, otherEnd, type Dungeon } from '../dungeon/gen';

export type HeroPos =
  | { kind: 'room'; room: number }
  /** `t` = seconds walked from `from` toward `to`. */
  | { kind: 'corridor'; corridor: number; from: number; to: number; t: number };

export interface Hero {
  id: string;
  name: string;
  cls: ClassId;
  color: string;
  pos: HeroPos;
  /** Rooms still to visit after the current target. */
  path: number[];
  light: number;
  /** Rooms this hero has stood in. */
  explored: number[];
  /** Rooms this hero knows the name and kind of (explored + glimpsed neighbours + the exit). */
  seen: number[];
}

export type WorldPhase = 'running' | 'collapsed';

export interface World {
  seed: number;
  time: number;
  dungeon: Dungeon;
  heroes: Record<string, Hero>;
  phase: WorldPhase;
}

export type Intent =
  | { type: 'goto'; room: number }
  | { type: 'turnBack' }
  | { type: 'stop' };

export function createWorld(seed: number): World {
  return { seed, time: 0, dungeon: generateDungeon(seed), heroes: {}, phase: 'running' };
}

export function addHero(world: World, opts: { id: string; name: string; cls: ClassId }): Hero {
  const d = world.dungeon;
  const hero: Hero = {
    ...opts,
    color: CLASSES[opts.cls].color,
    pos: { kind: 'room', room: d.entrance },
    path: [],
    light: LIGHT_MAX,
    explored: [],
    seen: [d.exit],
  };
  world.heroes[hero.id] = hero;
  explore(world, hero, d.entrance);
  return hero;
}

export function step(world: World, dt: number): void {
  if (world.phase !== 'running') return;
  world.time += dt;
  for (const hero of Object.values(world.heroes)) {
    hero.light = Math.max(0, hero.light - LIGHT_DRAIN * dt);
    advance(world, hero, dt);
  }
  if (world.time >= COLLAPSE_AT) world.phase = 'collapsed';
}

export function applyIntent(world: World, heroId: string, intent: Intent): void {
  const hero = world.heroes[heroId];
  if (!hero || world.phase !== 'running') return;
  switch (intent.type) {
    case 'stop':
      hero.path = [];
      return;
    case 'turnBack':
      if (hero.pos.kind === 'corridor') turnAround(world, hero);
      hero.path = [];
      return;
    case 'goto':
      goto(world, hero, intent.room);
      return;
  }
}

// ---------------------------------------------------------------------------

function advance(world: World, hero: Hero, dt: number) {
  const d = world.dungeon;
  let remaining = dt;
  // Bounded loop: each iteration either consumes time or enters a corridor.
  for (let guard = 0; guard < 16 && remaining > 1e-9; guard++) {
    const pos = hero.pos;
    if (pos.kind === 'room') {
      const next = hero.path.shift();
      if (next === undefined) return;
      const c = corridorBetween(d, pos.room, next);
      if (!c) {
        hero.path = [];
        return;
      }
      hero.pos = { kind: 'corridor', corridor: c.id, from: pos.room, to: next, t: 0 };
    } else {
      const need = d.corridors[pos.corridor].length - pos.t;
      if (remaining < need) {
        pos.t += remaining;
        return;
      }
      remaining -= need;
      hero.pos = { kind: 'room', room: pos.to };
      explore(world, hero, pos.to);
    }
  }
}

function turnAround(world: World, hero: Hero) {
  const pos = hero.pos;
  if (pos.kind !== 'corridor') return;
  const len = world.dungeon.corridors[pos.corridor].length;
  hero.pos = { kind: 'corridor', corridor: pos.corridor, from: pos.to, to: pos.from, t: len - pos.t };
}

function explore(world: World, hero: Hero, room: number) {
  addUnique(hero.explored, room);
  addUnique(hero.seen, room);
  if (hero.light >= LIGHT_DIM) {
    for (const n of neighbours(world.dungeon, room)) addUnique(hero.seen, n);
  }
}

function addUnique(arr: number[], v: number) {
  if (!arr.includes(v)) arr.push(v);
}

/** A corridor is known to a hero once they have explored either end. */
export function knowsCorridor(hero: Hero, c: { a: number; b: number }): boolean {
  return hero.explored.includes(c.a) || hero.explored.includes(c.b);
}

function goto(world: World, hero: Hero, target: number) {
  const d = world.dungeon;
  if (!d.rooms[target]) return;
  const pos = hero.pos;
  if (pos.kind === 'room') {
    hero.path = shortestPath(world, hero, pos.room, target) ?? hero.path;
    return;
  }
  // In a corridor: compare continuing forward vs turning back.
  const len = d.corridors[pos.corridor].length;
  const fwd = shortestPath(world, hero, pos.to, target);
  const back = shortestPath(world, hero, pos.from, target);
  const fwdCost = fwd ? len - pos.t + pathCost(d, pos.to, fwd) : Infinity;
  const backCost = back ? pos.t + pathCost(d, pos.from, back) : Infinity;
  if (fwdCost === Infinity && backCost === Infinity) return;
  if (backCost < fwdCost) {
    turnAround(world, hero);
    hero.path = back!;
  } else {
    hero.path = fwd!;
  }
}

function pathCost(d: Dungeon, start: number, path: number[]): number {
  let cost = 0;
  let cur = start;
  for (const next of path) {
    cost += corridorBetween(d, cur, next)!.length;
    cur = next;
  }
  return cost;
}

/**
 * Dijkstra over corridors the hero knows. Returns rooms to visit after `start`
 * (empty if start === target), or null if unreachable.
 */
export function shortestPath(world: World, hero: Hero, start: number, target: number): number[] | null {
  const d = world.dungeon;
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  while (true) {
    let cur = -1;
    let best = Infinity;
    for (const [room, cost] of dist) {
      if (!done.has(room) && cost < best) {
        best = cost;
        cur = room;
      }
    }
    if (cur === -1) return null;
    if (cur === target) break;
    done.add(cur);
    for (const cid of d.rooms[cur].corridors) {
      const c = d.corridors[cid];
      if (!knowsCorridor(hero, c)) continue;
      const n = otherEnd(c, cur);
      const nd = best + c.length;
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd);
        prev.set(n, cur);
      }
    }
  }
  const path: number[] = [];
  for (let cur = target; cur !== start; cur = prev.get(cur)!) path.unshift(cur);
  return path;
}

/** World-space position of a hero, for rendering and distance checks. */
export function heroXY(d: Dungeon, pos: HeroPos): { x: number; y: number } {
  if (pos.kind === 'room') return { x: d.rooms[pos.room].x, y: d.rooms[pos.room].y };
  const a = d.rooms[pos.from];
  const b = d.rooms[pos.to];
  const f = pos.t / d.corridors[pos.corridor].length;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
