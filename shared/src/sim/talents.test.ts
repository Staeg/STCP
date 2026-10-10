import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRESS } from '../content/events';
import { CLASSES, type ClassId } from '../content/classes';
import { CR_RULES, type EnemyId } from '../content/enemies';
import { TALENT_RULES, type TalentId } from '../content/talents';
import { neighbours } from '../dungeon/gen';
import { crUnits, damageMult, downHero, spawnGroup, submitChoice } from './combat';
import { addToPile } from './loot';
import { fieldSkillsOf } from './skills';
import { speedOf } from './speed';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { Injury } from '../village';

const baseStress = STRESS.basePerSec;
beforeEach(() => void (STRESS.basePerSec = 0));
afterEach(() => void (STRESS.basePerSec = baseStress));

type Spec = ClassId | [ClassId, TalentId];

function hero(world: World, i: number, spec: Spec, injuries: Injury[] = []) {
  const [cls, talent] = typeof spec === 'string' ? [spec, null] : spec;
  return addHero(world, {
    id: `h${i}`, name: `H${i}`, cls,
    loadout: { charId: `c${i}`, charName: `H${i}`, owner: 'Ann', talent, injuries, affliction: null },
  });
}

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Heroes at the start, monsters (with lots of HP) in the room next door. */
function arena(specs: Spec[], enemies: EnemyId[], cr = 0) {
  const world = createWorld(777, { monsters: false, loot: false, cr });
  const d = world.dungeon;
  const ids = specs.map((s, i) => hero(world, i, s).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(world, room, enemies, 0);
  for (const m of monsters) m.hp = m.maxHp = 999;
  return { world, d, ids, room, monsters };
}

function walkIn(world: World, ids: string[], room: number) {
  for (const id of ids) applyIntent(world, id, { type: 'goto', room });
  for (let i = 0; i < 100 && ids.some((id) => world.heroes[id].encounter === null); i++) step(world, 0.1);
}

function untilTurn(world: World, room: number, id: string) {
  const enc = world.encounters[room];
  if (!enc) return;
  const due = enc.next[id];
  for (let i = 0; i < 300 && world.encounters[room] === enc && enc.next[id] === due; i++) step(world, 0.1);
}

function quiet(specs: Spec[]) {
  const world = createWorld(5, { monsters: false, loot: false, escalates: false, events: false });
  return { world, heroes: specs.map((s, i) => hero(world, i, s)) };
}

describe('Village loadouts', () => {
  it('bring injuries in: less max HP, and Majors slow you', () => {
    const { world } = quiet([]);
    const h = hero(world, 0, 'warden', ['minor', 'major']);
    expect(h.maxHp).toBe(Math.round(CLASSES.warden.maxHp * 0.7));
    expect(h.hp).toBe(h.maxHp);
    expect(speedOf(h, world.time)).toBe(CLASSES.warden.speed + 0.5);
  });

  it('track the lowest HP and going down', () => {
    const { world, heroes: [h] } = quiet(['warden']);
    h.hp = 10;
    step(world, 0.1);
    expect(h.lowestHp).toBeCloseTo(10 / CLASSES.warden.maxHp);
    downHero(world, h, null);
    expect(h.lowestHp).toBe(0);
    expect(h.downedMajor).toBe(true);
  });

  it('injuries take effect at once: a Minor under half HP, a Major instead under a quarter, one more for going down', () => {
    const { world, heroes: [h] } = quiet(['warden']);
    const base = CLASSES.warden.maxHp;
    h.hp = 25;
    step(world, 0.1);
    expect(h.runInjuries).toEqual(['minor']);
    expect(h.maxHp).toBe(Math.round(base * 0.9));
    expect(speedOf(h, world.time)).toBe(CLASSES.warden.speed);
    h.hp = 10;
    step(world, 0.1);
    expect(h.runInjuries).toEqual(['major']);
    expect(h.maxHp).toBe(Math.round(base * 0.8));
    expect(speedOf(h, world.time)).toBe(CLASSES.warden.speed + 0.5);
    downHero(world, h, null);
    expect(h.runInjuries).toEqual(['major', 'major']);
    expect(h.maxHp).toBe(Math.round(base * 0.6));
    expect(speedOf(h, world.time)).toBe(CLASSES.warden.speed + 1);
  });
});

describe('Warden talents', () => {
  it('Iron Oath: the first killing blow leaves 1 HP and no damage for 6s', () => {
    const { world, ids, room, monsters } = arena([['warden', 'ironOath']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.hp = 1;
    untilTurn(world, room, monsters[0].id);
    expect(h.downedAt).toBeNull();
    expect(h.hp).toBe(1);
    expect(h.oathUsed).toBe(true);
    expect(h.immuneUntil).toBeCloseTo(world.time + TALENT_RULES.oathImmune, 0);
    untilTurn(world, room, monsters[0].id);
    expect(h.hp).toBe(1);
  });

  it('Unyielding: Vengeance lasts 3 turns, costs 5, and works out of combat', () => {
    const { world, heroes: [h] } = quiet([['warden', 'unyielding']]);
    expect(fieldSkillsOf(h)).toContain('vengeance');
    applyIntent(world, 'h0', { type: 'skill', skill: 'vengeance' });
    run(world, CLASSES.warden.speed + 0.2);
    expect(h.st.vengeance).toBe(3);
    expect(h.cooldowns.vengeance).toBe(5);
  });
});

describe('Cutthroat talents', () => {
  it('Ghost Step: fleeing always works and costs no stress', () => {
    const { world, ids, room } = arena([['cutthroat', 'ghostStep']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    submitChoice(world, h, { action: 'flee' });
    untilTurn(world, room, 'h0');
    expect(h.encounter).toBeNull();
    expect(h.stress).toBe(0);
  });

  it('Opening Act: the first turn of a fight comes at half Speed', () => {
    const { world, ids, room } = arena([['cutthroat', 'openingAct']], ['ghoul']);
    walkIn(world, ids, room);
    const wait = world.encounters[room].next.h0 - world.time;
    expect(wait).toBeLessThanOrEqual(CLASSES.cutthroat.speed / 2 + 0.01);
    expect(wait).toBeGreaterThan(CLASSES.cutthroat.speed / 2 - 0.2);
  });
});

describe('Lampbearer talents', () => {
  it("Everflame: +0.33% damage per point of allies' light", () => {
    const { world, heroes: [lamp, a, b] } = quiet([['lampbearer', 'everflame'], 'warden', 'sorceress']);
    expect(damageMult(lamp, world)).toBeCloseTo(1 + TALENT_RULES.everflamePerLight * 200);
    a.light = 50;
    b.light = 0;
    expect(damageMult(lamp, world)).toBeCloseTo(1 + TALENT_RULES.everflamePerLight * 50);
  });

  it('Triage: Mend heals 12, and only the Lampbearer', () => {
    const { world, heroes: [lamp, ally] } = quiet([['lampbearer', 'triage'], 'warden']);
    lamp.hp = 10;
    ally.hp = 10;
    applyIntent(world, 'h0', { type: 'skill', skill: 'mend', target: 'h1' });
    run(world, CLASSES.lampbearer.speed + 0.2);
    expect(lamp.hp).toBe(10 + TALENT_RULES.triageHeal);
    expect(ally.hp).toBe(10);
  });
});

describe('Sorceress talents', () => {
  it('Sanguine: heals 2 per Hex on what she hits', () => {
    const { world, ids, room, monsters } = arena([['sorceress', 'sanguine']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.hp = 10;
    monsters[0].st.hexed = [3, 3];
    submitChoice(world, h, { action: 'a0', target: monsters[0].id });
    untilTurn(world, room, 'h0');
    expect(h.hp).toBe(10 + 2 * TALENT_RULES.sanguineHeal);
  });

  it('Evil Eye: every enemy starts the fight Hexed', () => {
    const { world, ids, room, monsters } = arena([['sorceress', 'evilEye']], ['ghoul', 'crawler']);
    walkIn(world, ids, room);
    expect(monsters.map((m) => m.st.hexed?.length)).toEqual([1, 1]);
  });
});

describe('Undertaker talents', () => {
  it('Restless Dead: the risen lasts 6 turns and follows into the next fight', () => {
    const { world, ids, room, monsters } = arena([['undertaker', 'restlessDead']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    const enc = world.encounters[room];
    enc.lastSlain = { type: 'ghoul', maxHp: 14, dmgMult: 1 };
    submitChoice(world, h, { action: 'a2' });
    untilTurn(world, room, 'h0');
    expect(enc.risen?.turns).toBe(TALENT_RULES.restlessTurns);
    delete world.monsters[monsters[0].id];
    step(world, 0.1);
    expect(world.encounters[room]).toBeUndefined();
    expect(h.risen?.type).toBe('ghoul');
    spawnGroup(world, room, ['crawler'], 0);
    applyIntent(world, 'h0', { type: 'goto', room: world.dungeon.entrance });
    run(world, 15);
    applyIntent(world, 'h0', { type: 'goto', room });
    for (let i = 0; i < 100 && h.encounter === null; i++) step(world, 0.1);
    expect(world.encounters[room].risen?.type).toBe('ghoul');
    expect(h.risen).toBeNull();
  });

  it('Pallbearer: revived allies get up at full HP, spared the Major Injury', () => {
    const { world, heroes: [, ally] } = quiet([['undertaker', 'pallbearer'], 'warden']);
    downHero(world, ally, null);
    applyIntent(world, 'h0', { type: 'revive', target: 'h1' });
    run(world, 7);
    expect(ally.downedAt).toBeNull();
    expect(ally.hp).toBe(ally.maxHp);
    expect(ally.downedMajor).toBe(false);
  });
});

describe('Bellwright talents', () => {
  it('Great Bell: the Toll stuns monsters in fights and dazes the rest', () => {
    const { world, d, room, monsters } = arena(['warden', ['bellwright', 'greatBell']], ['ghoul']);
    walkIn(world, ['h0'], room);
    const far = d.rooms.find((r) => r.id !== room && r.id !== d.entrance && !neighbours(d, d.entrance).includes(r.id))!.id;
    const [loner] = spawnGroup(world, far, ['crawler'], 0);
    applyIntent(world, 'h1', { type: 'skill', skill: 'toll' });
    for (let i = 0; i < 80 && !world.tolls.length; i++) step(world, 0.1);
    expect(monsters[0].st.stun).toBe(true);
    expect(loner.dazedUntil).toBeCloseTo(world.time + TALENT_RULES.greatBellDaze, 0);
  });

  it('Resonance: Peal also heals and calms the allies it hastens', () => {
    const { world, ids, room } = arena([['bellwright', 'resonance'], 'warden'], ['ghoul']);
    walkIn(world, ids, room);
    const ally = world.heroes.h1;
    ally.hp = 20;
    submitChoice(world, world.heroes.h0, { action: 'a2' });
    untilTurn(world, room, 'h0');
    const heal = world.encounters[room].events.find((e) => e.actor === 'h0' && e.kind === 'heal' && e.target === 'h1');
    expect(heal?.amount).toBe(TALENT_RULES.resonanceHeal);
  });
});

describe('Zealot talents', () => {
  it('Martyr: Take Their Sins moves up to 40 and heals 5', () => {
    const { world, heroes: [z, ally] } = quiet([['zealot', 'martyr'], 'warden']);
    ally.stress = 50;
    ally.hp = 20;
    applyIntent(world, 'h0', { type: 'skill', skill: 'sins', target: 'h1' });
    run(world, CLASSES.zealot.speed + 0.2);
    expect(ally.stress).toBe(10);
    expect(z.stress).toBe(40);
    expect(ally.hp).toBe(25);
  });

  it('Penitent: Absolution only spends half', () => {
    const { world, ids, room } = arena([['zealot', 'penitent']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.stress = 90;
    submitChoice(world, h, { action: 'a1' });
    untilTurn(world, room, 'h0');
    expect(h.stress).toBe(70);
  });
});

describe('Alchemist talents', () => {
  it('Volatile: an item used in a fight sets off a free Fumes', () => {
    const { world, ids, room, monsters } = arena([['alchemist', 'volatile']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.items = ['torch'];
    submitChoice(world, h, { action: 'item', item: 0 });
    untilTurn(world, room, 'h0');
    expect(h.items).toEqual([]);
    expect(monsters[0].st.poison?.length).toBe(1);
  });

  it('Quick Hands: items are used at once and keep the turn', () => {
    const { world, ids, room } = arena([['alchemist', 'quickHands']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.items = ['bandage'];
    h.hp = 10;
    const due = world.encounters[room].next.h0;
    expect(submitChoice(world, h, { action: 'item', item: 0, target: 'h0' })).toBeNull();
    expect(h.hp).toBe(22);
    expect(world.encounters[room].next.h0).toBe(due);
    expect(world.encounters[room].choices.h0).toBeUndefined();
  });
});

describe('Challenge Rating', () => {
  it('adds Lantern Wights beside Ghouls at the CR chance, and none at CR 0', () => {
    const count = (cr: number) => {
      const world = createWorld(3, { monsters: false, loot: false, cr });
      let wights = 0;
      for (let i = 0; i < 400; i++) wights += crUnits(world, ['ghoul'], 'room', 0).filter((u) => u === 'wight').length;
      return wights / 400;
    };
    expect(count(0)).toBe(0);
    expect(count(1)).toBeCloseTo(CR_RULES.wightChance[1], 1);
    expect(count(3)).toBeCloseTo(CR_RULES.wightChance[3], 1);
  });

  it('puts a Forsaken Queen in every lair at CR 4, none at CR 2, and never two in a room', () => {
    const w4 = createWorld(3, { monsters: false, loot: false, cr: 4 });
    expect(crUnits(w4, ['crawler'], 'lair', 0)).toContain('queen');
    expect(crUnits(w4, ['crawler'], 'room', 0)).not.toContain('queen');
    spawnGroup(w4, 0, ['queen'], 0);
    expect(crUnits(w4, ['crawler'], 'lair', 0)).not.toContain('queen');
    const w2 = createWorld(3, { monsters: false, loot: false, cr: 2 });
    expect(crUnits(w2, ['crawler'], 'lair', 0)).not.toContain('queen');
  });

  it('makes found gold worth +15% per CR (not dropped gold)', () => {
    const world = createWorld(3, { monsters: false, loot: false, cr: 2 });
    addToPile(world, 0, 100, []);
    expect(world.piles[0].gold).toBe(130);
    addToPile(world, 0, 100, [], 'h0');
    expect(world.piles[0].gold).toBe(230);
  });

  it('counts the Talents in a Game', async () => {
    const { Game } = await import('./game');
    const loadout = (talent: TalentId | null) => ({ charId: 'c', charName: 'X', owner: 'Ann', talent, injuries: [], affliction: null });
    const game = new Game(9, [
      { id: 'a', name: 'A', cls: 'warden', isBot: false, loadout: loadout('ironOath') },
      { id: 'b', name: 'B', cls: 'sorceress', isBot: true, loadout: loadout('sanguine') },
      { id: 'c', name: 'C', cls: 'zealot', isBot: true, loadout: loadout(null) },
    ]);
    expect(game.world.cr).toBe(2);
  });

  it('Lantern Wight snuffs light; the Forsaken Queen hastens her court, then mourns alone', () => {
    const w = arena(['warden'], ['wight'], 1);
    walkIn(w.world, w.ids, w.room);
    untilTurn(w.world, w.room, w.monsters[0].id);
    expect(w.world.heroes.h0.light).toBeLessThanOrEqual(100 - CR_RULES.wightSnuff);

    // A Sorceress: no stuns to skip the Queen's turns.
    const q = arena(['sorceress'], ['queen', 'ghoul'], 4);
    walkIn(q.world, q.ids, q.room);
    const [queen, ghoul] = q.monsters;
    ghoul.hp = 500;
    const enc = q.world.encounters[q.room];
    untilTurn(q.world, q.room, queen.id);
    expect(ghoul.hp).toBe(500 + CR_RULES.hymnHeal);
    delete q.world.monsters[ghoul.id];
    untilTurn(q.world, q.room, queen.id);
    expect(enc.events.some((e) => e.actor === queen.id && e.kind === 'stress')).toBe(true);
    expect(q.world.heroes.h0.stress).toBeGreaterThanOrEqual(CR_RULES.dirgeStress);
  });
});
