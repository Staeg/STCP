import { afterEach, describe, expect, it } from 'vitest';
import { STRESS } from '../content/events';
import { neighbours } from '../dungeon/gen';
import { spawnGroup } from './combat';
import { groupSizeRange } from './mind';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, knowsCorridor, step, type World } from './world';

function run(world: World, seconds: number, dt = 0.1) {
  for (let t = 0; t < seconds; t += dt) step(world, dt);
}

const saved = { ...STRESS };
afterEach(() => void Object.assign(STRESS, saved));

/** A quiet dungeon with one hero at the exit, and the exit's neighbours. */
function setup(cls: 'warden' | 'zealot' = 'warden') {
  const world = createWorld(7, { monsters: false, loot: false, escalates: false, events: false });
  const h = addHero(world, { id: 'h', name: 'H', cls });
  const exit = world.dungeon.exit;
  const next = neighbours(world.dungeon, exit);
  return { world, h, exit, next };
}

describe('Forgetting', () => {
  it('paths that drop out of sight are forgotten at Stress %, and so is a room with no known way in', () => {
    const { world, h, exit, next } = setup('zealot'); // forgets like anyone, but never has a heart attack
    STRESS.basePerSec = 0;
    const [a, b] = next;
    const d = world.dungeon;
    const exitToB = d.corridors.find((c) => (c.a === exit && c.b === b) || (c.b === exit && c.a === b))!;
    expect(h.seen).toContain(b);
    h.stress = 100;
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

  it('a calm hero forgets nothing', () => {
    const { world, h, next } = setup();
    STRESS.basePerSec = 0;
    h.light = 10;
    applyIntent(world, 'h', { type: 'goto', room: next[0] });
    run(world, 12);
    expect(h.forgotten).toEqual([]);
  });
});

describe('Insanity', () => {
  it('an Insane hero sees phantoms in rooms they discover, until they walk in', () => {
    const { world, h, next } = setup();
    STRESS.phantomPerStress = 1;
    h.insane = true;
    h.stress = 60;
    const a = next[0];
    applyIntent(world, 'h', { type: 'goto', room: a });
    run(world, 12);
    const fresh = neighbours(world.dungeon, a).filter((n) => h.phantoms[n]);
    expect(fresh.length).toBeGreaterThan(0);
    const ghostRoom = fresh[0];
    expect(h.knownThreat[ghostRoom]).toBeGreaterThan(0);
    expect(buildView(world, 'h').rooms.find((r) => r.id === ghostRoom)?.threat).toBeGreaterThan(0);
    applyIntent(world, 'h', { type: 'goto', room: ghostRoom });
    run(world, 12);
    expect(h.encounter).toBeNull();
    expect(h.phantoms[ghostRoom]).toBeUndefined();
    expect(h.knownThreat[ghostRoom]).toBe(0);
  });

  it('misjudges a group as the far end of what could be there', () => {
    const { world, h, next } = setup();
    STRESS.misjudgePerStress = 1;
    h.stress = 60;
    h.insane = true;
    const [lo, hi] = groupSizeRange(world);
    expect([lo, hi]).toEqual([1, 3]);
    spawnGroup(world, next[0], ['ghoul'], 0);
    run(world, 0.2);
    expect(h.knownThreat[next[0]]).toBe(3);
    expect(h.knownContents[next[0]].monsters).toHaveLength(3);
    // A sane hero sees it as it is.
    h.insane = false;
    h.stress = 40;
    run(world, 0.2);
    expect(h.knownThreat[next[0]]).toBe(1);
  });
});
