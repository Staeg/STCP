import { describe, expect, it } from 'vitest';
import { ESCALATION_INTERVAL } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { spawnGroup } from './combat';
import { makePack } from './escalation';
import { Game } from './game';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** A quiet world, everyone standing at the exit. */
function atOpenExit(n: number) {
  const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
  for (let i = 0; i < n; i++) addHero(world, { id: `h${i}`, name: `H${i}`, cls: 'warden' });
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

  it('E toggles', () => {
    const world = atOpenExit(1);
    applyIntent(world, 'h0', { type: 'ready' });
    applyIntent(world, 'h0', { type: 'ready' });
    expect(world.heroes.h0.ready).toBe(false);
    run(world, 1);
    expect(world.heroes.h0.extracted).toBe(false);
    applyIntent(world, 'h0', { type: 'ready' });
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
  it('stay hidden until Escalation 4 (two) and Escalation 5 (four more), then open with loot and a small guard', () => {
    const world = createWorld(77, { monsters: false, events: false });
    addHero(world, { id: 'h0', name: 'H0', cls: 'warden' });
    const d = world.dungeon;
    const first = d.secrets[0];
    // The hero stands in its host room from the start: still nothing to see.
    world.heroes.h0.pos = { kind: 'room', room: first.host };
    world.heroes.h0.explored.push(first.host);
    world.time = ESCALATION_INTERVAL * 4 - 0.05;
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
    world.time = ESCALATION_INTERVAL * 5 - 0.05;
    run(world, 0.2);
    expect(d.secrets.every((s) => s.open)).toBe(true);
  });
});

describe('after you escape', () => {
  /** You plus three companions at the open exit; only you leave. */
  function escapeAlone(bots: boolean) {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
    addHero(world, { id: 'you', name: 'You', cls: 'warden' });
    for (let i = 0; i < 3; i++) addHero(world, { id: `b${i}`, name: `B${i}`, cls: 'warden', isBot: bots });
    for (const id of ['b0', 'b1', 'b2']) world.heroes[id].pos = { kind: 'room', room: neighbours(world.dungeon, world.dungeon.exit)[0] };
    applyIntent(world, 'you', { type: 'ready' });
    step(world, 0.1);
    expect(world.heroes.you.extracted).toBe(true);
    expect(world.phase).toBe('running');
    return world;
  }

  it('with 3 bots left inside, Reveal map lifts the fog', () => {
    const world = escapeAlone(true);
    const before = buildView(world, 'you');
    expect(before.soloOut).toBe(true);
    expect(before.mapRevealed).toBe(false);
    expect(before.loot).toBeNull();
    applyIntent(world, 'you', { type: 'revealMap' });
    const view = buildView(world, 'you');
    expect(view.mapRevealed).toBe(true);
    expect(view.rooms.every((r) => r.knowledge === 'explored')).toBe(true);
  });

  it('the revealed map shows the bots and moving monsters as they are now', () => {
    const world = escapeAlone(true);
    applyIntent(world, 'you', { type: 'revealMap' });
    const b0 = world.heroes.b0;
    const there = neighbours(world.dungeon, world.dungeon.exit)[1];
    b0.pos = { kind: 'room', room: there };
    const from = neighbours(world.dungeon, there).find((n) => n !== world.dungeon.exit)!;
    const pack = makePack(world, spawnGroup(world, from, ['ghoul', 'ghoul'], 1), from, null);
    pack.to = there;
    pack.departAt = world.time - 1;
    pack.arriveAt = world.time + 3;
    for (const id of pack.monsters) world.monsters[id].room = -1;
    const view = buildView(world, 'you');
    const ally = view.allies.find((a) => a.id === 'b0')!;
    expect(ally.live).toBe(true);
    expect(ally.pos).toEqual({ kind: 'room', room: there });
    expect(view.packs).toEqual([{ from, to: there, t: 1, dur: 4, monsters: ['ghoul', 'ghoul'] }]);
  });

  it('dead with 3 bots left inside, the buttons work too', () => {
    const world = escapeAlone(true);
    world.heroes.you.extracted = false;
    world.heroes.you.dead = true;
    applyIntent(world, 'you', { type: 'revealMap' });
    expect(buildView(world, 'you').mapRevealed).toBe(true);
  });

  it('Kill the bots ends the run at once', () => {
    const world = escapeAlone(true);
    applyIntent(world, 'you', { type: 'killBots' });
    expect(['b0', 'b1', 'b2'].every((id) => world.heroes[id].dead)).toBe(true);
    expect(world.phase).toBe('ended');
    expect(world.heroes.you.extracted).toBe(true);
  });

  it('still inside, the buttons do nothing', () => {
    const world = atOpenExit(1);
    for (let i = 0; i < 3; i++) addHero(world, { id: `b${i}`, name: `B${i}`, cls: 'warden', isBot: true });
    applyIntent(world, 'h0', { type: 'killBots' });
    applyIntent(world, 'h0', { type: 'revealMap' });
    expect(world.phase).toBe('running');
    expect(buildView(world, 'h0').mapRevealed).toBe(false);
  });

  it('with other players left inside, neither button works', () => {
    const world = escapeAlone(false);
    applyIntent(world, 'you', { type: 'revealMap' });
    applyIntent(world, 'you', { type: 'killBots' });
    const view = buildView(world, 'you');
    expect(view.soloOut).toBe(false);
    expect(view.mapRevealed).toBe(false);
    expect(world.phase).toBe('running');
  });
});
