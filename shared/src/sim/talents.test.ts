import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRESS } from '../content/events';
import { CLASS_RULES } from '../content/innates';
import { CLASSES, type ClassId } from '../content/classes';
import { CR_RULES, type EnemyId } from '../content/enemies';
import { migrateTalentId, OLD_TALENT_IDS, TALENT_RULES, TALENTS, type TalentId } from '../content/talents';
import { CARD_RULES, CARDS } from '../content/cards';
import { cardTime, corpses } from './cards';
import { play } from './testkit';
import { neighbours } from '../dungeon/gen';
import { downHero, spawnGroup, submitChoice } from './combat';
import { addToPile } from './loot';
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
    loadout: { charId: `c${i}`, charName: `H${i}`, owner: 'Ann', talents: talent ? [talent] : [], injuries, insane: false },
  });
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
  it('Shieldwall: every Guard card Delays the nearest enemy', () => {
    const { world, ids, room, monsters } = arena([['warden', 'shieldwall']], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    enc.next[monsters[0].id] = world.time + 600;
    play(world, world.heroes.h0, 'cover', 'h0');
    expect(enc.next[monsters[0].id]).toBeCloseTo(world.time - 0.1 + 600 + TALENT_RULES.shieldwallDelay, 0);
  });

  it('Unbroken Line: every fight starts with Cover and Shield Bash in hand', () => {
    const { world, ids, room } = arena([['warden', 'unbrokenLine']], ['ghoul']);
    walkIn(world, ids, room);
    expect(world.heroes.h0.deck!.hand.slice(0, 2)).toEqual(['cover', 'bash']);
  });
});

describe('Cutthroat talents', () => {
  it('Sleight of Hand: a hand of four', () => {
    const { world, ids, room } = arena([['cutthroat', 'sleightOfHand']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    expect(h.deck!.hand).toHaveLength(TALENT_RULES.bigHand);
    play(world, h, h.deck!.hand[0] === 'dance' ? h.deck!.hand[1] : h.deck!.hand[0]);
    expect(h.deck!.hand).toHaveLength(TALENT_RULES.bigHand);
  });

  it('Opening Act: the first action comes at half Speed, and the first card takes 1s', () => {
    const { world, ids, room } = arena([['cutthroat', 'openingAct']], ['giant']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const h = world.heroes.h0;
    expect(enc.next.h0 - enc.startedAt).toBeCloseTo(CLASSES.cutthroat.speed * TALENT_RULES.openingFraction);
    expect(cardTime(world, enc, h, 'cheap')).toBe(TALENT_RULES.openingCard);
    play(world, h, 'cheap');
    expect(cardTime(world, enc, h, 'cheap')).toBe(CARDS.cheap.time);
  });
});

describe('Lampbearer talents', () => {
  it('Steady Hands: Mend and Sanctuary take a second less', () => {
    const { world, ids, room } = arena([['lampbearer', 'steadyHands']], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const h = world.heroes.h0;
    play(world, h, 'flare'); // past the first card
    expect(cardTime(world, enc, h, 'mend')).toBe(CARDS.mend.time - TALENT_RULES.steadyCut);
    expect(cardTime(world, enc, h, 'sanctuary')).toBe(CARDS.sanctuary.time - TALENT_RULES.steadyCut);
    expect(cardTime(world, enc, h, 'flare')).toBe(CARDS.flare.time);
  });

  it('Undying Flame: Dawn comes back after a fight that ends with everyone standing', () => {
    const { world, ids, room, monsters } = arena([['lampbearer', 'undyingFlame']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    play(world, h, 'dawn');
    expect(h.burned).toEqual(['dawn']);
    delete world.monsters[monsters[0].id];
    step(world, 0.1);
    expect(h.encounter).toBeNull();
    expect(h.burned).toEqual([]);
  });
});

describe('Sorceress talents', () => {
  it('Blood Price: the Pact costs her allies nothing, and her twice over', () => {
    const { world, ids, room } = arena([['sorceress', 'bloodPrice'], 'warden'], ['ghoul']);
    walkIn(world, ids, room);
    const [s, w] = [world.heroes.h0, world.heroes.h1];
    play(world, s, 'pact');
    expect(w.hp).toBe(w.maxHp);
    expect(s.hp).toBe(s.maxHp - CARD_RULES.pactCost * TALENT_RULES.bloodPriceMult);
    expect(s.stress).toBe(CARD_RULES.pactStress * TALENT_RULES.bloodPriceMult);
  });

  it('Grimoire: a hand of four', () => {
    const { world, ids, room } = arena([['sorceress', 'grimoire']], ['ghoul']);
    walkIn(world, ids, room);
    expect(world.heroes.h0.deck!.hand).toHaveLength(TALENT_RULES.bigHand);
  });
});

describe('Undertaker talents', () => {
  it('Gravedigger: a Corpse lies ready in every fight the Undertaker joins', () => {
    const { world, ids, room } = arena([['undertaker', 'gravedigger']], ['ghoul']);
    walkIn(world, ids, room);
    expect(corpses(world.encounters[room])).toBe(TALENT_RULES.gravediggerCorpses);
  });

  it('Restless Dead: what they Raise never crumbles and follows them into the next fight', () => {
    const { world, ids, room, monsters } = arena([['undertaker', 'restlessDead']], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const h = world.heroes.h0;
    enc.slain = [{ type: 'crawler', maxHp: 8, dmgMult: 1 }];
    play(world, h, 'raise');
    const r = enc.legion!.find((x) => x.type === 'crawler')!;
    expect(r.permanent).toBe(true);
    expect(r.summon).toBeUndefined();
    for (const m of monsters) delete world.monsters[m.id];
    step(world, 0.1);
    expect(h.legion.map((x) => x.type)).toEqual(['crawler']);
  });
});

describe('Bellwright talents', () => {
  it('the Toll stuns monsters in fights and dazes the rest', () => {
    const { world, d, room, monsters } = arena(['warden', 'bellwright'], ['ghoul']);
    walkIn(world, ['h0'], room);
    const far = d.rooms.find((r) => r.id !== room && r.id !== d.entrance && !neighbours(d, d.entrance).includes(r.id))!.id;
    const [loner] = spawnGroup(world, far, ['crawler'], 0);
    applyIntent(world, 'h1', { type: 'skill', skill: 'toll' });
    for (let i = 0; i < 80 && !world.tolls.length; i++) step(world, 0.1);
    expect(monsters[0].st.stun).toBe(true);
    expect(loner.dazedUntil).toBeCloseTo(world.time + CLASS_RULES.tollDaze, 0);
    expect(world.heroes.h1.st.clang).toBeUndefined();
  });

  it('Resounding: Echo repeats at full power', () => {
    const { world, ids, room, monsters } = arena([['bellwright', 'resounding']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    play(world, h, 'clang');
    const hp = monsters[0].hp;
    play(world, h, 'echo');
    expect(hp - monsters[0].hp).toBe(CARD_RULES.clang);
  });

  it('Carillon: after a Hinder card, the next card takes a second less', () => {
    const { world, ids, room } = arena([['bellwright', 'carillon']], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const h = world.heroes.h0;
    play(world, h, 'ringout');
    expect(cardTime(world, enc, h, 'knell')).toBe(CARDS.knell.time - TALENT_RULES.carillonCut);
  });
});

describe('Zealot talents', () => {
  it('Scourged: Flagellate goes straight back into the hand', () => {
    const { world, ids, room } = arena([['zealot', 'scourged']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    play(world, h, 'flagellate');
    expect(h.deck!.hand).toContain('flagellate');
    expect(h.deck!.discard).not.toContain('flagellate');
  });

  it('Penitent: Absolution only spends half', () => {
    const { world, ids, room } = arena([['zealot', 'penitent']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.stress = 90;
    play(world, h, 'absolution');
    expect(h.stress).toBe(70);
  });
});

describe('Alchemist talents', () => {
  it('Volatile: an item used in a fight sets off a free Catalyst', () => {
    const { world, ids, room, monsters } = arena([['alchemist', 'volatile']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.items = ['tonic'];
    h.stress = 30;
    const enc = world.encounters[room];
    submitChoice(world, h, { action: 'item', item: 0 });
    enc.next[h.id] = world.time;
    step(world, 0.1);
    expect(monsters[0].st.poison?.length).toBeGreaterThan(0);
  });

  it('Prepared: Elixir in the opening hand, and items take 1s', () => {
    const { world, ids, room } = arena([['alchemist', 'prepared']], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    expect(h.deck!.hand[0]).toBe('elixir');
    h.items = ['tonic'];
    h.stress = 30;
    const enc = world.encounters[room];
    submitChoice(world, h, { action: 'item', item: 0 });
    enc.next[h.id] = world.time;
    step(world, 0.1);
    expect(enc.next[h.id] - world.time).toBeCloseTo(TALENT_RULES.preparedItemTime, 1);
  });
});

describe('Talents from before the cards', () => {
  it('load as their class’s new ones', () => {
    expect(migrateTalentId('ironOath')).toBe('shieldwall');
    expect(migrateTalentId('openingAct')).toBe('openingAct');
    expect(migrateTalentId('restlessDead')).toBe('restlessDead');
    expect(migrateTalentId('pallbearer')).toBe('gravedigger');
    for (const old of Object.keys(OLD_TALENT_IDS)) expect(TALENTS[migrateTalentId(old)]).toBeDefined();
  });
});

describe('Challenge Rating', () => {
  it('makes found gold worth +15% per CR (not dropped gold)', () => {
    const world = createWorld(3, { monsters: false, loot: false, cr: 2 });
    addToPile(world, 0, 100, []);
    expect(world.piles[0].gold).toBe(130);
    addToPile(world, 0, 100, [], 'h0');
    expect(world.piles[0].gold).toBe(230);
  });

  it('counts the Talents in a Game', async () => {
    const { Game } = await import('./game');
    const loadout = (talent: TalentId | null) => ({ charId: 'c', charName: 'X', owner: 'Ann', talents: talent ? [talent] : [], injuries: [], insane: false });
    const game = new Game(9, [
      { id: 'a', name: 'A', cls: 'warden', isBot: false, loadout: loadout('shieldwall') },
      { id: 'b', name: 'B', cls: 'sorceress', isBot: true, loadout: loadout('bloodPrice') },
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
    enc.next.h0 = q.world.time + 999; // the Sorceress holds still
    untilTurn(q.world, q.room, queen.id);
    expect(ghoul.hp).toBe(500 + CR_RULES.hymnHeal);
    delete q.world.monsters[ghoul.id];
    untilTurn(q.world, q.room, queen.id);
    expect(enc.events.some((e) => e.actor === queen.id && e.kind === 'stress')).toBe(true);
    expect(q.world.heroes.h0.stress).toBeGreaterThanOrEqual(CR_RULES.dirgeStress);
  });
});
