import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClassId } from '../content/classes';
import { CROWNED, MORE_EVENTS, STRESS } from '../content/events';
import { ENEMIES, KING_RULES, type EnemyId } from '../content/enemies';
import { ITEMS, itemTier, LOOT } from '../content/items';
import { hopDistances, neighbours } from '../dungeon/gen';
import { monsterBlock, monsterSpeed, onHeroInRoom, spawnGroup } from './combat';
import { wornCharge } from './gear';
import { equip } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { RoomEvent } from './events';

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
  const room = world.dungeon.entrance;
  world.events[room] = { room, kind, done: false, progress: 0, by: null, spawned: false };
  return { world, h, room };
}

describe('Twin Locks', () => {
  it('needs two heroes turning at once; either letting go starts it over', () => {
    const { world, room } = withEvent('locks');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    choose(world, 'h', 'wheel');
    run(world, 20);
    const ev = world.events[room];
    expect(ev.progress).toBe(0); // one pair of hands turns nothing
    const seen = buildView(world, 'o').event!;
    expect(seen.worker).toMatchObject({ name: 'H', secondsLeft: null });
    expect(seen.worker!.doing).toMatch(/waiting for a second/);
    expect(seen.choices[0]).toMatchObject({ id: 'wheel' });
    expect(seen.choices[0].disabled).toBeUndefined();
    expect(seen.choices[0].label).toMatch(/other wheel, with H/);

    choose(world, 'o', 'wheel');
    expect(ev.with).toBe('o');
    run(world, 6);
    expect(ev.progress).toBeGreaterThan(0.4);
    // The second lets go: it starts over, and the first still holds their wheel.
    applyIntent(world, 'o', { type: 'stop' });
    step(world, 0.1);
    expect(ev.progress).toBe(0);
    expect(ev.by).toBe('h');
    expect(ev.with).toBeNull();

    choose(world, 'o', 'wheel');
    run(world, MORE_EVENTS.locksTime + 0.5);
    expect(ev.done).toBe(true);
    expect(world.heroes.h.channel).toBeNull();
    expect(o.channel).toBeNull();
    const items = world.piles[room].items.map((f) => f.item);
    expect(items).toContain('relic');
    expect(items).toHaveLength(2); // and a quality-3 find, as a vault gives
  });

  it('if the first lets go, the second keeps hold and waits for someone new', () => {
    const { world, room } = withEvent('locks');
    addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    choose(world, 'h', 'wheel');
    choose(world, 'o', 'wheel');
    run(world, 3);
    applyIntent(world, 'h', { type: 'stop' });
    step(world, 0.1);
    const ev = world.events[room];
    expect(ev).toMatchObject({ by: 'o', with: null, progress: 0 });
  });

  it('a third hero is refused while both wheels are held', () => {
    const { world } = withEvent('locks');
    addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    addHero(world, { id: 'p', name: 'P', cls: 'zealot' });
    choose(world, 'h', 'wheel');
    choose(world, 'o', 'wheel');
    expect(buildView(world, 'p').event!.choices[0].disabled).toMatch(/Both wheels/);
  });
});

describe('Open Coffin', () => {
  it('stress to 0, but down until someone revives you: no injury, no one shaken, no HP lost', () => {
    const { world, h } = withEvent('coffin');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'lampbearer' });
    h.stress = 40;
    h.hp = h.maxHp - 5;
    choose(world, 'h', 'lie');
    run(world, MORE_EVENTS.coffinTime + 0.2);
    expect(h.stress).toBe(0);
    expect(h.downedAt).not.toBeNull();
    expect(o.stress).toBe(0);
    run(world, 2);
    expect(h.runInjuries).toEqual([]);
    expect(h.downedMajor).toBe(false);
    applyIntent(world, 'o', { type: 'revive', target: 'h' });
    run(world, 8);
    expect(h.downedAt).toBeNull();
    expect(h.hp).toBe(h.maxHp - 5);
    expect(h.restHp).toBeNull();
  });

  it('alone, nobody comes: you die', () => {
    const { world, h } = withEvent('coffin');
    h.stress = 30;
    choose(world, 'h', 'lie');
    run(world, 45);
    expect(h.dead).toBe(true);
  });

  it('is refused with nothing weighing on you', () => {
    const { world } = withEvent('coffin');
    expect(buildView(world, 'h').event!.choices[0].disabled).toMatch(/Nothing weighs/);
  });
});

describe("Smith's Anvil", () => {
  it('reforges a graded piece into the next one up its list', () => {
    const { world, h } = withEvent('anvil');
    equip(h, 'weapon', 'dirk');
    equip(h, 'armor', 'drakehide'); // a Rare: not offered
    const v = buildView(world, 'h').event!;
    expect(v.choices.map((c) => c.id)).toEqual(['forge-weapon']);
    expect(v.choices[0].label).toMatch(/Rusty Dirk into a Skinning Knife/);
    choose(world, 'h', 'forge-weapon');
    run(world, MORE_EVENTS.anvilTime + 0.5);
    expect(h.weapon).toBe('knife');
  });

  it('anything without a next piece becomes a random piece of its kind, one rarity up', () => {
    const { world, h } = withEvent('anvil');
    equip(h, 'weapon', 'censer');
    equip(h, 'amulet', 'locket'); // uncommon
    const maxHp = h.maxHp;
    expect(buildView(world, 'h').event!.choices.map((c) => c.label).join(' ')).toMatch(/random uncommon Staff.*random rare amulet/);
    choose(world, 'h', 'forge-amulet');
    run(world, MORE_EVENTS.anvilTime + 0.5);
    expect(ITEMS[h.amulet!].kind).toBe('amulet');
    expect(itemTier(h.amulet!)).toBe(3);
    expect(h.maxHp).toBe(maxHp - 20 + (ITEMS[h.amulet!].maxHp ?? 0)); // the Locket's +20 is gone
    expect(h.weapon).toBe('censer'); // only the one chosen
  });

  it('cloth comes out fresh, and the old charge is gone', () => {
    const { world, h } = withEvent('anvil');
    equip(h, 'armor', 'patchwork');
    choose(world, 'h', 'forge-armor');
    run(world, MORE_EVENTS.anvilTime + 0.5);
    expect(ITEMS[h.armor!].gearType).toBe('cloth');
    expect(itemTier(h.armor!)).toBe(2);
    expect(h.packCharges).toEqual([]);
    expect(wornCharge(h, 'armor')!.cdLeft).toBe(0);
  });

  it('has nothing to offer someone wearing only Rares', () => {
    const { world, h } = withEvent('anvil');
    equip(h, 'weapon', 'giantmaul');
    expect(buildView(world, 'h').event!.choices[0].disabled).toMatch(/Rares/);
  });
});

describe('The Loom', () => {
  it('mends spent Cloth, Call for Help and burned cards', () => {
    const { world, h } = withEvent('loom');
    equip(h, 'armor', 'gravecloth');
    wornCharge(h, 'armor')!.usesLeft = 0;
    h.calledAt = world.time;
    h.burned = ['dance'];
    expect(buildView(world, 'h').event!.choices[0].label).toMatch(/Gravecloth, Call for Help, burned cards \(Blade Dance\)/);
    choose(world, 'h', 'weave');
    run(world, 6.5);
    expect(wornCharge(h, 'armor')!.usesLeft).toBe(1);
    expect(h.calledAt).toBeNull();
    expect(h.burned).toEqual([]);
  });

  it('is refused when nothing is worn thin', () => {
    const { world } = withEvent('loom');
    expect(buildView(world, 'h').event!.choices[0].disabled).toMatch(/worn thin/);
  });
});

describe('Scrying Pool', () => {
  it('shows every ally, and the room they are in, for a while; they are none the wiser', () => {
    const { world, room } = withEvent('scrying');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'lampbearer' });
    const dist = hopDistances(world.dungeon, room);
    const far = world.dungeon.rooms.filter((r) => r.kind === 'normal' && dist[r.id] >= 3)[0].id;
    o.pos = { kind: 'room', room: far };
    spawnGroup(world, far, ['ghoul'], 0);
    step(world, 0.1);
    const ally = () => buildView(world, 'h').allies.find((a) => a.id === 'o')!;
    expect(ally().live).toBe(false);
    choose(world, 'h', 'gaze');
    run(world, MORE_EVENTS.scryTime + 0.2);
    expect(ally().live).toBe(true);
    expect(ally().pos).toEqual({ kind: 'room', room: far });
    const seen = buildView(world, 'h').rooms.find((r) => r.id === far);
    expect(seen).toBeTruthy();
    expect(world.heroes.h.knownThreat[far]).toBe(1);
    expect(o.messages.some((m) => m.text.includes('pool'))).toBe(false);
    run(world, MORE_EVENTS.scrySecs);
    expect(ally().live).toBe(false);
  });
});

describe('Twin Locks, Swiftwork', () => {
  it('turns in 3s if either pair of hands has a Hastening Robe ready, spending one', () => {
    const { world, room } = withEvent('locks');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'sorceress' });
    equip(o, 'armor', 'hastening');
    choose(world, 'h', 'wheel');
    expect(buildView(world, 'o').event!.choices[0].label).toMatch(/\(3s together\)/);
    choose(world, 'o', 'wheel');
    expect(wornCharge(o, 'armor')!.cdLeft).toBeGreaterThan(0);
    run(world, 3.3);
    expect(world.events[room].done).toBe(true);
    step(world, 0.1);
    expect(world.heroes.h.gold + o.gold).toBeGreaterThanOrEqual(MORE_EVENTS.locksGold[0] - 1); // split, rounded down
  });
});

describe('the Dead King', () => {
  function court(extra: EnemyId[] = []) {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
    // Nobody here who could Stun him and skip his turn.
    const h = addHero(world, { id: 'h', name: 'H', cls: 'zealot' });
    h.maxHp = h.hp = 500;
    const room = world.dungeon.entrance;
    const [king, ...rest] = spawnGroup(world, room, ['king', ...extra], 0);
    return { world, h, room, king, rest };
  }

  it('wears 3 armor for every other monster still standing beside him', () => {
    const { world, king, rest } = court(['ghoul', 'ghoul']);
    expect(monsterBlock(world, king)).toBe(2 * KING_RULES.blockPerCourtier);
    delete world.monsters[rest[0].id];
    expect(monsterBlock(world, king)).toBe(KING_RULES.blockPerCourtier);
  });

  it('takes turns between Kneel (every hero Stunned) and Charge (every monster quicker, a blow to the nearest)', () => {
    const { world, h, room, king } = court();
    const o = addHero(world, { id: 'o', name: 'O', cls: 'lampbearer' });
    o.maxHp = o.hp = 500;
    king.cycle = 'kneel';
    onHeroInRoom(world, h, room);
    const enc = world.encounters[room];
    run(world, ENEMIES.king.speed + 0.05);
    expect(enc.log.some((l) => l.includes('bids them kneel'))).toBe(true);
    expect(king.cycle).toBe('charge');
    const hp = h.hp + o.hp;
    run(world, ENEMIES.king.speed);
    expect(enc.charge).toBe(1);
    expect(monsterSpeed(enc, king)).toBe(ENEMIES.king.speed - KING_RULES.chargeHaste);
    expect(h.hp + o.hp).toBeLessThan(hp);
    expect(king.cycle).toBe('kneel');
  });
});

describe('Crowned in Dread', () => {
  it('sends the procession from a room farthest from the exit, toward it; everyone hears who woke him', () => {
    const world = createWorld(31, { monsters: false, loot: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden' });
    const o = addHero(world, { id: 'o', name: 'O', cls: 'lampbearer' });
    const d = world.dungeon;
    const room = neighbours(d, d.entrance)[0];
    h.pos = { kind: 'room', room };
    world.events[room] = { room, kind: 'crowned', done: false, progress: 0, by: null, spawned: false };
    choose(world, 'h', 'rouse');
    run(world, 6.2);
    const court = Object.values(world.monsters).filter((m) => m.procession);
    expect(court.map((m) => m.type).sort()).toEqual([...CROWNED.procession].sort());
    const start = court[0].room;
    const dist = hopDistances(d, d.exit);
    const farthest = Math.max(...d.rooms.filter((r) => r.kind === 'normal' && r.id !== room).map((r) => dist[r.id]));
    expect(dist[start]).toBe(farthest);
    expect(o.messages.some((m) => m.text.includes('H has woken the Dead King'))).toBe(true);
    expect(o.seen).toContain(start);
    const pack = Object.values(world.packs).find((p) => p.monsters.includes(court[0].id))!;
    expect(pack.goal).toBe(d.exit);
    run(world, 40);
    expect(dist[pack.to ?? pack.room]).toBeLessThan(dist[start]);
  });

  it('is never in the dungeon when a Relic Rite wakes the King anyway', () => {
    let crowned = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const plain = Object.values(createWorld(seed).events).filter((e) => e.kind === 'crowned').length;
      const rite = Object.values(createWorld(seed, { relicRite: true }).events).filter((e) => e.kind === 'crowned').length;
      crowned += plain;
      expect(rite).toBe(0);
    }
    expect(crowned).toBeGreaterThan(0);
  });

  it("the last of the procession to fall drops two Lairs' worth and a Legendary", () => {
    const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
    const h = addHero(world, { id: 'h', name: 'H', cls: 'warden' });
    const room = world.dungeon.entrance;
    const [m] = spawnGroup(world, room, ['crawler'], 0);
    m.procession = true;
    onHeroInRoom(world, h, room);
    run(world, 40);
    expect(world.monsters[m.id]).toBeUndefined();
    expect(h.gold).toBeGreaterThanOrEqual(CROWNED.lairs * LOOT.lairGold[0]);
    const found = [...(world.piles[room]?.items.map((f) => f.item) ?? []), ...h.items, h.weapon, h.armor, h.amulet, h.ring];
    expect(found.filter((it) => it && ITEMS[it].legend)).toHaveLength(CROWNED.legendaries);
  });
});
