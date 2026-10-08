import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT, LIGHT_DIM, LIGHT_DRAIN, LIGHT_MAX } from '../content/constants';
import { corridorBetween, neighbours } from '../dungeon/gen';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number, dt = 0.1) {
  for (let i = 0; i < Math.round(seconds / dt); i++) step(world, dt);
}

function setup() {
  const world = createWorld(12345, { monsters: false });
  const hero = addHero(world, { id: 'h1', name: 'Mara', cls: 'warden' });
  return { world, hero, d: world.dungeon };
}

describe('world movement', () => {
  it('starts at the entrance knowing its neighbours and the exit', () => {
    const { hero, d } = setup();
    expect(hero.pos).toEqual({ kind: 'room', room: d.entrance });
    expect(hero.explored).toEqual([d.entrance]);
    for (const n of neighbours(d, d.entrance)) expect(hero.seen).toContain(n);
    expect(hero.seen).toContain(d.exit);
  });

  it('walks a corridor in exactly its length and explores the destination', () => {
    const { world, hero, d } = setup();
    const next = neighbours(d, d.entrance)[0];
    const len = corridorBetween(d, d.entrance, next)!.length;
    applyIntent(world, 'h1', { type: 'goto', room: next });
    run(world, len - 0.2);
    expect(hero.pos.kind).toBe('corridor');
    run(world, 0.3);
    expect(hero.pos).toEqual({ kind: 'room', room: next });
    expect(hero.explored).toContain(next);
  });

  it('turning back returns to the start in the time already walked', () => {
    const { world, hero, d } = setup();
    const next = neighbours(d, d.entrance)[0];
    applyIntent(world, 'h1', { type: 'goto', room: next });
    run(world, 2);
    applyIntent(world, 'h1', { type: 'turnBack' });
    run(world, 2.1);
    expect(hero.pos).toEqual({ kind: 'room', room: d.entrance });
    expect(hero.explored).not.toContain(next);
  });

  it('cannot path into unknown territory, but can reach the exit by exploring step by step', () => {
    const { world, hero, d } = setup();
    applyIntent(world, 'h1', { type: 'goto', room: d.exit });
    expect(hero.path).toEqual([]); // exit is seen but no known route yet

    // Walk greedily along the true shortest path, one known hop at a time.
    for (let guard = 0; guard < 20 && !(hero.pos.kind === 'room' && hero.pos.room === d.exit); guard++) {
      const cur = hero.pos.kind === 'room' ? hero.pos.room : -1;
      const next = trueNextHop(world, cur, d.exit);
      applyIntent(world, 'h1', { type: 'goto', room: next });
      run(world, 9);
    }
    expect(hero.pos).toEqual({ kind: 'room', room: d.exit });
  });

  it('paths through multiple explored rooms automatically', () => {
    const { world, hero, d } = setup();
    const a = neighbours(d, d.entrance)[0];
    applyIntent(world, 'h1', { type: 'goto', room: a });
    run(world, 9);
    applyIntent(world, 'h1', { type: 'goto', room: d.entrance });
    run(world, 9);
    // Now go back to `a`'s neighbour via a two-hop path.
    const b = neighbours(d, a).find((n) => n !== d.entrance)!;
    applyIntent(world, 'h1', { type: 'goto', room: b });
    expect(hero.path).toEqual([a, b]);
    run(world, 17);
    expect(hero.pos).toEqual({ kind: 'room', room: b });
  });

  it('drains light and collapses at the deadline', () => {
    const { world, hero } = setup();
    run(world, 10);
    expect(hero.light).toBeCloseTo(LIGHT_MAX - LIGHT_DRAIN * 10, 5);
    run(world, COLLAPSE_AT);
    expect(world.phase).toBe('collapsed');
    expect(hero.light).toBe(0);
  });

  it('does not glimpse neighbours when dim', () => {
    const { world, hero, d } = setup();
    hero.light = LIGHT_DIM - 1;
    const a = neighbours(d, d.entrance)[0];
    applyIntent(world, 'h1', { type: 'goto', room: a });
    run(world, 9);
    const unseen = neighbours(d, a).filter((n) => !hero.explored.includes(n) && n !== d.exit);
    for (const n of unseen) {
      if (!neighbours(d, d.entrance).includes(n)) expect(hero.seen).not.toContain(n);
    }
  });
});

describe('buildView (fog)', () => {
  it('only reveals known rooms and corridors', () => {
    const { world, d } = setup();
    const view = buildView(world, 'h1');
    const known = new Set(view.rooms.map((r) => r.id));
    expect(known.size).toBeLessThan(d.rooms.length);
    for (const c of view.corridors) expect(c.a === d.entrance || c.b === d.entrance).toBe(true);
    const exit = view.rooms.find((r) => r.id === d.exit)!;
    expect(exit.knowledge).toBe('seen');
    expect(exit.corridors).toEqual([]); // don't leak the exit's connections
  });

  it('is a copy, not a live reference', () => {
    const { world } = setup();
    const view = buildView(world, 'h1');
    view.you.light = -5;
    expect(world.heroes.h1.light).not.toBe(-5);
  });
});

function trueNextHop(world: World, from: number, to: number): number {
  const d = world.dungeon;
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const n of neighbours(d, cur)) if (!prev.has(n)) (prev.set(n, cur), q.push(n));
  }
  let cur = to;
  while (prev.get(cur) !== from) cur = prev.get(cur)!;
  return cur;
}
