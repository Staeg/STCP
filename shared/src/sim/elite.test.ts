import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClassId } from '../content/classes';
import { CLASS_ELITE, ELITE_EVENTS, EVENT_SEEDING, STRESS } from '../content/events';
import { LIGHT_MAX, MIN_SPEED } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { onHeroInRoom, spawnGroup } from './combat';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, extractHero, knowsCorridor, step, type World } from './world';
import { chooseEvent, type RoomEvent } from './events';
import { openDueSecrets } from './secrets';
import { addSpeedMod, speedOf } from './speed';

const baseStress = STRESS.basePerSec;
beforeEach(() => void (STRESS.basePerSec = 0));
afterEach(() => void (STRESS.basePerSec = baseStress));

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

function choose(world: World, id: string, choice: string) {
  applyIntent(world, id, { type: 'event', choice });
  while (world.heroes[id].queuedEvent !== null) step(world, 0.1);
}

/** A quiet world: a hero of `cls` (and an ally of `other`) at the entrance, which holds `cls`'s Elite Event. */
function withElite(cls: ClassId, other: ClassId = 'warden') {
  const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
  const h = addHero(world, { id: 'h', name: 'H', cls });
  const o = addHero(world, { id: 'o', name: 'O', cls: other });
  const room = world.dungeon.entrance;
  const kind = CLASS_ELITE[cls] as RoomEvent['kind'];
  world.events[room] = { room, kind, done: false, progress: 0, by: null, spawned: false };
  return { world, h, o, room };
}

describe('Elite Events: seeding', () => {
  it('each hero adds 20% for their class; never two of the same', () => {
    let one = 0;
    let two = 0;
    const games = 1000;
    for (let seed = 1; seed <= games; seed++) {
      const solo = createWorld(seed);
      addHero(solo, { id: 'a', name: 'A', cls: 'zealot' });
      if (Object.values(solo.events).some((e) => e.kind === 'zenith')) one++;
      const pair = createWorld(seed);
      addHero(pair, { id: 'a', name: 'A', cls: 'zealot' });
      addHero(pair, { id: 'b', name: 'B', cls: 'zealot' });
      const n = Object.values(pair.events).filter((e) => e.kind === 'zenith').length;
      expect(n).toBeLessThanOrEqual(1);
      two += n;
    }
    expect(one / games).toBeGreaterThan(0.15);
    expect(one / games).toBeLessThan(0.25);
    expect(two / games).toBeGreaterThan(0.34);
    expect(two / games).toBeLessThan(0.46);
  });

  it('five of a class always bring it; none without events', () => {
    const world = createWorld(7);
    for (let i = 0; i < 5; i++) addHero(world, { id: `h${i}`, name: `H${i}`, cls: 'warden' });
    expect(Object.values(world.events).filter((e) => e.kind === 'wanderers')).toHaveLength(1);
    const quiet = createWorld(7, { events: false });
    for (let i = 0; i < 5; i++) addHero(quiet, { id: `h${i}`, name: `H${i}`, cls: 'warden' });
    expect(Object.values(quiet.events)).toHaveLength(0);
  });
});

describe('Elite Events: what each class sees', () => {
  it('its own class gets the full text and a choice; others only a hint', () => {
    const { world, o } = withElite('warden', 'cutthroat');
    step(world, 0.1);
    const mine = buildView(world, 'h').event!;
    expect(mine.name).toBe('Wayward Wanderers');
    expect(mine.choices.map((c) => c.id)).toEqual(['gather']);
    const theirs = buildView(world, 'o').event!;
    expect(theirs.kind).toBe('veiled');
    expect(theirs.text).toBe('Maybe Warden knows what to do with this…');
    expect(theirs.choices).toEqual([]);
    expect(theirs.blocked).toBe(false);
    // And on the map.
    const room = world.dungeon.entrance;
    expect(buildView(world, 'h').rooms.find((r) => r.id === room)?.event).toBe('wanderers');
    expect(buildView(world, 'o').rooms.find((r) => r.id === room)?.event).toBe('veiled');
    expect(chooseEvent(world, o, 'gather', true)).toBe('Nothing to do here.');
  });
});

describe('Elite Events: effects', () => {
  it('Wayward Wanderers: −3s Speed for the run, and two villagers saved when the Warden escapes', () => {
    const { world, h } = withElite('warden');
    const before = speedOf(h, world.time);
    choose(world, 'h', 'gather');
    run(world, ELITE_EVENTS.channel + 0.2);
    expect(h.wanderers).toBe(2);
    expect(speedOf(h, world.time)).toBeCloseTo(Math.max(MIN_SPEED, before - 3));
    expect(world.objectives.villagers).toBe(0);
    extractHero(world, h);
    expect(world.objectives.villagers).toBe(2);
    expect(EVENT_SEEDING.villagerBonus).toBeGreaterThan(0);
  });

  it('Cunning Cant: the whole map, and secret rooms open to the Cutthroat alone until their Escalation', () => {
    const { world, h, o } = withElite('cutthroat');
    choose(world, 'h', 'read');
    run(world, ELITE_EVENTS.channel + 0.2);
    const d = world.dungeon;
    const s = d.secrets[0];
    expect(s.open).toBe(true);
    expect(knowsCorridor(h, s.corridor)).toBe(true);
    expect(knowsCorridor(o, s.corridor)).toBe(false);
    const vh = buildView(world, 'h');
    expect(vh.rooms.some((r) => r.id === s.room)).toBe(true);
    expect(vh.corridors.length).toBe(d.corridors.length);
    // Someone else standing at the passage's mouth still can't see it.
    o.pos = { kind: 'room', room: s.host };
    onHeroInRoom(world, o, s.host);
    step(world, 0.1);
    expect(buildView(world, 'o').corridors.some((c) => c.id === s.corridor.id)).toBe(false);
    expect(o.seen).not.toContain(s.room);
    // Its Escalation comes: now it's everyone's.
    world.escalation = s.escalation;
    openDueSecrets(world);
    expect(knowsCorridor(o, s.corridor)).toBe(true);
    expect(o.seen).toContain(s.room);
  });

  it('Luminous Liturgy: every ally, anywhere, heals, brightens and calms each second, for as long as it lasts', () => {
    const { world, o, room } = withElite('lampbearer');
    o.pos = { kind: 'room', room: neighbours(world.dungeon, room)[0] };
    o.hp = 10;
    o.stress = 50;
    o.light = 10;
    choose(world, 'h', 'pray');
    run(world, 30);
    expect(o.hp).toBeGreaterThanOrEqual(39);
    expect(o.stress).toBeLessThanOrEqual(25); // (−1 a second, less a little for the dim start)
    expect(o.light).toBeGreaterThan(30);
    expect(o.light).toBeLessThanOrEqual(LIGHT_MAX);
    expect(world.events[room].done).toBe(false);
    expect(buildView(world, 'h').event?.worker?.secondsLeft).toBeNull();
    // Walking off ends it, but it stays there to come back to.
    applyIntent(world, 'h', { type: 'goto', room: neighbours(world.dungeon, room)[0] });
    run(world, 10);
    o.hp = 20;
    run(world, 3);
    expect(o.hp).toBe(20);
    expect(world.events[room].done).toBe(false);
    expect(world.events[room].by).toBeNull();
  });

  it('Sinful Sacrament: +25 stress to every hero, and the Sorceress is Speed 2s for good', () => {
    const { world, h, o } = withElite('sorceress');
    o.pos = { kind: 'room', room: neighbours(world.dungeon, world.dungeon.entrance)[0] };
    choose(world, 'h', 'partake');
    run(world, ELITE_EVENTS.channel + 0.2);
    expect(h.stress).toBe(25);
    expect(o.stress).toBe(25);
    expect(speedOf(h, world.time)).toBe(MIN_SPEED);
    addSpeedMod(h, world.time, 3, null, 'Heavy'); // nothing slows her now
    expect(speedOf(h, world.time + 500)).toBe(MIN_SPEED);
  });

  it('Unholy Uprising: three Risen join every fight, keep their wounds, and allies take stress when it ends', () => {
    const { world, h, o, room } = withElite('undertaker');
    choose(world, 'h', 'raise');
    run(world, ELITE_EVENTS.channel + 0.2);
    expect(h.legion).toHaveLength(3);
    spawnGroup(world, room, ['ghoul'], 0);
    onHeroInRoom(world, h, room);
    const enc = world.encounters[room];
    expect(enc.legion).toHaveLength(3);
    expect(h.legion).toHaveLength(0);
    expect(buildView(world, 'h').encounter?.legion).toHaveLength(3);
    const stress = o.stress;
    run(world, 60);
    expect(world.encounters[room]).toBeUndefined();
    expect(h.legion.length).toBeGreaterThan(0);
    expect(h.legion.every((r) => r.permanent && r.hp > 0)).toBe(true);
    expect(o.stress).toBe(stress + ELITE_EVENTS.uprisingStress);
    expect(h.stress).toBe(0);
  });

  it('Booming Barrage: a Toll every 12s while ringing', () => {
    const { world } = withElite('bellwright');
    choose(world, 'h', 'ring');
    run(world, 12.5);
    expect(world.tolls).toHaveLength(1);
    run(world, 24);
    expect(world.tolls).toHaveLength(3);
    expect(Object.values(world.events)[0].done).toBe(true);
  });

  it('Zen Zenith: stress can go past 100', () => {
    const { world, h } = withElite('zealot');
    h.stress = 100;
    choose(world, 'h', 'sit');
    run(world, ELITE_EVENTS.channel + 0.2);
    h.stress = 150;
    run(world, 1);
    expect(h.stress).toBeGreaterThanOrEqual(150);
    expect(h.affliction).toBeNull();
  });

  it('Artistic Alacrity: each carried consumable is −0.5s Speed', () => {
    const { world, h } = withElite('alchemist');
    choose(world, 'h', 'rework');
    run(world, ELITE_EVENTS.channel + 0.2);
    const before = speedOf(h, world.time);
    h.items = ['bandage', 'bandage'];
    expect(speedOf(h, world.time)).toBeCloseTo(Math.max(MIN_SPEED, before - 1));
  });
});
