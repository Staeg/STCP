import { describe, expect, it } from 'vitest';
import { createBotMemory, botThink } from '../bots/explorer';
import { CALL_RULES, hopsFrom } from './call';
import { buildView } from './views';
import { speedOf } from './speed';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** A room exactly `n` tunnels from `from` (or as far as it goes). */
function roomAt(world: World, from: number, n: number): number {
  const hops = [...hopsFrom(world, from)];
  const far = Math.min(n, Math.max(...hops.map(([, h]) => h)));
  return hops.find(([, h]) => h === far)![0];
}

describe('call for help', () => {
  // Packs only move while the dungeon escalates (nothing else respawns before Escalation 1, at 2:00).
  it('works once per run, summons a pack nearby that goes to the call and stays there', () => {
    const world = createWorld(5, { monsters: false, loot: false });
    const h = addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    const room = world.dungeon.entrance;
    applyIntent(world, 'a', { type: 'call' });
    expect(h.called).toBe(true);
    expect(world.calls).toHaveLength(1);
    const packs = Object.values(world.packs);
    expect(packs).toHaveLength(1);
    const pack = packs[0];
    expect(pack.goal).toBe(room);
    const hops = hopsFrom(world, room, true).get(pack.room)!;
    expect(hops).toBeGreaterThanOrEqual(1);
    expect(hops).toBeLessThanOrEqual(CALL_RULES.spawnWithin);
    // A second call does nothing.
    applyIntent(world, 'a', { type: 'call' });
    expect(world.calls).toHaveLength(1);
    expect(Object.keys(world.packs)).toHaveLength(1);
    // The pack comes straight in and starts a fight with the caller.
    run(world, 60);
    expect(world.stats.fights).toBe(1);
  });

  it('a pack with nobody at the call waits there', () => {
    const world = createWorld(5, { monsters: false, loot: false });
    const h = addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    const room = world.dungeon.entrance;
    applyIntent(world, 'a', { type: 'call' });
    h.pos = { kind: 'room', room: roomAt(world, room, 99) };
    run(world, 80);
    const pack = Object.values(world.packs)[0];
    expect(pack.room).toBe(room);
    expect(pack.to).toBeNull();
    run(world, 30);
    expect(pack.room).toBe(room);
  });

  it('can be done while Downed', () => {
    const world = createWorld(5, { monsters: false, loot: false, escalates: false });
    const h = addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    addHero(world, { id: 'b', name: 'B', cls: 'witch' });
    h.downedAt = world.time;
    applyIntent(world, 'a', { type: 'call' });
    expect(h.called).toBe(true);
  });

  it('is heard with chance 1 − 0.1 × distance', () => {
    let heard = 0;
    let expected = 0;
    const trials = 300;
    for (let s = 0; s < trials; s++) {
      const world = createWorld(100 + s, { monsters: false, loot: false, escalates: false });
      const room = world.dungeon.entrance;
      addHero(world, { id: 'a', name: 'A', cls: 'warden' });
      const b = addHero(world, { id: 'b', name: 'B', cls: 'witch' });
      b.pos = { kind: 'room', room: roomAt(world, room, 1 + (s % 9)) };
      expected += Math.max(0, 1 - CALL_RULES.falloff * hopsFrom(world, room).get((b.pos as { room: number }).room)!);
      applyIntent(world, 'a', { type: 'call' });
      const got = world.calls[0].heard.includes('b');
      if (got) heard++;
      // Only those who heard it see it.
      expect(buildView(world, 'b').calls.length).toBe(got ? 1 : 0);
      expect(buildView(world, 'a').calls.length).toBe(1);
    }
    expect(Math.abs(heard - expected)).toBeLessThan(trials * 0.08);
  });

  it('bots answer a call they can reach within 30 seconds, and ignore one further away', () => {
    const world = createWorld(5, { monsters: false, loot: false, escalates: false });
    const room = world.dungeon.entrance;
    addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    const bot = addHero(world, { id: 'b', name: 'B', cls: 'witch', isBot: true });
    // The bot knows the whole map, and stands two tunnels away.
    bot.explored = world.dungeon.rooms.map((r) => r.id);
    bot.seen = [...bot.explored];
    const start = roomAt(world, room, 2);
    bot.pos = { kind: 'room', room: start };
    world.calls.push({ by: 'a', room, time: world.time, heard: ['b'] });
    const mem = createBotMemory(1);
    const intent = botThink(buildView(world, 'b'), mem);
    expect(intent?.type).toBe('goto');
    expect(mem.call).toBe(room);

    const far = createBotMemory(1);
    bot.pos = { kind: 'room', room: roomAt(world, room, 99) };
    expect(hopsFrom(world, room).get(bot.pos.room)! * speedOf(bot, world.time)).toBeGreaterThan(30);
    botThink(buildView(world, 'b'), far);
    expect(far.call ?? null).toBeNull();
  });
});
