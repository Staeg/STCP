import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT, EXIT_OPENS_AT, TIER_INTERVAL } from '../content/constants';
import { corridorBetween, hopDistances, neighbours } from '../dungeon/gen';
import { collapseCorridor } from './escalation';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Teleport a hero to a room (tests only). */
function place(world: World, id: string, room: number) {
  world.heroes[id].pos = { kind: 'room', room };
}

describe('escalation', () => {
  it('raises the tier every two minutes and writes it into the chronicle', () => {
    const world = createWorld(9, { monsters: false, loot: false });
    addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    run(world, TIER_INTERVAL * 2 + 1);
    expect(world.tier).toBe(2);
    expect(world.chronicle.filter((c) => c.text.startsWith('Tier')).length).toBe(2);
  });

  it('respawns and sends packs as time goes on', () => {
    const world = createWorld(9, { monsters: false, loot: false });
    addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    run(world, TIER_INTERVAL * 3);
    expect(Object.keys(world.monsters).length).toBeGreaterThan(0);
    expect(Object.keys(world.packs).length).toBeGreaterThan(0);
  });

  it('tunnels collapse from tier 3, and rubble can be dug through', () => {
    const world = createWorld(9, { monsters: false, loot: false });
    const h = addHero(world, { id: 'a', name: 'A', cls: 'hexer' });
    const d = world.dungeon;
    run(world, TIER_INTERVAL * 3 + 50);
    expect(world.collapsed.length).toBeGreaterThan(0);
    // Collapse the corridor next to the hero and dig it out.
    world.escalation = false;
    const next = neighbours(d, d.entrance)[0];
    const c = corridorBetween(d, d.entrance, next)!;
    if (!world.collapsed.includes(c.id)) collapseCorridor(world, c.id);
    place(world, 'a', d.entrance);
    h.encounter = null;
    step(world, 0.1);
    expect(h.knownCollapsed).toContain(c.id);
    applyIntent(world, 'a', { type: 'dig', corridor: c.id });
    expect(h.channel?.kind).toBe('dig');
    run(world, 14);
    expect(world.collapsed).toContain(c.id);
    run(world, 1.2);
    expect(world.collapsed).not.toContain(c.id);
    expect(h.knownCollapsed).not.toContain(c.id);
    expect(world.chronicle.at(-1)?.text).toMatch(/dug through/);
  });

  it('a hero caught in a collapsing tunnel is thrown out and hurt', () => {
    const world = createWorld(9, { monsters: false, loot: false, escalation: false });
    const h = addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    const d = world.dungeon;
    const next = neighbours(d, d.entrance)[0];
    applyIntent(world, 'a', { type: 'goto', room: next });
    run(world, 1);
    const c = corridorBetween(d, d.entrance, next)!;
    const hp = h.hp;
    collapseCorridor(world, c.id);
    expect(h.pos).toEqual({ kind: 'room', room: d.entrance });
    expect(h.hp).toBe(hp - 4);
    expect(h.knownCollapsed).toContain(c.id);
  });

  it("you only learn of a collapse when you reach it, and can't walk through", () => {
    const world = createWorld(9, { monsters: false, loot: false, escalation: false });
    const h = addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    const d = world.dungeon;
    const a = neighbours(d, d.entrance)[0];
    applyIntent(world, 'a', { type: 'goto', room: a });
    run(world, 9);
    applyIntent(world, 'a', { type: 'goto', room: d.entrance });
    run(world, 9);
    // Collapse the corridor while we're away from both ends? We're at the entrance (an end), so pick another.
    const far = neighbours(d, a).find((n) => n !== d.entrance)!;
    const c = corridorBetween(d, a, far)!;
    collapseCorridor(world, c.id);
    expect(h.knownCollapsed).not.toContain(c.id);
    expect(buildView(world, 'a').corridors.find((x) => x.id === c.id)?.collapsed).toBeUndefined();
    applyIntent(world, 'a', { type: 'goto', room: far });
    run(world, 20);
    expect(h.pos).toEqual({ kind: 'room', room: a }); // stopped at the rubble
    expect(h.knownCollapsed).toContain(c.id);
    expect(h.messages.at(-1)?.text).toMatch(/Rubble/);
  });

  it('waves spawn next to the exit after it opens and head for it', () => {
    const world = createWorld(9, { monsters: false, loot: false });
    addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    world.time = EXIT_OPENS_AT - 1;
    world.tier = 5;
    run(world, 2);
    const waves = Object.values(world.packs).filter((p) => p.goal === world.dungeon.exit);
    expect(waves.length).toBe(1);
    expect(neighbours(world.dungeon, world.dungeon.exit)).toContain(waves[0].room);
  });
});

describe('extraction and the end', () => {
  function atExit(n: number) {
    const world = createWorld(9, { monsters: false, loot: false, escalation: false });
    for (let i = 0; i < n; i++) addHero(world, { id: `h${i}`, name: `H${i}`, cls: 'warden' });
    for (let i = 0; i < n; i++) place(world, `h${i}`, world.dungeon.exit);
    return world;
  }

  it("can't extract before the exit opens; can after; the game ends when nobody's left", () => {
    const world = atExit(2);
    world.heroes.h0.gold = 40;
    applyIntent(world, 'h0', { type: 'extract' });
    expect(world.heroes.h0.extracted).toBe(false);
    world.time = EXIT_OPENS_AT;
    applyIntent(world, 'h0', { type: 'extract' });
    expect(world.heroes.h0.extracted).toBe(true);
    expect(world.heroes.h0.fate).toBe('escaped with 40 gold');
    // h1 saw it happen.
    expect(buildView(world, 'h1').allies.find((a) => a.id === 'h0')?.extracted).toBe(true);
    step(world, 0.1);
    expect(world.phase).toBe('running');
    applyIntent(world, 'h1', { type: 'extract' });
    step(world, 0.1);
    expect(world.phase).toBe('ended');
    expect(buildView(world, 'h1').results?.heroes.every((h) => h.outcome === 'escaped')).toBe(true);
  });

  it('extracted heroes are not seen by anyone who missed it', () => {
    const world = atExit(1);
    const far = addHero(world, { id: 'far', name: 'Far', cls: 'hexer' }); // at the entrance
    expect(far.pos.kind).toBe('room');
    world.time = EXIT_OPENS_AT;
    applyIntent(world, 'h0', { type: 'extract' });
    step(world, 0.1);
    const ally = buildView(world, 'far').allies.find((a) => a.id === 'h0');
    expect(ally?.extracted ?? false).toBe(false);
  });

  it('the collapse buries everyone still inside', () => {
    const world = atExit(1);
    const lost = addHero(world, { id: 'lost', name: 'Lost', cls: 'hexer' });
    world.time = EXIT_OPENS_AT;
    applyIntent(world, 'h0', { type: 'extract' });
    run(world, COLLAPSE_AT - EXIT_OPENS_AT + 1);
    expect(world.phase).toBe('collapsed');
    expect(lost.dead).toBe(true);
    expect(lost.fate).toMatch(/buried/);
    const res = buildView(world, 'lost').results!;
    expect(res.heroes.find((h) => h.id === 'h0')?.outcome).toBe('escaped');
    expect(res.chronicle.some((c) => c.text.includes('collapsed on Lost'))).toBe(true);
  });

  it('exit distance stays sane on the bigger maps', () => {
    const world = createWorld(77, { monsters: false });
    const d = world.dungeon;
    expect(hopDistances(d, d.entrance)[d.exit]).toBeGreaterThanOrEqual(6);
  });
});
