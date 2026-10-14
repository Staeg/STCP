import { describe, expect, it } from 'vitest';
import { CLASS_RULES } from '../content/innates';
import { CARD_RULES } from '../content/cards';
import { setHand } from './testkit';
import { CLASSES } from '../content/classes';
import { hopDistances, neighbours } from '../dungeon/gen';
import { dieOut, combatOrder, damageMult, fieldTurn, spawnGroup } from './combat';
import { carriedHome } from './emergency';
import { speedOf } from './speed';
import { dropEverything } from './loot';
import { buildView } from './views';
import { checkSkill } from './skills';
import { eventChoices } from './events';
import { addHero, applyIntent, createWorld, digTime, extractHero, step, type World } from './world';
import type { ClassId } from '../content/classes';
import { ENEMIES, type EnemyId } from '../content/enemies';



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
    const { world, ids, room } = arena(['warden', 'cutthroat', 'lampbearer'], ['ghoul', 'giant', 'crawler']);
    walkIn(world, ids, room);
    const order = combatOrder(world, world.encounters[room]);
    expect(order.heroes.map((h) => h.cls)).toEqual(['cutthroat', 'lampbearer', 'warden']);
    expect(order.monsters.map((m) => m.type)).toEqual(['giant', 'ghoul', 'crawler']);
  });

  it('monsters hit the rightmost (slowest) hero', () => {
    const { world, ids, room, monsters } = arena(['cutthroat', 'sorceress', 'warden'], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    for (const id of ids) enc.next[id] = world.time + 999; // the heroes hold still (and summon nothing)
    for (let k = 0; k < 3; k++) untilTurn(world, room, monsters[0].id);
    const hits = enc.events.filter((e) => e.actor === monsters[0].id && e.kind === 'damage' && e.target !== monsters[0].id).map((e) => e.target);
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
    expect(ticks).toEqual([2 + 2 * CARD_RULES.acidBonus, 3 + 2 * CARD_RULES.acidBonus]);
    expect(m.st.poison).toEqual([{ dmg: 2, rounds: 1 }]);
    // The timer ran out: one stack fades and the other gets a fresh timer.
    expect(m.st.acid).toEqual({ stacks: 1, turns: CARD_RULES.acidTurns });
  });
});

describe('monster armor', () => {
  it('takes its armor off every hit (at least 1 gets through); only the Bone Giant has any', () => {
    expect(Object.values(ENEMIES).filter((e) => e.block > 0).map((e) => [e.id, e.block])).toEqual([['giant', 3]]);
    const { world, ids, room, monsters } = arena(['warden'], ['giant']);
    walkIn(world, ids, room);
    const giant = monsters[0];
    setHand(world.heroes[ids[0]], ['bash']);
    applyIntent(world, ids[0], { type: 'combat', choice: { action: 'card', card: 'bash' } });
    untilTurn(world, room, ids[0]);
    const hit = world.encounters[room].events.find((e) => e.actor === ids[0] && e.kind === 'damage' && e.target === giant.id)!;
    expect(hit.amount).toBe(CARD_RULES.bash - 3);
  });

  it("a risen keeps its kind's armor, and a Risen ally's armor counts", () => {
    const { world, ids, room, monsters } = arena(['undertaker', 'warden'], ['ghoul']);
    const [u, w] = ids.map((id) => world.heroes[id]);
    w.armor = 'studded';
    w.dead = true;
    dropEverything(world, w);
    run(world, 0.2);
    walkIn(world, [u.id], room);
    const enc = world.encounters[room];
    enc.legion!.push({ id: 'rb', by: u.id, type: 'giant', hp: 50, maxHp: 50, dmgMult: 1, turns: 1, permanent: true });
    const ghoul = monsters[0];
    const hits = () => enc.events.filter((e) => e.actor === ghoul.id && e.kind === 'damage');
    for (let i = 0; i < 6 && !hits().some((e) => e.target === 'rb'); i++) untilTurn(world, room, ghoul.id);
    const base = Math.round(ENEMIES.ghoul.dmg * ghoul.dmgMult);
    expect(hits().find((e) => e.target === 'rb')?.amount).toBe(Math.max(1, base - 3));
    // The Warden's Chain Shirt came back on when they were Raised, and it counts.
    expect(w.armor).toBe('studded');
    const rb = enc.legion!.find((r) => r.id === 'rb')!;
    rb.hp = 0;
    delete enc.next.rb;
    for (let i = 0; i < 6 && !hits().some((e) => e.target === w.id); i++) untilTurn(world, room, ghoul.id);
    expect(hits().find((e) => e.target === w.id)?.amount).toBe(Math.max(1, base - 2));
  });
});

describe('Undertaker', () => {
  it('digs through rubble in one turn of their own; others take the full dig time', () => {
    const { world, heroes } = quiet(['undertaker', 'warden']);
    expect(digTime(heroes[0], world.time)).toBe(CLASSES.undertaker.speed);
    expect(digTime(heroes[1], world.time)).toBe(18);
  });

  it("Raises a fallen ally with their things; walked out, what they carry goes to the dead hero's Village", () => {
    const { world, heroes } = quiet(['undertaker', 'cutthroat']);
    const [u, c] = heroes;
    c.gold = 50;
    c.items.push('bandage');
    c.dead = true;
    dropEverything(world, c);
    run(world, 0.2);
    expect(c.raised).toBe(true);
    expect(u.legion).toEqual([expect.objectContaining({ hero: c.id, hp: c.maxHp, permanent: true })]);
    expect(c.items).toContain('bandage');
    expect(c.gold).toBe(50);
    expect(u.items).not.toContain('bandage');
    expect(world.piles[world.dungeon.entrance]).toBeUndefined();
    extractHero(world, u);
    expect(c.legacy).toBe(50);
    expect(c.legacyItems).toContain('bandage');
    expect(carriedHome(c)).toContain('bandage');
    expect(u.legion).toHaveLength(0);
  });

  it('a Risen ally fights as its class, takes the hits, wears on the living, and drops its things for anyone when it falls', () => {
    const { world, ids, room, monsters } = arena(['undertaker', 'cutthroat', 'warden'], ['ghoul']);
    const [u, c, w] = ids.map((id) => world.heroes[id]);
    c.items.push('bandage');
    c.dead = true;
    dropEverything(world, c);
    run(world, 0.2);
    walkIn(world, [u.id, w.id], room);
    const enc = world.encounters[room];
    const r = enc.legion!.find((x) => x.hero === c.id)!;
    expect(r.id).toBe(c.id);
    expect(buildView(world, u.id).encounter!.legion[0]).toMatchObject({ name: `Risen ${c.name}`, cls: 'cutthroat' });
    expect(enc.next[c.id]).toBeCloseTo(world.time + speedOf(c, world.time) - (world.time - enc.startedAt), 0);
    untilTurn(world, room, c.id);
    // It plays its hero's deck as an undecided hero would.
    expect(c.deck).not.toBeNull();
    expect(enc.events.some((e) => e.actor === c.id)).toBe(true);
    // From here on only the Ghoul moves, and nothing else stands in front of the Risen ally.
    for (const id of [u.id, w.id, c.id]) enc.next[id] = world.time + 999;
    enc.legion = enc.legion!.filter((x) => x === r);
    monsters[0].st = {}; // whatever it played on the Ghoul (a Stun, a Blind) is shaken off
    r.hp = 1;
    untilTurn(world, room, monsters[0].id);
    expect(r.hp).toBe(0);
    expect(world.piles[room]?.items.map((f) => f.item)).toContain('bandage');
    delete world.monsters[monsters[0].id];
    run(world, 0.5);
    expect(world.encounters[room]).toBeUndefined();
    expect(u.legion).toHaveLength(0);
    // Only once: the Undertaker standing over them now just divvies up the loot like anyone.
    expect(world.piles[room]?.items.map((f) => f.item)).toContain('bandage');
  });

  it("an Undertaker's death drops their Risen allies, and nobody can Raise them again", () => {
    const { world, heroes } = quiet(['undertaker', 'cutthroat', 'undertaker']);
    const [u, c, u2] = heroes;
    c.items.push('bandage');
    c.dead = true;
    dropEverything(world, c);
    run(world, 0.2);
    const raiser = u.legion.length ? u : u2;
    dieOut(world, raiser);
    expect(raiser.legion).toHaveLength(0);
    const other = raiser === u ? u2 : u;
    run(world, 0.5);
    // The other Undertaker Raises the dead one (an ally too), but not the Cutthroat a second time: its things stay down for anyone.
    expect(other.legion.map((r) => r.hero)).toEqual([raiser.id]);
    expect(c.items).toHaveLength(0);
    expect(world.piles[world.dungeon.entrance]?.items.map((f) => f.item)).toContain('bandage');
  });
});

describe('Bellwright', () => {
  it('timed statuses outlast the fight and tick in the field; Poison keeps hurting', () => {
    const { world, ids } = arena(['bellwright'], ['ghoul']);
    const h = world.heroes[ids[0]];
    h.st = { clang: { stacks: 1, turns: 2 }, poison: [{ dmg: 3, rounds: 2 }], weak: { stacks: 1, turns: 1 }, stun: true, shield: 5 };
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
    run(world, 10 + CLASS_RULES.tollDaze); // they reel from the bell first
    expect(heroes[0].encounter).toBe(d.entrance);
  });

  it('Toll: every monster in the dungeon comes one room closer; once a run, until a Loom weaves it back', () => {
    const { world, heroes } = quiet(['bellwright'], true);
    const d = world.dungeon;
    const hops = hopDistances(d, d.entrance);
    const far = d.rooms.find((r) => r.kind === 'normal' && hops[r.id] >= 4)!.id;
    const [ghoul] = spawnGroup(world, far, ['ghoul'], 0);
    applyIntent(world, 'h0', { type: 'skill' });
    run(world, CLASSES.bellwright.speed + 0.2);
    expect(world.tolls).toHaveLength(1);
    expect(heroes[0].tolled).toBe(true);
    expect(world.monsters[ghoul.id].room).toBe(-1);
    run(world, CLASS_RULES.tollDaze + 10);
    expect(hops[world.monsters[ghoul.id].room]).toBe(hops[far] - 1);
    expect(checkSkill(world, heroes[0], 'toll')).toMatch(/already/);
    const room = heroes[0].pos.kind === 'room' ? heroes[0].pos.room : -1;
    world.events[room] = { room, kind: 'loom', done: false, progress: 0, by: null, spawned: false };
    expect(eventChoices(world, heroes[0])?.choices.some((c) => c.label.includes('Toll'))).toBe(true);
  });
});

describe('Zealot', () => {
  it('Fervour: hits harder the less light they have (times the weapon bonus)', () => {
    const { heroes } = quiet(['zealot']);
    const z = heroes[0];
    z.light = 50;
    z.weapon = 'dirk';
    expect(damageMult(z)).toBeCloseTo(1.1 * (1 + 50 * CLASS_RULES.zealotDmgPerDark));
    z.light = 100;
    expect(damageMult(z)).toBeCloseTo(1.1);
  });

});

describe('Alchemist', () => {
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
