import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClassId } from '../content/classes';
import { CLASS_RULES } from '../content/abilities';
import { CLASS_EVENTS, STRESS } from '../content/events';
import { EXIT_OPENS_AT } from '../content/constants';
import { CORRIDOR_TIME, hopDistances, neighbours } from '../dungeon/gen';
import { monstersIn, spawnGroup } from './combat';
import { addToPile } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { RoomEvent } from './events';
import { speedOf } from './speed';

// These tests check exact stress amounts; the dungeon's steady background stress would blur them.
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
    choose(world, 'h', 'open');
    run(world, 5.5);
    expect(h.stress).toBe(0); // it takes a beat
    run(world, 0.6);
    expect(h.stress).toBe(20);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    expect(h.gold).toBe(20);
    expect(buildView(world, 'h').loot?.items).toHaveLength(1); // alone: up for you to pick up
  });

  it('idol: lots of gold, and the way you came in caves in', () => {
    const { world, h, d } = withEvent('idol');
    const next = neighbours(d, d.entrance)[0];
    // Walk out and back so we have a previous room.
    applyIntent(world, 'h', { type: 'goto', room: next });
    run(world, 9);
    world.events[next] = { room: next, kind: 'idol', done: false, progress: 0, by: null, spawned: false };
    choose(world, 'h', 'take');
    run(world, 6.2);
    expect(h.gold).toBeGreaterThanOrEqual(60);
    expect(world.collapsed.length).toBe(1);
    expect(h.knownCollapsed.length).toBe(1);
  });

  it('stranger needs a bandage; it either rewards or ambushes', () => {
    const { world, h, room } = withEvent('stranger');
    expect(buildView(world, 'h').event?.choices[0].disabled).toMatch(/no bandage/);
    h.items = ['bandage'];
    choose(world, 'h', 'help');
    run(world, 6.1);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    const ambushed = monstersIn(world, room).length > 0;
    const rewarded = h.gold > 0;
    expect(ambushed || rewarded).toBe(true);
  });

  it('crawlspace from Escalation 5 moves you toward the exit for a price', () => {
    const { world, h, d } = withEvent('crawlspace');
    world.escalation = 5;
    // Move the crawlspace (and the hero) somewhere deep: the exit is where everyone starts.
    const dist = hopDistances(d, d.exit);
    const far = dist.indexOf(Math.max(...dist.filter(Number.isFinite))); // (sealed secret rooms are at Infinity)
    world.events[far] = { ...world.events[d.entrance], room: far };
    delete world.events[d.entrance];
    h.pos = { kind: 'room', room: far };
    const hp = h.hp;
    choose(world, 'h', 'crawl');
    run(world, 6.1);
    expect(h.pos.kind === 'room' && dist[h.pos.room] === dist[far] - 3).toBe(true);
    expect(h.hp).toBe(hp - 4);
    expect(h.light).toBeLessThan(25);
  });

  it('crawlspace before Escalation 5 breaks into a secret room you have not seen, guards and all', () => {
    const { world, h, d } = withEvent('crawlspace');
    expect(d.secrets.every((s) => !s.open)).toBe(true);
    const hp = h.hp;
    choose(world, 'h', 'crawl');
    run(world, 6.1);
    const s = d.secrets.find((x) => h.pos.kind === 'room' && x.room === h.pos.room);
    expect(s?.open).toBe(true);
    expect(d.corridors[s!.corridor.id]).toBe(s!.corridor);
    expect(d.secrets.filter((x) => x.open)).toHaveLength(1);
    expect(h.hp).toBe(hp - 4);
    expect(h.encounter).toBe(s!.room); // its guards were waiting
    expect(h.light).toBeLessThan(25);
  });

  it('quicksilver: faster for the rest of the run, but frailer', () => {
    const { world, h } = withEvent('quicksilver', 'lampbearer');
    choose(world, 'h', 'quaff');
    run(world, 3.1); // not a multiple of 6: events can take any time now
    expect(speedOf(h, world.time)).toBe(3.5);
    expect(h.maxHp).toBe(39);
    run(world, 600);
    expect(speedOf(h, world.time)).toBe(3.5);
  });

  it("courier's satchel: gold for the one who hauls it, who is slower from then on", () => {
    const { world, h } = withEvent('satchel', 'cutthroat');
    choose(world, 'h', 'haul');
    run(world, 3.1);
    expect(h.gold).toBe(100);
    expect(speedOf(h, world.time)).toBe(4);
  });

  it('hourglass: everyone in the room is faster for a while', () => {
    const { world, h } = withEvent('hourglass', 'warden');
    const other = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    choose(world, 'h', 'turn');
    run(world, 3.1);
    expect(speedOf(h, world.time)).toBe(4.5);
    expect(speedOf(other, world.time)).toBe(2.5);
    run(world, 90.5);
    expect(speedOf(h, world.time)).toBe(6);
    expect(speedOf(other, world.time)).toBe(4);
  });

  it('clockwork shrine: a long wind for a lasting edge; Speed never drops below 2s', () => {
    const { world, h } = withEvent('clockwork', 'cutthroat');
    choose(world, 'h', 'wind');
    run(world, 6.5); // 20 ÷ Speed 3: the quick fumble it
    expect(speedOf(h, world.time)).toBe(3);
    run(world, 0.3);
    expect(speedOf(h, world.time)).toBe(2.5);
    h.speedMods.push({ amount: -3, until: null, label: 'test' });
    expect(speedOf(h, world.time)).toBe(2);
  });

  it('vault: a channel that starts over if interrupted', () => {
    const { world, h, room } = withEvent('vault', 'cutthroat');
    choose(world, 'h', 'channel');
    run(world, 4);
    expect(world.events[room].progress).toBeGreaterThan(0.15);
    applyIntent(world, 'h', { type: 'stop' });
    step(world, 0.1);
    expect(world.events[room].progress).toBe(0);
    choose(world, 'h', 'channel');
    run(world, 23.8);
    expect(world.events[room].done).toBe(false);
    run(world, 0.4);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    expect(h.gold).toBeGreaterThanOrEqual(30);
  });

  it('altar: guardians at 50%, then cleansing relieves everyone and pays out at the end', () => {
    const { world, h, room } = withEvent('altar', 'warden');
    h.stress = 50;
    choose(world, 'h', 'channel');
    run(world, 9.2);
    expect(h.encounter).toBe(room); // the guardians came at the halfway mark
    expect(monstersIn(world, room)[0].dmgMult).toBeGreaterThan(1); // one Escalation above the dungeon (Escalation 0 here)
    // Clear them and finish.
    for (const m of monstersIn(world, room)) delete world.monsters[m.id];
    run(world, 7);
    expect(h.encounter).toBeNull();
    // The Cleanse picks back up on its own after the fight.
    expect(h.channel?.kind).toBe('event');
    run(world, 9.2);
    expect(world.events[room].done).toBe(true);
    expect(world.objectives.altars).toBe(1);
    expect(h.stress).toBeLessThanOrEqual(30);
  });
});

describe('class twists', () => {
  it('shows the twist only to the class that has it', () => {
    const sorceress = withEvent('altar', 'sorceress');
    step(sorceress.world, 0.1);
    expect(buildView(sorceress.world, 'h').event?.choices[0].perk?.cls).toBe('sorceress');
    const warden = withEvent('altar', 'warden');
    step(warden.world, 0.1);
    expect(buildView(warden.world, 'h').event?.choices[0].perk).toBeUndefined();
  });

  it('Sorceress: cleanses the altar without waking its guardians', () => {
    const { world, h, room } = withEvent('altar', 'sorceress');
    choose(world, 'h', 'channel');
    run(world, 18.2);
    expect(h.encounter).toBeNull();
    expect(monstersIn(world, room)).toHaveLength(0);
    expect(world.events[room].done).toBe(true);
  });

  it('Sorceress: faster while Afflicted', () => {
    const { world, h } = withEvent('chest', 'sorceress');
    h.affliction = 'fearful';
    expect(speedOf(h, world.time)).toBe(4 + CLASS_RULES.sorceressAfflictedSpeed);
  });

  it('Cutthroat: takes the idol without a cave-in', () => {
    const { world, h, d } = withEvent('idol', 'cutthroat');
    const next = neighbours(d, d.entrance)[0];
    applyIntent(world, 'h', { type: 'goto', room: next });
    run(world, 9);
    world.events[next] = { room: next, kind: 'idol', done: false, progress: 0, by: null, spawned: false };
    choose(world, 'h', 'take');
    run(world, 6.2);
    expect(h.gold).toBeGreaterThanOrEqual(60);
    expect(world.collapsed).toHaveLength(0);
  });

  it('Lampbearer: helps the stranger with no bandage, and a trap never springs', () => {
    const { world, h, room } = withEvent('stranger', 'lampbearer');
    world.events[room].trap = true;
    step(world, 0.1);
    expect(buildView(world, 'h').event?.choices[0].disabled).toBeUndefined();
    choose(world, 'h', 'help');
    run(world, 6.2);
    expect(world.events[room].done).toBe(true);
    expect(monstersIn(world, room)).toHaveLength(0);
    step(world, 0.1);
    expect(h.gold).toBe(20);
  });

  it('Lampbearer: keeps their light through the crawlspace', () => {
    const { world, h } = withEvent('crawlspace', 'lampbearer');
    h.light = 80;
    choose(world, 'h', 'crawl');
    run(world, 6.1);
    expect(h.light).toBeGreaterThan(70);
  });

  it('Bellwright: the hourglass haste lasts the run, for everyone it touched', () => {
    const { world, h } = withEvent('hourglass', 'bellwright');
    const other = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    choose(world, 'h', 'turn');
    run(world, 3.1);
    run(world, 120);
    expect(speedOf(h, world.time)).toBe(5.5);
    expect(speedOf(other, world.time)).toBe(2.5);
  });

  it('Alchemist: quicksilver hardens instead of thinning', () => {
    const { world, h } = withEvent('quicksilver', 'alchemist');
    const maxHp = h.maxHp;
    choose(world, 'h', 'quaff');
    run(world, 3.1);
    expect(h.maxHp).toBe(maxHp + CLASS_EVENTS.alchemistQuicksilverMaxHp);
    expect(speedOf(h, world.time)).toBe(3.5);
  });

  it('Undertaker: no stress from the cursed chest', () => {
    const { world, h } = withEvent('chest', 'undertaker');
    choose(world, 'h', 'open');
    run(world, 6.2);
    expect(world.events[h.pos.kind === 'room' ? h.pos.room : -1].done).toBe(true);
    expect(h.stress).toBe(0);
  });

  it('Zealot: the well always gives stress and HP, never an affliction', () => {
    for (let i = 0; i < 6; i++) {
      const { world, h, room } = withEvent('well', 'zealot');
      for (let j = 0; j < i; j++) world.rng.float(0, 1); // a different roll each time
      h.hp = 10;
      choose(world, 'h', 'drink');
      run(world, 6.2);
      expect(world.events[room].done).toBe(true);
      expect(h.stress).toBe(CLASS_EVENTS.zealotWellStress);
      expect(h.hp).toBe(10 + CLASS_EVENTS.zealotWellHp);
      expect(h.affliction).toBeNull();
    }
  });
});

describe('the wounded stranger', () => {
  it('springs its trap on whoever walks away', () => {
    const { world, h, d, room } = withEvent('stranger', 'cutthroat');
    world.events[room].trap = true;
    applyIntent(world, 'h', { type: 'goto', room: neighbours(d, room)[0] });
    run(world, 3.2);
    expect(h.pos).toEqual({ kind: 'room', room });
    expect(h.encounter).toBe(room);
    expect(world.events[room].done).toBe(true);
  });

  it('lets you go if it was honest', () => {
    const { world, h, d, room } = withEvent('stranger', 'cutthroat');
    world.events[room].trap = false;
    applyIntent(world, 'h', { type: 'goto', room: neighbours(d, room)[0] });
    run(world, 3.2);
    expect(h.pos).not.toEqual({ kind: 'room', room });
    expect(h.encounter).toBeNull();
    expect(monstersIn(world, room)).toHaveLength(0);
  });
});

describe('timing', () => {
  it('an event starts when your timer runs out, and the next timer waits until it is done', () => {
    const { world, h, room } = withEvent('chest', 'warden');
    run(world, 2);
    applyIntent(world, 'h', { type: 'event', choice: 'open' });
    expect(h.queuedEvent).toBe('open');
    expect(h.channel).toBeNull();
    run(world, 3.9); // timer runs out at 6s
    expect(h.channel).toBeNull();
    run(world, 0.2);
    expect(h.channel?.kind).toBe('event');
    run(world, 6.1);
    expect(world.events[room].done).toBe(true);
    expect(h.turnStart).toBeCloseTo(12, 0); // the chest took 6s from 6s; the new timer started then
  });

  it('nothing picked: the turn is skipped and a new timer starts', () => {
    const { world, h } = withEvent('chest', 'warden');
    run(world, 6.1);
    expect(h.turnStart).toBeCloseTo(6);
    expect(h.turnAt).toBeCloseTo(12);
  });
});

describe('claims', () => {
  it('only the first hero to choose does the work; the others see who and what at once', () => {
    const { world, room } = withEvent('altar');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    choose(world, 'h', 'channel');
    const seen = buildView(world, 'o').event!;
    expect(seen.worker).toMatchObject({ name: 'H', doing: 'cleansing the altar', you: false });
    expect(seen.choices[0].disabled).toMatch(/H is already doing it/);
    expect(o.messages.some((m) => m.text.includes('H starts cleansing the altar'))).toBe(true);
    choose(world, 'o', 'channel');
    expect(o.channel).toBeNull(); // refused: not their burden
    // The worker walks away: the claim is free again, and the progress is lost.
    run(world, 3);
    applyIntent(world, 'h', { type: 'stop' });
    step(world, 0.1);
    expect(world.events[room].by).toBeNull();
    expect(world.events[room].progress).toBe(0);
    choose(world, 'o', 'channel');
    expect(world.events[room].by).toBe('o');
  });
});

describe('villagers', () => {
  function captive(cls: ClassId = 'bellwright') {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls });
    const d = world.dungeon;
    // One room out from the start (which is also the rendezvous).
    const room = neighbours(d, d.entrance)[0];
    h.pos = { kind: 'room', room };
    h.explored.push(room);
    world.villagers.v1 = { id: 'v1', room, leader: null, hp: 10, maxHp: 10, state: 'captive' };
    return { world, h, d, room };
  }

  it('follow their rescuer, slow them down, and are saved on reaching the rendezvous', () => {
    const { world, h, d } = captive();
    choose(world, 'h', 'lead');
    expect(h.leading).toBe('v1');
    applyIntent(world, 'h', { type: 'goto', room: d.exit });
    run(world, CORRIDOR_TIME + 0.2);
    expect(h.pos.kind).toBe('corridor'); // slower than normal
    run(world, CORRIDOR_TIME);
    // Delivered on reaching the rendezvous, even before the exit opens.
    expect(world.villagers.v1.state).toBe('saved');
    expect(world.objectives.villagers).toBe(1);
    expect(h.leading).toBeNull();
    world.time = EXIT_OPENS_AT;
    applyIntent(world, 'h', { type: 'extract' });
    step(world, 0.1);
    expect(h.gold).toBe(25); // the game ended (only hero out) → bonus paid
  });

  it('hurry a Warden along instead', () => {
    const { world, h } = captive('warden');
    step(world, 0.1);
    expect(buildView(world, 'h').event?.choices[0].perk?.cls).toBe('warden');
    choose(world, 'h', 'lead');
    expect(speedOf(h, world.time)).toBe(6 + CLASS_EVENTS.wardenEscortSpeed);
  });

  it('wait where their leader fell, and someone else can pick them up', () => {
    const { world, h, room } = captive();
    const other = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    other.pos = { kind: 'room', room };
    choose(world, 'h', 'lead');
    h.hp = 0;
    h.downedAt = world.time;
    step(world, 0.1);
    expect(world.villagers.v1.state).toBe('waiting');
    choose(world, 'o', 'lead');
    expect(other.leading).toBe('v1');
  });
});

describe('stress and afflictions', () => {
  it('darkness raises stress; 100 means an affliction, the second 100 a heart attack', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false });
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
    const world = createWorld(31, { monsters: false, loot: false, escalates: false });
    const s = addHero(world, { id: 's', name: 'S', cls: 'warden' });
    addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    s.affliction = 'selfish';
    addToPile(world, world.dungeon.entrance, 0, ['torch']);
    step(world, 0.1);
    const item = world.piles[world.dungeon.entrance].items[0].id;
    applyIntent(world, 'o', { type: 'vote', item, choice: 'o' });
    applyIntent(world, 's', { type: 'vote', item, choice: 'o' }); // refused
    run(world, 2);
    expect(world.heroes.o.items).toEqual([]);
    run(world, 9);
    expect(world.heroes.o.items).toEqual(['torch']);
  });

  it('Paranoid heroes refuse bandages from others', () => {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false });
    const p = addHero(world, { id: 'p', name: 'P', cls: 'warden' });
    const o = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
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
