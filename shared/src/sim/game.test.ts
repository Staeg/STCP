import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT } from '../content/constants';
import { corridorBetween, isCrossroads, neighbours } from '../dungeon/gen';
import { Game } from './game';
import { buildView } from './views';
import { addHero, applyIntent, canSee, createWorld, explore, step } from './world';

const fourBots = () => [
  { id: 'a', name: 'A', cls: 'warden' as const, isBot: true },
  { id: 'b', name: 'B', cls: 'cutthroat' as const, isBot: true },
  { id: 'c', name: 'C', cls: 'lampbearer' as const, isBot: true },
  { id: 'd', name: 'D', cls: 'sorceress' as const, isBot: true },
];

describe('bots', () => {
  it('explore, spread out, and gather at the rendezvous in an empty dungeon', { timeout: 30000 }, () => {
    let atExit = 0;
    let total = 0;
    let explored = 0;
    let divergent = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const game = new Game(seed, fourBots(), { monsters: false, escalates: false });
      let t = 0;
      for (; t < 90; t += 0.1) game.tick(0.1);
      const spots = new Set(Object.values(game.world.heroes).map((h) => JSON.stringify(h.pos.kind === 'room' ? h.pos.room : h.pos.corridor)));
      if (spots.size >= 3) divergent++;
      for (; t < COLLAPSE_AT - 1; t += 0.1) game.tick(0.1);
      const heroes = Object.values(game.world.heroes);
      for (const h of heroes) {
        total++;
        if (h.extracted || (h.pos.kind === 'room' && h.pos.room === game.world.dungeon.exit)) atExit++;
        explored += h.explored.length;
      }
    }
    expect(atExit / total).toBeGreaterThan(0.9);
    expect(explored / total).toBeGreaterThan(10);
    expect(divergent).toBeGreaterThanOrEqual(6); // bots split up early
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const g = new Game(42, fourBots());
      for (let i = 0; i < 1200; i++) g.tick(0.1);
      return JSON.stringify(Object.values(g.world.heroes).map((h) => [h.pos, h.explored]));
    };
    expect(run()).toBe(run());
  });
});

describe('sightings and chalk', () => {
  function twoHeroes() {
    const world = createWorld(12345, { monsters: false });
    addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    addHero(world, { id: 'b', name: 'B', cls: 'sorceress' });
    return world;
  }

  it('heroes in the same room see each other; ghosts persist after separation', () => {
    const world = twoHeroes();
    const d = world.dungeon;
    expect(canSee(world, world.heroes.a, world.heroes.b)).toBe(true);
    // Walk b two rooms away.
    const n1 = neighbours(d, d.entrance)[0];
    const n2 = neighbours(d, n1).find((n) => n !== d.entrance && !corridorBetween(d, n, d.entrance))!;
    applyIntent(world, 'b', { type: 'goto', room: n1 });
    for (let i = 0; i < 90; i++) step(world, 0.1);
    applyIntent(world, 'b', { type: 'goto', room: n2 });
    for (let i = 0; i < 90; i++) step(world, 0.1);
    expect(canSee(world, world.heroes.a, world.heroes.b)).toBe(false);
    const view = buildView(world, 'a');
    const ghost = view.allies.find((x) => x.id === 'b')!;
    expect(ghost.live).toBe(false);
    expect(ghost.seenAt).toBeLessThan(world.time);
    // a's view never reveals b's real room unless a saw it.
    expect(ghost.pos).not.toEqual({ kind: 'room', room: n2 });
  });

  it('records chalk at crossroads, readable only by visiting', () => {
    // Find a seed where the entrance is a crossroads.
    let world = twoHeroes();
    for (let seed = 1; !isCrossroads(world.dungeon, world.dungeon.entrance); seed++) {
      world = createWorld(seed, { monsters: false });
      addHero(world, { id: 'a', name: 'A', cls: 'warden' });
      addHero(world, { id: 'b', name: 'B', cls: 'sorceress' });
    }
    const d = world.dungeon;
    const target = neighbours(d, d.entrance)[0];
    applyIntent(world, 'b', { type: 'goto', room: target });
    step(world, 0.1);
    const c = corridorBetween(d, d.entrance, target)!;
    expect(world.chalk[d.entrance].b).toBe(c.id);
    // a is still at the entrance, so a reads it.
    expect(world.heroes.a.knownChalk[d.entrance].b).toBe(c.id);
    expect(buildView(world, 'a').chalk[0].marks).toContainEqual({ heroId: 'b', corridor: c.id });
  });

  it('records chalk in two-exit rooms too', () => {
    const world = twoHeroes();
    const d = world.dungeon;
    const room = d.rooms.find((r) => r.corridors.length === 2 && r.id !== d.entrance)!;
    for (const h of Object.values(world.heroes)) {
      h.pos = { kind: 'room', room: room.id };
      explore(world, h, room.id);
    }
    const target = neighbours(d, room.id)[0];
    applyIntent(world, 'b', { type: 'goto', room: target, step: true });
    step(world, 0.1);
    const c = corridorBetween(d, room.id, target)!;
    expect(world.chalk[room.id].b).toBe(c.id);
    expect(world.heroes.a.knownChalk[room.id].b).toBe(c.id);
  });
});
