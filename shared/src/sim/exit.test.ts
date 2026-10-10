import { describe, expect, it } from 'vitest';
import { EXIT_OPENS_AT, TIER_INTERVAL } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { spawnGroup } from './combat';
import { Game } from './game';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** A quiet world at the moment the exit opens, everyone standing at it. */
function atOpenExit(n: number) {
  const world = createWorld(31, { monsters: false, loot: false, escalation: false, events: false });
  for (let i = 0; i < n; i++) addHero(world, { id: `h${i}`, name: `H${i}`, cls: 'warden' });
  world.time = EXIT_OPENS_AT;
  return world;
}

describe('ready to leave (E)', () => {
  it('alone and ready at the open exit, you are out at once', () => {
    const world = atOpenExit(1);
    applyIntent(world, 'h0', { type: 'ready' });
    step(world, 0.1);
    expect(world.heroes.h0.extracted).toBe(true);
  });

  it('waits until everyone standing there is ready, then they all go together', () => {
    const world = atOpenExit(2);
    applyIntent(world, 'h0', { type: 'ready' });
    run(world, 1);
    expect(world.heroes.h0.extracted).toBe(false);
    applyIntent(world, 'h1', { type: 'ready' });
    step(world, 0.1);
    expect(world.heroes.h0.extracted && world.heroes.h1.extracted).toBe(true);
    expect(world.chronicle.some((c) => c.text.includes('left together'))).toBe(true);
  });

  it('E toggles, and can be set before the exit opens or away from it', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalation: false, events: false });
    addHero(world, { id: 'h0', name: 'H0', cls: 'warden' });
    applyIntent(world, 'h0', { type: 'ready' });
    applyIntent(world, 'h0', { type: 'ready' });
    expect(world.heroes.h0.ready).toBe(false);
    applyIntent(world, 'h0', { type: 'ready' });
    run(world, 1);
    expect(world.heroes.h0.extracted).toBe(false); // the exit isn't open yet
    world.time = EXIT_OPENS_AT;
    step(world, 0.1);
    expect(world.heroes.h0.extracted).toBe(true);
  });

  it('not while a fight goes on there, nor with a downed ally on the floor', () => {
    const world = atOpenExit(2);
    const exit = world.dungeon.exit;
    world.heroes.h1.hp = 0;
    world.heroes.h1.downedAt = world.time;
    applyIntent(world, 'h0', { type: 'ready' });
    run(world, 1);
    expect(world.heroes.h0.extracted).toBe(false);
    world.heroes.h1.downedAt = null;
    world.heroes.h1.hp = 20;
    world.heroes.h1.ready = true;
    spawnGroup(world, exit, ['crawler'], 0);
    run(world, 0.5);
    expect(world.heroes.h0.extracted).toBe(false);
  });

  it('allies who can see you see that you are ready', () => {
    const world = atOpenExit(2);
    applyIntent(world, 'h0', { type: 'ready' });
    step(world, 0.1);
    const ally = buildView(world, 'h1').allies.find((a) => a.id === 'h0')!;
    expect(ally.ready).toBe(true);
  });
});

describe('autopilot (O)', () => {
  it('a bot takes the wheel without marking the hero a bot, and hands it back', () => {
    const game = new Game(5, [{ id: 'p', name: 'P', cls: 'warden', isBot: false }], { monsters: false, events: false });
    const h = game.world.heroes.p;
    game.intent('p', { type: 'autopilot' });
    expect(h.autopilot).toBe(true);
    expect(h.isBot).toBe(false);
    for (let i = 0; i < 300; i++) game.tick(0.1);
    expect(h.explored.length).toBeGreaterThan(1);
    game.intent('p', { type: 'autopilot' });
    expect(h.autopilot).toBe(false);
    expect(game.bots.has('p')).toBe(false);
  });
});

describe('secret rooms', () => {
  it('stay hidden until tier 4 (two) and tier 5 (four more), then open with loot and a small guard', () => {
    const world = createWorld(77, { monsters: false, events: false });
    addHero(world, { id: 'h0', name: 'H0', cls: 'warden' });
    const d = world.dungeon;
    const first = d.secrets[0];
    // The hero stands in its host room from the start: still nothing to see.
    world.heroes.h0.pos = { kind: 'room', room: first.host };
    world.heroes.h0.explored.push(first.host);
    world.time = TIER_INTERVAL * 4 - 0.05;
    step(world, 0.01);
    let view = buildView(world, 'h0');
    expect(view.corridors.some((c) => c.secret)).toBe(false);
    expect(view.rooms.some((r) => r.kind === 'secret')).toBe(false);
    run(world, 0.2);
    expect(d.secrets.filter((s) => s.open).length).toBe(2);
    view = buildView(world, 'h0');
    expect(view.corridors.some((c) => c.secret && c.b === first.room)).toBe(true);
    expect(world.monsters && Object.values(world.monsters).filter((m) => m.room === first.room).length).toBeGreaterThan(0);
    expect(world.monsters && Object.values(world.monsters).filter((m) => m.room === first.room).length).toBeLessThanOrEqual(2);
    expect(world.piles[first.room]?.gold).toBeGreaterThan(0);
    expect(neighbours(d, first.room)).toEqual([first.host]);
    world.time = TIER_INTERVAL * 5 - 0.05;
    run(world, 0.2);
    expect(d.secrets.every((s) => s.open)).toBe(true);
  });
});
