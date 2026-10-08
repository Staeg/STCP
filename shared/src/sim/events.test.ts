import { describe, expect, it } from 'vitest';
import { EXIT_OPENS_AT } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { monstersIn, spawnGroup } from './combat';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { RoomEvent } from './events';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** A quiet world with one hero standing in a room that holds the given event. */
function withEvent(kind: RoomEvent['kind'], cls: 'warden' | 'cutthroat' | 'lampbearer' | 'hexer' = 'warden') {
  const world = createWorld(31, { monsters: false, loot: false, escalation: false, events: false });
  const h = addHero(world, { id: 'h', name: 'H', cls });
  const d = world.dungeon;
  const room = d.entrance;
  world.events[room] = { room, kind, done: false, progress: 0, spawned: false };
  return { world, h, d, room };
}

describe('room events', () => {
  it('shows up in the view with choices, and the map remembers it', () => {
    const { world } = withEvent('well');
    step(world, 0.1);
    const v = buildView(world, 'h');
    expect(v.event?.kind).toBe('well');
    expect(v.event?.choices.map((c) => c.id)).toEqual(['drink']);
    expect(v.rooms.find((r) => r.id === world.dungeon.entrance)?.event).toBe('well');
  });

  it('is blocked while monsters are in the room', () => {
    const { world, room } = withEvent('chest');
    spawnGroup(world, room, ['ghoul'], 0);
    expect(buildView(world, 'h').event?.blocked).toBe(true);
  });

  it('cursed chest: loot, plus stress for whoever opened it', () => {
    const { world, h, room } = withEvent('chest');
    applyIntent(world, 'h', { type: 'event', choice: 'open' });
    expect(h.stress).toBe(20);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    expect(h.gold).toBe(20);
    expect(world.piles[room]?.vote).toBeTruthy();
  });

  it('idol: lots of gold, and the way you came in caves in', () => {
    const { world, h, d } = withEvent('idol');
    const next = neighbours(d, d.entrance)[0];
    // Walk out and back so we have a previous room.
    applyIntent(world, 'h', { type: 'goto', room: next });
    run(world, 9);
    world.events[next] = { room: next, kind: 'idol', done: false, progress: 0, spawned: false };
    applyIntent(world, 'h', { type: 'event', choice: 'take' });
    step(world, 0.1);
    expect(h.gold).toBeGreaterThanOrEqual(60);
    expect(world.collapsed.length).toBe(1);
    expect(h.knownCollapsed.length).toBe(1);
  });

  it('stranger needs a bandage; it either rewards or ambushes', () => {
    const { world, h, room } = withEvent('stranger');
    expect(buildView(world, 'h').event?.choices[0].disabled).toMatch(/no bandage/);
    h.items = ['bandage'];
    applyIntent(world, 'h', { type: 'event', choice: 'help' });
    expect(h.items).toEqual([]);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    const ambushed = monstersIn(world, room).length > 0;
    const rewarded = h.gold > 0;
    expect(ambushed || rewarded).toBe(true);
  });

  it('crawlspace moves you toward the exit for a price', () => {
    const { world, h, d } = withEvent('crawlspace');
    const hp = h.hp;
    applyIntent(world, 'h', { type: 'event', choice: 'crawl' });
    expect(h.pos.kind === 'room' && h.pos.room !== d.entrance).toBe(true);
    expect(h.hp).toBe(hp - 4);
    expect(h.light).toBeLessThan(25);
  });

  it('vault: a channel (Cutthroat fast) whose progress survives interruption', () => {
    const { world, h, room } = withEvent('vault', 'cutthroat');
    applyIntent(world, 'h', { type: 'event', choice: 'channel' });
    run(world, 3);
    expect(world.events[room].progress).toBeGreaterThan(0.3);
    applyIntent(world, 'h', { type: 'stop' });
    step(world, 0.1);
    const kept = world.events[room].progress;
    expect(kept).toBeGreaterThan(0.3);
    applyIntent(world, 'h', { type: 'event', choice: 'channel' });
    run(world, 5);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    expect(h.gold).toBeGreaterThanOrEqual(30);
  });

  it('altar: guardians at 50%, then cleansing relieves everyone and pays out at the end', () => {
    const { world, h, room } = withEvent('altar', 'hexer');
    h.stress = 50;
    applyIntent(world, 'h', { type: 'event', choice: 'channel' });
    run(world, 4);
    expect(h.encounter).toBe(room); // the guardians came
    // Clear them and finish.
    for (const m of monstersIn(world, room)) delete world.monsters[m.id];
    run(world, 4);
    expect(h.encounter).toBeNull();
    applyIntent(world, 'h', { type: 'event', choice: 'channel' });
    run(world, 4);
    expect(world.events[room].done).toBe(true);
    expect(world.objectives.altars).toBe(1);
    expect(h.stress).toBeLessThanOrEqual(30);
  });
});

describe('villagers', () => {
  function captive() {
    const world = createWorld(31, { monsters: false, loot: false, escalation: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden' });
    const d = world.dungeon;
    world.villagers.v1 = { id: 'v1', room: d.entrance, leader: null, hp: 10, maxHp: 10, state: 'captive' };
    return { world, h, d };
  }

  it('follow their rescuer, slow them down, and are saved on reaching the rendezvous', () => {
    const { world, h, d } = captive();
    applyIntent(world, 'h', { type: 'event', choice: 'lead' });
    expect(h.leading).toBe('v1');
    const next = neighbours(d, d.entrance)[0];
    applyIntent(world, 'h', { type: 'goto', room: next });
    const len = d.corridors.find((c) => (c.a === d.entrance && c.b === next) || (c.b === d.entrance && c.a === next))!.length;
    run(world, len + 0.2);
    expect(h.pos.kind).toBe('corridor'); // slower than normal
    run(world, len);
    expect(world.villagers.v1.room).toBe(next);
    // Teleport to the rendezvous: delivered, even before the exit opens.
    h.pos = { kind: 'room', room: d.exit };
    step(world, 0.1);
    expect(world.villagers.v1.state).toBe('saved');
    expect(world.objectives.villagers).toBe(1);
    expect(h.leading).toBeNull();
    world.time = EXIT_OPENS_AT;
    applyIntent(world, 'h', { type: 'extract' });
    step(world, 0.1);
    expect(h.gold).toBe(25); // the game ended (only hero out) → bonus paid
  });

  it('wait where their leader fell, and someone else can pick them up', () => {
    const { world, h } = captive();
    const other = addHero(world, { id: 'o', name: 'O', cls: 'hexer' });
    applyIntent(world, 'h', { type: 'event', choice: 'lead' });
    h.hp = 0;
    h.downedAt = world.time;
    step(world, 0.1);
    expect(world.villagers.v1.state).toBe('waiting');
    applyIntent(world, 'o', { type: 'event', choice: 'lead' });
    expect(other.leading).toBe('v1');
  });
});

describe('stress and afflictions', () => {
  it('darkness raises stress; 100 means an affliction, the second 100 a heart attack', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalation: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden' });
    h.light = 0;
    h.stress = 95;
    run(world, 11);
    expect(h.affliction).not.toBeNull();
    expect(h.stress).toBeLessThan(70);
    h.stress = 99.9;
    run(world, 0.5);
    expect(h.downedAt).not.toBeNull();
    expect(world.chronicle.some((c) => c.text.includes('heart gave out'))).toBe(true);
  });

  it('Selfish heroes always vote for themselves and are ignored after 10s', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalation: false });
    const s = addHero(world, { id: 's', name: 'S', cls: 'warden' });
    addHero(world, { id: 'o', name: 'O', cls: 'hexer' });
    s.affliction = 'selfish';
    world.piles[world.dungeon.entrance] = { gold: 0, items: ['torch'], abandoned: [], vote: null };
    step(world, 0.1);
    applyIntent(world, 'o', { type: 'vote', choice: 'o' });
    applyIntent(world, 's', { type: 'vote', choice: 'o' }); // refused
    run(world, 2);
    expect(world.heroes.o.items).toEqual([]);
    run(world, 9);
    expect(world.heroes.o.items).toEqual(['torch']);
  });

  it('Paranoid heroes refuse bandages from others', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalation: false });
    const p = addHero(world, { id: 'p', name: 'P', cls: 'warden' });
    const o = addHero(world, { id: 'o', name: 'O', cls: 'hexer' });
    p.affliction = 'paranoid';
    p.hp = 10;
    o.items = ['bandage'];
    applyIntent(world, 'o', { type: 'useItem', index: 0, target: 'p' });
    expect(p.hp).toBe(10);
    expect(o.items).toEqual(['bandage']);
  });
});

describe('seeding', () => {
  it('puts events in a fair share of rooms and guards every captive', () => {
    let events = 0;
    let villagers = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = createWorld(seed);
      events += Object.keys(world.events).length;
      for (const v of Object.values(world.villagers)) {
        villagers++;
        expect(monstersIn(world, v.room).length).toBeGreaterThan(0);
      }
    }
    expect(events).toBeGreaterThan(20);
    expect(villagers).toBeGreaterThan(2);
  });
});
