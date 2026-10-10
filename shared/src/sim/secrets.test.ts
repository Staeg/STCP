import { describe, expect, it } from 'vitest';
import { openDueSecrets } from './secrets';
import { buildView } from './views';
import { addHero, createWorld, explore, knowsCorridor } from './world';

describe('secret passages', () => {
  it("stay hidden from heroes who explored the host room until they're back in it", () => {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
    const away = addHero(world, { id: 'a', name: 'A', cls: 'warden' });
    const there = addHero(world, { id: 'b', name: 'B', cls: 'warden' });
    const s = world.dungeon.secrets[0];
    // Both have explored the host room; only one is standing in it when the passage opens.
    for (const h of [away, there]) {
      h.pos = { kind: 'room', room: s.host };
      explore(world, h, s.host);
    }
    away.pos = { kind: 'room', room: world.dungeon.entrance };
    world.escalation = s.escalation;
    openDueSecrets(world);
    expect(s.open).toBe(true);
    expect(knowsCorridor(there, s.corridor)).toBe(true);
    expect(knowsCorridor(away, s.corridor)).toBe(false);
    const view = buildView(world, 'a');
    expect(view.corridors.some((c) => c.id === s.corridor.id)).toBe(false);
    expect(view.rooms.some((r) => r.id === s.room)).toBe(false);
    // Coming back to the host room finds it.
    away.pos = { kind: 'room', room: s.host };
    explore(world, away, s.host);
    expect(knowsCorridor(away, s.corridor)).toBe(true);
    expect(buildView(world, 'a').rooms.some((r) => r.id === s.room)).toBe(true);
  });
});
