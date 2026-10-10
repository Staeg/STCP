import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRESS } from '../content/events';
import { CLASS_RULES, abilityById } from '../content/abilities';
import { CLASSES } from '../content/classes';
import { EXIT_OPENS_AT } from '../content/constants';
import { hopDistances, neighbours } from '../dungeon/gen';
import { combatOrder, damageMult, fieldTurn, knellDamage, spawnGroup } from './combat';
import { speedOf } from './speed';
import { dropEverything } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, digTime, extractHero, step, type World } from './world';
import type { ClassId } from '../content/classes';
import type { EnemyId } from '../content/enemies';

// These tests check exact stress amounts; the dungeon's steady background stress would blur them.
const baseStress = STRESS.basePerSec;
beforeEach(() => void (STRESS.basePerSec = 0));
afterEach(() => void (STRESS.basePerSec = baseStress));

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

function arena(classes: ClassId[], enemies: EnemyId[]) {
  const world = createWorld(777, { monsters: false, loot: false });
  const d = world.dungeon;
  const ids = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(world, room, enemies, 0);
  for (const m of monsters) m.hp = m.maxHp = 999;
  return { world, d, ids, room, monsters };
}

function untilTurn(world: World, room: number, id: string) {
  const enc = world.encounters[room];
  if (!enc) return;
  const due = enc.next[id];
  for (let i = 0; i < 300 && world.encounters[room] === enc && enc.next[id] === due; i++) step(world, 0.1);
}

function walkIn(world: World, ids: string[], room: number) {
  for (const id of ids) applyIntent(world, id, { type: 'goto', room });
  for (let i = 0; i < 100 && ids.some((id) => world.heroes[id].encounter === null); i++) step(world, 0.1);
}

/** A quiet world (no monsters, loot or escalation) with these heroes at the start. */
function quiet(classes: ClassId[], escalates = false) {
  const world = createWorld(5, { monsters: false, loot: false, escalates, events: false });
  const heroes = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }));
  return { world, heroes };
}

describe('line-ups and targeting', () => {
  it('sorts each side slowest-nearest: heroes fastest → slowest, monsters slowest → fastest', () => {
    const { world, ids, room } = arena(['warden', 'cutthroat', 'lampbearer'], ['ghoul', 'brute', 'crawler']);
    walkIn(world, ids, room);
    const order = combatOrder(world, world.encounters[room]);
    expect(order.heroes.map((h) => h.cls)).toEqual(['cutthroat', 'lampbearer', 'warden']);
    expect(order.monsters.map((m) => m.type)).toEqual(['brute', 'ghoul', 'crawler']);
  });

  it('monsters hit the rightmost (slowest) hero', () => {
    const { world, ids, room, monsters } = arena(['cutthroat', 'sorceress', 'warden'], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    for (let k = 0; k < 3; k++) untilTurn(world, room, monsters[0].id);
    const hits = enc.events.filter((e) => e.actor === monsters[0].id && e.kind === 'damage').map((e) => e.target);
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits)).toEqual(new Set(['h2']));
  });
});

describe('poison and acid', () => {
  it('runs each Poison on its own, and Acid adds to every tick', () => {
    const { world, ids, room, monsters } = arena(['warden'], ['ghoul']);
    walkIn(world, ids, room);
    const m = monsters[0];
    m.st.poison = [{ dmg: 2, rounds: 2 }, { dmg: 3, rounds: 1 }];
    m.st.acid = { stacks: 2, turns: 1 };
    const enc = world.encounters[room];
    untilTurn(world, room, m.id);
    const ticks = enc.events.filter((e) => e.actor === m.id && e.text.includes('poison damage')).map((e) => e.amount);
    expect(ticks).toEqual([2 + 2 * CLASS_RULES.acidBonus, 3 + 2 * CLASS_RULES.acidBonus]);
    expect(m.st.poison).toEqual([{ dmg: 2, rounds: 1 }]);
    // The timer ran out: one stack fades and the other gets a fresh timer.
    expect(m.st.acid).toEqual({ stacks: 1, turns: CLASS_RULES.acidTurns });
  });
});

describe('Undertaker', () => {
  it('Last Rites only targets the wounded and kills outright; Raise brings the dead back to soak hits', () => {
    const { world, ids, room, monsters } = arena(['undertaker'], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    expect(buildView(world, 'h0').encounter!.yourOptions.a1!.targets).toEqual([]);
    monsters[0].hp = 998;
    expect(buildView(world, 'h0').encounter!.yourOptions.a1!.targets).toEqual([monsters[0].id]);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: monsters[0].id } });
    untilTurn(world, room, 'h0');
    expect(world.monsters[monsters[0].id]).toBeUndefined();
    expect(enc.lastSlain?.type).toBe('ghoul');

    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a2' } });
    untilTurn(world, room, 'h0');
    expect(enc.risen?.type).toBe('ghoul');
    const risen = enc.risen!;
    expect(buildView(world, 'h0').encounter!.risen?.id).toBe(risen.id);
    untilTurn(world, room, monsters[1].id);
    const last = enc.events.filter((e) => e.actor === monsters[1].id && e.kind === 'damage').at(-1);
    expect(last?.target).toBe(risen.id);
  });

  it('digs through rubble in one turn of their own; others take the full dig time', () => {
    const { world, heroes } = quiet(['undertaker', 'warden']);
    expect(digTime(heroes[0], world.time)).toBe(CLASSES.undertaker.speed);
    expect(digTime(heroes[1], world.time)).toBe(18);
  });

  it("gathers a fallen ally's gold and gear, and their gold reaches the dead hero's results if the Undertaker escapes", () => {
    const { world, heroes } = quiet(['undertaker', 'cutthroat']);
    const [u, c] = heroes;
    c.gold = 50;
    c.items.push('bandage');
    c.dead = true;
    dropEverything(world, c);
    run(world, 0.2);
    expect(u.bodies[c.id]).toBe(50);
    expect(u.items).toContain('bandage');
    expect(u.gold).toBe(0);
    world.time = EXIT_OPENS_AT;
    extractHero(world, u);
    expect(c.legacy).toBe(50);
  });
});

describe('Bellwright', () => {
  it('Clang pushes the target back; Knell weakens with every ally and is blocked with 3', () => {
    const { world, ids, room, monsters } = arena(['bellwright'], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0' } });
    untilTurn(world, room, monsters[0].id); // the Ghoul (Speed 5) goes before the Bellwright (Speed 7)
    const before = enc.next[monsters[0].id];
    untilTurn(world, room, 'h0');
    expect(enc.next[monsters[0].id]).toBeCloseTo(before + CLASS_RULES.clangDelay);
    const knell = abilityById('knell')!.power;
    expect(knellDamage(knell, 0)).toBe(knell);
    expect(knellDamage(knell, 2)).toBe(knell - 2 * CLASS_RULES.knellPerAlly);
    expect(knellDamage(knell, 3)).toBe(0);

    const four = arena(['bellwright', 'warden', 'sorceress', 'cutthroat'], ['ghoul']);
    walkIn(four.world, four.ids, four.room);
    expect(buildView(four.world, 'h0').encounter!.yourOptions.a1!.blocked).toBeTruthy();
  });

  it('Clang stacks −1s Speed on the Bellwright; each 2 turns without Clanging one stack fades', () => {
    const { world, ids, room } = arena(['bellwright'], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.st.clang = { stacks: 2, turns: 1 };
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0' } });
    untilTurn(world, room, 'h0');
    // Its turn started (one stack faded) and the Clang added one back, with a fresh timer.
    expect(h.st.clang).toEqual({ stacks: 2, turns: CLASS_RULES.clangTurns });
    expect(speedOf(h, world.time)).toBeCloseTo(CLASSES.bellwright.speed - 2 * CLASS_RULES.clangHaste);
  });

  it('timed statuses outlast the fight and tick in the field; Poison keeps hurting', () => {
    const { world, ids } = arena(['bellwright'], ['ghoul']);
    const h = world.heroes[ids[0]];
    h.st = { clang: { stacks: 1, turns: 2 }, poison: [{ dmg: 3, rounds: 2 }], weak: 1, stun: true, block: 5 };
    h.cooldowns = {};
    const hp = h.hp;
    fieldTurn(world, h);
    expect(h.hp).toBe(hp - 3);
    expect(h.st.weak).toBeUndefined();
    expect(h.st.clang).toEqual({ stacks: 1, turns: 1 });
    fieldTurn(world, h);
    expect(h.hp).toBe(hp - 6);
    expect(h.st.poison).toBeUndefined();
    expect(h.st.clang).toBeUndefined();
  });

  it('Toll: after the timer, every ally sees the Bellwright live and monsters next door come to the bell', () => {
    const { world, heroes } = quiet(['bellwright', 'warden'], true); // packs only move with escalation on
    const d = world.dungeon;
    const hops = hopDistances(d, d.entrance);
    const far = d.rooms.find((r) => hops[r.id] >= 4)!.id;
    heroes[1].pos = { kind: 'room', room: far };
    const next = neighbours(d, d.entrance)[0];
    const [ghoul] = spawnGroup(world, next, ['ghoul'], 0);
    applyIntent(world, 'h0', { type: 'skill' });
    expect(world.tolls).toHaveLength(0); // waits for the timer
    run(world, CLASSES.bellwright.speed + 0.2);
    expect(world.tolls).toHaveLength(1);
    expect(heroes[1].lastKnown.h0.time).toBe(world.time);
    expect(buildView(world, 'h1').tolls[0].room).toBe(d.entrance);
    expect(world.monsters[ghoul.id].room).toBe(-1); // on its way
    run(world, 10);
    expect(heroes[0].encounter).toBe(d.entrance);
  });
});

describe('Zealot', () => {
  it('hits harder with stress (times the weapon bonus) and never breaks', () => {
    const { world, heroes } = quiet(['zealot']);
    const z = heroes[0];
    z.stress = 50;
    z.weapon = 'shortsword';
    expect(damageMult(z)).toBeCloseTo(1.1 * (1 + 50 * CLASS_RULES.zealotDmgPerStress));
    z.stress = 100;
    run(world, 1);
    expect(z.affliction).toBeNull();
    expect(z.downedAt).toBeNull();
  });

  it('Take Their Sins works outside a fight, using up a turn', () => {
    const { world, heroes } = quiet(['zealot', 'warden']);
    heroes[1].stress = 40;
    applyIntent(world, 'h0', { type: 'skill', target: 'h1' });
    expect(heroes[1].stress).toBe(40);
    run(world, CLASSES.zealot.speed + 0.2);
    expect(heroes[1].stress).toBe(15);
    expect(heroes[0].stress).toBe(25);
    expect(heroes[0].cooldowns.sins).toBe(2); // the same cooldown as in a fight
  });
});

describe('Alchemist', () => {
  it('Elixir (out of a fight, on herself) doubles the next item', () => {
    const { world, heroes } = quiet(['alchemist']);
    const a = heroes[0];
    a.hp = 10;
    applyIntent(world, 'h0', { type: 'skill', target: 'h0' });
    run(world, CLASSES.alchemist.speed + 0.2);
    expect(a.elixir).toBe(true);
    a.items = ['bandage'];
    applyIntent(world, 'h0', { type: 'useItem', index: 0 });
    while (a.queuedItem) run(world, 0.1);
    expect(a.hp).toBe(34);
    expect(a.elixir).toBe(false);
  });

  it('brews a consumable every minute while there is room in the pack', () => {
    const { world, heroes } = quiet(['alchemist']);
    run(world, CLASS_RULES.brewEvery - 1);
    expect(heroes[0].items).toHaveLength(0);
    run(world, 1.5);
    expect(heroes[0].items).toHaveLength(1);
  });
});

describe('party', () => {
  it('gives a second hero of the same class a different colour', () => {
    const { heroes } = quiet(['warden', 'warden']);
    expect(heroes[0].color).toBe(CLASSES.warden.color);
    expect(heroes[1].color).not.toBe(heroes[0].color);
  });
});

describe('reworked kits', () => {
  it('Backstab crits an enemy that has not acted yet; Cheap Shot always stuns', () => {
    const { world, ids, room, monsters } = arena(['cutthroat'], ['brute', 'ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const [brute, ghoul] = monsters;
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: brute.id } });
    untilTurn(world, room, 'h0');
    expect(enc.events.find((e) => e.actor === 'h0' && e.kind === 'damage')).toMatchObject({ amount: 2 * abilityById('backstab')!.power, crit: true });
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: ghoul.id } });
    untilTurn(world, room, 'h0');
    expect(ghoul.st.stun).toBe(true);
  });

  it('Smoke Bomb covers every ally for 6 seconds, not turns', () => {
    const { world, ids, room } = arena(['cutthroat', 'warden'], ['ghoul']);
    walkIn(world, ids, room);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a2' } });
    untilTurn(world, room, 'h0');
    const until = world.time + CLASS_RULES.smokeSecs;
    for (const id of ids) expect(world.heroes[id].st.dodge).toBeCloseTo(until, 1);
  });

  it('Hex stacks: each Hexed adds +100% to the next Hex, for 2 of the target\'s turns', () => {
    const { world, ids, room, monsters } = arena(['sorceress'], ['brute']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const hexes = () => enc.events.filter((e) => e.actor === 'h0' && e.kind === 'damage').map((e) => e.amount);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
    untilTurn(world, room, 'h0');
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
    untilTurn(world, room, 'h0');
    const hex = abilityById('hex')!.power;
    expect(hexes()).toEqual([hex, 2 * hex]);
    // The Brute (Speed 8) took its turn right after the second Hex (same moment): both stacks ticked once.
    expect(monsters[0].st.hexed).toEqual([1, 1]);
    world.heroes.h0.cooldowns = { hex: 99, pact: 99, wither: 99 }; // just brace from here
    untilTurn(world, room, monsters[0].id);
    expect(monsters[0].st.hexed).toBeUndefined();
  });

  it('Wither weakens every enemy; Blood Pact hits every enemy for 15 and bleeds every ally (never below 1)', () => {
    const { world, ids, room, monsters } = arena(['sorceress', 'warden'], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    const [sorceress, warden] = ids.map((id) => world.heroes[id]);
    warden.hp = 3;
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1' } });
    untilTurn(world, room, 'h0');
    expect(monsters.map((m) => m.hp)).toEqual([999 - 15, 999 - 15]);
    expect(sorceress.hp).toBe(sorceress.maxHp - CLASS_RULES.pactCost);
    expect(warden.hp).toBe(1);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a2' } });
    untilTurn(world, room, 'h0');
    for (const m of monsters) expect(m.st.weak).toBeGreaterThan(0);
  });

  it('Mend cannot target the Lampbearer; a lone Vigil answers every enemy action with a free Flare', () => {
    const { world, ids, room, monsters } = arena(['lampbearer'], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    expect(buildView(world, 'h0').encounter!.yourOptions.a2!.targets).toEqual([]);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: 'h0' } });
    untilTurn(world, room, 'h0'); // the Ghoul (also Speed 5) acts right after, at the same moment
    expect(world.heroes.h0.st.vigil).toBe('h0');
    expect(enc.events.some((e) => e.text.includes('answers with a flare'))).toBe(true);
    expect(monsters[0].hp).toBe(999 - abilityById('flare')!.power);
    expect(world.heroes.h0.cooldowns.flare).toBeUndefined(); // free
  });

  it('the Lampbearer uses Mend, Vigil and Flare outside fights, on the shared cooldowns, and their light fades at half rate', () => {
    const { world, heroes } = quiet(['lampbearer', 'warden']);
    const [lamp, warden] = heroes;
    warden.hp = 20;
    lamp.stress = 30;
    applyIntent(world, 'h0', { type: 'skill', skill: 'mend', target: 'h0' });
    expect(lamp.queuedSkill).toBeNull(); // not on yourself
    applyIntent(world, 'h0', { type: 'skill', skill: 'mend', target: 'h1' });
    run(world, CLASSES.lampbearer.speed + 0.2);
    expect(warden.hp).toBe(20 + abilityById('mend')!.power);
    expect(lamp.cooldowns.mend).toBe(1);
    applyIntent(world, 'h0', { type: 'skill', skill: 'vigil', target: 'h0' });
    run(world, CLASSES.lampbearer.speed);
    expect(lamp.stress).toBe(30 - abilityById('vigil')!.power);
    expect(lamp.cooldowns.mend).toBeUndefined(); // ticked off by a turn's worth of time
    expect(lamp.light).toBeGreaterThan(warden.light);
    const dark = warden.light;
    applyIntent(world, 'h0', { type: 'skill', skill: 'flare' });
    run(world, CLASSES.lampbearer.speed);
    expect(warden.light).toBeGreaterThan(dark);
  });

  it('every Last Rites kill makes the Spade hit 1 harder for the rest of the run', () => {
    const { world, ids, room, monsters } = arena(['undertaker'], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const [a, b] = monsters;
    a.hp = 500;
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: a.id } });
    untilTurn(world, room, 'h0');
    expect(world.monsters[a.id]).toBeUndefined();
    expect(world.heroes.h0.spadeBonus).toBe(1);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: b.id } });
    untilTurn(world, room, 'h0');
    expect(enc.events.filter((e) => e.actor === 'h0' && e.kind === 'damage').at(-1)!.amount).toBe(abilityById('spade')!.power + 1);
  });
});
