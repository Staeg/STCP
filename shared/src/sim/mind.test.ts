import { describe, expect, it } from 'vitest';
import { forgetChance, lightStage } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, knowsCorridor, step, type World } from './world';

function run(world: World, seconds: number, dt = 0.1) {
  for (let t = 0; t < seconds; t += dt) step(world, dt);
}

/** A quiet dungeon with one hero at the exit, and the exit's neighbours. Every Forgetting roll that's made comes up. */
function setup(cls: 'warden' | 'zealot' = 'warden') {
  const world = createWorld(7, { monsters: false, loot: false, escalates: false, events: false });
  const h = addHero(world, { id: 'h', name: 'H', cls });
  world.mindRng.chance = () => true;
  const exit = world.dungeon.exit;
  const next = neighbours(world.dungeon, exit);
  return { world, h, exit, next };
}

describe('Light stages', () => {
  it('Bright above 75, Dim under 25, Dark at 0; Forgetting is 1% per point below 75', () => {
    expect(lightStage(100)).toBe('bright');
    expect(lightStage(76)).toBe('bright');
    expect(lightStage(75)).toBe('lit');
    expect(lightStage(25)).toBe('lit');
    expect(lightStage(24)).toBe('dim');
    expect(lightStage(0)).toBe('dark');
    expect(forgetChance(100)).toBe(0);
    expect(forgetChance(75)).toBe(0);
    expect(forgetChance(50)).toBeCloseTo(0.25);
    expect(forgetChance(0)).toBeCloseTo(0.75);
  });
});

describe('Forgetting', () => {
  it('paths that drop out of sight may be forgotten in the dark, and so is a room with no known way in', () => {
    const { world, h, exit, next } = setup();
    const [a, b] = next;
    const d = world.dungeon;
    const exitToB = d.corridors.find((c) => (c.a === exit && c.b === b) || (c.b === exit && c.a === b))!;
    expect(h.seen).toContain(b);
    h.light = 10; // Dim: only your own room's paths are in sight
    run(world, 0.2);
    applyIntent(world, 'h', { type: 'goto', room: a });
    run(world, 12);
    expect(h.pos).toEqual({ kind: 'room', room: a });
    expect(knowsCorridor(h, exitToB)).toBe(false);
    expect(h.forgotten).toContain(exitToB.id);
    // B was only glimpsed, and its only known path is gone: it's off the map.
    expect(h.seen).not.toContain(b);
    expect(buildView(world, 'h').rooms.some((r) => r.id === b)).toBe(false);
    // The exit itself is never forgotten.
    expect(h.seen).toContain(exit);
    // Standing at the exit again brings its paths back.
    applyIntent(world, 'h', { type: 'goto', room: exit });
    run(world, 12);
    expect(knowsCorridor(h, exitToB)).toBe(true);
  });

  it('a Bright hero forgets nothing', () => {
    const { world, h, next } = setup();
    h.light = 100;
    // Two rooms out, so paths drop out of sight on the way.
    const a = next[0];
    const beyond = neighbours(world.dungeon, a).find((n) => n !== world.dungeon.exit)!;
    applyIntent(world, 'h', { type: 'goto', room: a });
    run(world, 12);
    applyIntent(world, 'h', { type: 'goto', room: beyond });
    run(world, 12);
    expect(h.light).toBeGreaterThan(75);
    expect(h.forgotten).toEqual([]);
  });
});
