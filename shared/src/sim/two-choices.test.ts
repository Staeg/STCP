import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClassId } from '../content/classes';
import { EVENT_CHOICES, EVENTS, MORE_EVENTS, SPEED_EVENTS, STRESS, type EventKind } from '../content/events';
import { ITEMS } from '../content/items';
import { damageMult, monstersIn, spawnGroup } from './combat';
import { applyItem, equip } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { RoomEvent } from './events';
import { speedOf } from './speed';

// Exact stress amounts below; the dungeon's steady background stress would blur them.
const baseStress = STRESS.basePerSec;
beforeEach(() => void (STRESS.basePerSec = 0));
afterEach(() => void (STRESS.basePerSec = baseStress));

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Pick an event choice and wait for the hero's timer to run out, when it starts. */
function choose(world: World, id: string, choice: string) {
  applyIntent(world, id, { type: 'event', choice });
  while (world.heroes[id].queuedEvent !== null) step(world, 0.1);
}

/** A quiet world with one hero standing in a room that holds the given event. */
function withEvent(kind: RoomEvent['kind'], cls: ClassId = 'warden') {
  const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
  const h = addHero(world, { id: 'h', name: 'H', cls });
  const d = world.dungeon;
  const room = d.entrance;
  world.events[room] = { room, kind, done: false, progress: 0, by: null, spawned: false };
  return { world, h, d, room };
}

const loot = (world: World, id: string) => buildView(world, id).loot?.items.map((i) => i.item) ?? [];

describe('every shared event has two choices (user, 2026-10-16)', () => {
  it('offers two or more choices at each, and one at each Elite Event', () => {
    for (const kind of Object.keys(EVENTS) as EventKind[]) {
      if (kind === 'villager' || kind === 'veiled') continue;
      const cls = EVENTS[kind].elite ?? 'warden';
      const { world } = withEvent(kind as RoomEvent['kind'], cls);
      const n = buildView(world, 'h').event!.choices.length;
      if (EVENTS[kind].elite) expect(n, kind).toBe(1);
      else expect(n, kind).toBeGreaterThanOrEqual(2);
    }
  });

  it('each choice says its own time', () => {
    const { world } = withEvent('chest');
    const [open, unbind] = buildView(world, 'h').event!.choices;
    expect(open.label).toMatch(/\(6s\)$/);
    expect(unbind.label).toMatch(/\(20s\)$/);
  });
});

describe('second choices', () => {
  it('Desecrate: gold now, every hero everywhere takes stress (with a sound), and no Altar is cleansed', () => {
    const { world, h, room } = withEvent('altar');
    const far = addHero(world, { id: 'f', name: 'F', cls: 'sorceress' });
    far.pos = { kind: 'room', room: world.dungeon.rooms.find((r) => r.kind === 'normal' && r.id !== room)!.id };
    choose(world, 'h', 'desecrate');
    run(world, EVENT_CHOICES.desecrateTime + 0.2);
    expect(world.events[room].done).toBe(true);
    expect(h.gold).toBeGreaterThanOrEqual(EVENT_CHOICES.desecrateGold);
    expect(h.stress).toBe(EVENT_CHOICES.desecrateStress);
    expect(far.stress).toBe(EVENT_CHOICES.desecrateStress);
    expect(far.messages.some((m) => m.sound === 'desecrate')).toBe(true);
    expect(world.objectives.altars).toBe(0);
  });

  it('Ask the Way: the captive runs off, and the way to the rendezvous goes on your map', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden' });
    const room = world.dungeon.entrance;
    world.villagers.v1 = { id: 'v1', room, leader: null, hp: 10, maxHp: 10, state: 'captive' };
    expect(buildView(world, 'h').event!.choices.map((c) => c.id)).toEqual(['lead', 'ask']);
    choose(world, 'h', 'ask');
    expect(world.villagers.v1.state).toBe('fled');
    expect(h.leading).toEqual([]);
    expect(h.seen).toContain(world.dungeon.exit);
    expect(buildView(world, 'h').event).toBeNull();
  });

  it('Swap: the last thing in your pack for the idol, and nothing caves in', () => {
    const { world, h } = withEvent('idol');
    h.items.push('torch');
    choose(world, 'h', 'swap');
    run(world, EVENT_CHOICES.swapTime - 0.5);
    expect(h.items).toContain('torch');
    run(world, 0.7);
    expect(h.items).not.toContain('torch');
    expect(h.gold).toBeGreaterThanOrEqual(60);
    expect(world.collapsed).toHaveLength(0);
  });

  it('Swap: needs something to leave behind', () => {
    const { world, h } = withEvent('idol');
    h.items = [];
    expect(buildView(world, 'h').event!.choices[1].disabled).toMatch(/Nothing in your pack/);
  });

  it('Search: a sure consumable from the stranger, and stress', () => {
    const { world, h, room } = withEvent('stranger');
    choose(world, 'h', 'search');
    run(world, EVENT_CHOICES.searchTime + 0.2);
    expect(world.events[room].done).toBe(true);
    expect(h.stress).toBe(EVENT_CHOICES.searchStress);
    const items = loot(world, 'h');
    expect(items).toHaveLength(1);
    expect(ITEMS[items[0]].kind).toBe('consumable');
    expect(h.encounter).toBeNull();
  });

  it('Wish: costs gold, and a find rises from the water', () => {
    const { world, h } = withEvent('well');
    expect(buildView(world, 'h').event!.choices[1].disabled).toMatch(/gold/);
    h.gold = 30;
    choose(world, 'h', 'wish');
    run(world, EVENT_CHOICES.wishTime + 0.2);
    expect(h.gold).toBe(5);
    expect(loot(world, 'h')).toHaveLength(1);
  });

  it('Smash: the vault opens fast, one find short', () => {
    const { world, room } = withEvent('vault');
    choose(world, 'h', 'smash');
    run(world, EVENT_CHOICES.smashTime + 0.2);
    expect(world.events[room].done).toBe(true);
    expect(world.piles[room].items).toHaveLength(2); // a find and a Resource (picking the lock: two finds)
  });

  it('Unbind: the chest takes 20s, and there is no curse', () => {
    const { world, h, room } = withEvent('chest');
    choose(world, 'h', 'unbind');
    run(world, EVENT_CHOICES.unbindTime - 0.5);
    expect(world.events[room].done).toBe(false);
    run(world, 0.7);
    expect(world.events[room].done).toBe(true);
    expect(h.stress).toBe(0);
    expect(loot(world, 'h')).toHaveLength(1);
  });

  it('Bottle: a Quicksilver Flask that hastens you for a while when drunk', () => {
    const { world, h } = withEvent('quicksilver', 'cutthroat');
    choose(world, 'h', 'bottle');
    run(world, EVENT_CHOICES.bottleTime + 0.2);
    expect(h.items).toContain('flask');
    expect(speedOf(h, world.time)).toBe(3);
    applyItem(world, h, h.items.indexOf('flask'));
    expect(speedOf(h, world.time)).toBe(2);
    run(world, EVENT_CHOICES.flaskSecs + 0.5);
    expect(speedOf(h, world.time)).toBe(3);
  });

  it('Pocket: a handful of gold, and no satchel', () => {
    const { world, h } = withEvent('satchel');
    choose(world, 'h', 'pocket');
    run(world, EVENT_CHOICES.pocketTime + 0.2);
    expect(h.gold).toBe(EVENT_CHOICES.pocketGold);
    expect(h.items).not.toContain('satchel');
  });

  it('Shatter: a small haste for you alone, for the run', () => {
    const { world, h } = withEvent('hourglass', 'lampbearer');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'lampbearer' });
    choose(world, 'h', 'shatter');
    run(world, EVENT_CHOICES.shatterTime + 0.2);
    expect(speedOf(h, world.time)).toBe(4.5);
    expect(speedOf(o, world.time)).toBe(5);
    run(world, 200);
    expect(speedOf(h, world.time)).toBe(4.5);
  });

  it('Overwind: half the wind, then it holds or jams', () => {
    const { world, h } = withEvent('clockwork', 'lampbearer');
    choose(world, 'h', 'overwind');
    run(world, SPEED_EVENTS.clockworkWork / 5 / 2 + 0.2);
    const s = speedOf(h, world.time);
    expect([5 + EVENT_CHOICES.overwindSpeed, 5 + EVENT_CHOICES.jamSpeed]).toContain(s);
  });

  it('Force: one hero alone opens the Twin Locks, for the gold only', () => {
    const { world, h, room } = withEvent('locks');
    const force = buildView(world, 'h').event!.choices.find((c) => c.id === 'force')!;
    expect(force.label).toMatch(/\(25s\)$/);
    choose(world, 'h', 'force');
    run(world, EVENT_CHOICES.forceTime - 0.5);
    expect(world.events[room].done).toBe(false);
    run(world, 0.7);
    expect(world.events[room].done).toBe(true);
    expect(h.gold).toBeGreaterThanOrEqual(MORE_EVENTS.locksGold[0]);
    expect(loot(world, 'h')).toHaveLength(0);
  });

  it('Force: nobody can take the other wheel while someone forces one', () => {
    const { world } = withEvent('locks');
    addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    choose(world, 'h', 'force');
    step(world, 0.1);
    expect(buildView(world, 'o').event!.choices.every((c) => c.disabled)).toBe(true);
  });

  it('Search the Lining: an amulet or a ring, and stress', () => {
    const { world, h } = withEvent('coffin');
    choose(world, 'h', 'lining');
    run(world, EVENT_CHOICES.liningTime + 0.2);
    expect(h.stress).toBe(EVENT_CHOICES.liningStress);
    expect(h.downedAt).toBeNull();
    const [item] = loot(world, 'h');
    expect(['amulet', 'ring']).toContain(ITEMS[item].kind);
  });

  it('Quick Temper: the weapon hits harder for the run', () => {
    const { world, h } = withEvent('anvil');
    equip(h, 'weapon', 'dirk');
    const before = damageMult(h, world);
    choose(world, 'h', 'temper');
    run(world, EVENT_CHOICES.temperTime + 0.2);
    expect(damageMult(h, world)).toBeCloseTo(before + EVENT_CHOICES.temperPct);
  });

  it('Unravel: the worn Cloth is gone, it hurts, and the Loom weaves for every hero in the dungeon', () => {
    const { world, h, room } = withEvent('loom');
    expect(buildView(world, 'h').event!.choices[1].disabled).toMatch(/no Cloth/);
    equip(h, 'armor', 'patchwork');
    const far = addHero(world, { id: 'f', name: 'F', cls: 'bellwright' });
    far.pos = { kind: 'room', room: world.dungeon.rooms.find((r) => r.kind === 'normal' && r.id !== room)!.id };
    far.tolled = true;
    const hp = h.hp;
    choose(world, 'h', 'unravel');
    run(world, EVENT_CHOICES.unravelTime + 0.2);
    expect(h.armor).toBeNull();
    expect(h.hp).toBe(hp - EVENT_CHOICES.unravelDamage);
    expect(far.tolled).toBe(false);
    expect(far.messages.some((m) => m.sound === 'weave')).toBe(true);
  });

  it('Look for the Way: every monster in the dungeon, and the way to the rendezvous', () => {
    const { world, h, d } = withEvent('scrying');
    const lair = d.rooms.find((r) => r.kind === 'normal' && r.id !== d.entrance && r.id !== d.exit)!.id;
    spawnGroup(world, lair, ['ghoul'], 0);
    choose(world, 'h', 'deep');
    run(world, EVENT_CHOICES.deepTime + 0.2);
    expect(h.knownThreat[lair]).toBe(1);
    expect(h.seen).toContain(d.exit);
  });

  it('Pry: a Relic, and a Bone Giant wakes in the room', () => {
    const { world, h, room } = withEvent('crowned');
    choose(world, 'h', 'pry');
    run(world, EVENT_CHOICES.pryTime + 0.2);
    expect(monstersIn(world, room).map((m) => m.type)).toEqual(['giant']);
    expect(h.encounter).toBe(room);
    expect(world.piles[room].items.map((i) => i.item)).toContain('relic');
  });
});
