import { describe, expect, it } from 'vitest';
import { CODEX_ENEMIES, CODEX_EVENTS, emptyCodex, mergeCodex } from '../content/codex';
import { neighbours } from '../dungeon/gen';
import { onHeroInRoom, spawnGroup } from './combat';
import { addToPile } from './loot';
import { addHero, createWorld, step } from './world';

describe('the Codex', () => {
  it('notes the monsters, loot and event in the room a hero stands in', () => {
    const world = createWorld(7, { monsters: false, loot: false, escalates: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden' });
    const room = neighbours(world.dungeon, world.dungeon.entrance)[0];
    spawnGroup(world, room, ['ghoul'], 0);
    addToPile(world, room, 0, ['torch']);
    world.events[room] = { kind: 'well', room, done: false } as never;
    step(world, 0.1);
    expect(h.codex).toEqual(emptyCodex());
    h.pos = { kind: 'room', room };
    onHeroInRoom(world, h, room);
    step(world, 0.1);
    expect(h.codex.enemies).toEqual(['ghoul']);
    expect(h.codex.items).toContain('torch');
    expect(h.codex.events).toEqual(['well']);
    // A Warden at the Well finds no twist; a Zealot would.
    expect(h.codex.twists).toEqual([]);
  });

  it("finds a class's event twist by meeting the event as that class", () => {
    const world = createWorld(7, { monsters: false, loot: false, escalates: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'zealot' });
    const room = neighbours(world.dungeon, world.dungeon.entrance)[0];
    world.events[room] = { kind: 'well', room, done: false } as never;
    h.pos = { kind: 'room', room };
    step(world, 0.1);
    expect(h.codex.twists).toEqual(['zealot-well']);
  });

  it('merges only what is new and real', () => {
    const c = emptyCodex();
    expect(mergeCodex(c, { enemies: ['ghoul', 'wolf'], events: ['veiled', 'altar'], items: ['alastor'] })).toBe(true);
    expect(c).toEqual({ items: ['alastor'], enemies: ['ghoul'], events: ['altar'], twists: [] });
    expect(mergeCodex(c, { enemies: ['ghoul'] })).toBe(false);
    expect(CODEX_ENEMIES).not.toContain('wolf');
    expect(CODEX_EVENTS).not.toContain('veiled');
  });
});
