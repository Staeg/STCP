import { describe, expect, it } from 'vitest';
import { CARD_RULES as R, CARDS, FOUND_CARDS, FOUND_POOL, type CardId } from '../content/cards';
import { CARD_EVENTS } from '../content/events';
import { LIGHT_DIM } from '../content/constants';
import { cardSource } from '../content/items';
import { heroHits, monstersIn, submitChoice } from './combat';
import { liveCards, settleCard } from './deck';
import { equip } from './loot';
import { speedOf } from './speed';
import { arena, holdMonsters, play, untilTurn, walkIn } from './testkit';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { RoomEvent } from './events';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Pick an event choice and wait for the hero's timer to run out, when it starts. */
function choose(world: World, id: string, choice: string) {
  applyIntent(world, id, { type: 'event', choice });
  while (world.heroes[id].queuedEvent !== null) step(world, 0.1);
}

/** A quiet world with one hero (an Ember Pendant on, so their light holds still) in a room with the event. */
function withEvent(kind: RoomEvent['kind'], cls: Parameters<typeof addHero>[1]['cls'] = 'warden') {
  const world = createWorld(31, { monsters: false, loot: false, escalates: false, events: false });
  const h = addHero(world, { id: 'h', name: 'H', cls });
  equip(h, 'amulet', 'ember');
  const room = world.dungeon.entrance;
  world.events[room] = { room, kind, done: false, progress: 0, by: null, spawned: false };
  return { world, h, room };
}

const ids = (world: World, id: string) => buildView(world, id).event!.choices.map((c) => c.id);

/** A fight with a tough monster that holds still. */
function fight(enemies: Parameters<typeof arena>[1] = ['ghoul']) {
  const a = arena(['warden'], enemies);
  for (const m of a.monsters) m.hp = m.maxHp = 999;
  walkIn(a.world, a.ids, a.room);
  const enc = a.world.encounters[a.room];
  holdMonsters(a.world, enc);
  return { ...a, enc, h: a.world.heroes[a.ids[0]] };
}

describe('found cards (user, 2026-10-16)', () => {
  it('wear their own frame', () => {
    for (const card of FOUND_CARDS) expect(cardSource(card), card).toBe('found');
  });

  it('Riposte: the next attack misses, and the attacker is hit and Delayed', () => {
    const { world, h, enc, monsters } = fight();
    play(world, h, 'riposte');
    const ghoul = monsters[0];
    enc.next[ghoul.id] = world.time;
    untilTurn(world, enc.room, ghoul.id);
    expect(enc.events.some((e) => e.actor === ghoul.id && e.kind === 'miss')).toBe(true);
    expect(ghoul.hp).toBeLessThan(999);
    expect(h.st.riposte).toBeUndefined();
  });

  it('Living Ember hits every enemy and lights every ally', () => {
    const { world, h, monsters } = fight(['ghoul', 'ghoul']);
    h.light = 50;
    play(world, h, 'ember');
    for (const m of monsters) expect(m.hp).toBeLessThan(999);
    expect(h.light).toBeGreaterThan(50);
  });

  it('Mirror Shard plays the last card again, at full power', () => {
    const { world, h, monsters } = fight();
    play(world, h, 'oathstrike');
    const after = monsters[0].hp;
    play(world, h, 'shard');
    expect(after - monsters[0].hp).toBe(999 - after);
  });

  it('Word of Unmaking kills a lesser foe outright and halves a Bone Giant', () => {
    const { world, h, monsters } = fight(['ghoul', 'giant']);
    const [ghoul, giant] = monsters;
    play(world, h, 'unmaking', ghoul.id);
    expect(world.monsters[ghoul.id]).toBeUndefined();
    expect(h.burned).toContain('unmaking');
    play(world, h, 'unmaking', giant.id);
    expect(giant.hp).toBe(999 - Math.ceil(999 / 2));
  });

  it('Halting Word stuns; Borrowed Moment makes the next card 1s; Snake Eyes does nothing and burns', () => {
    const { world, h, enc, monsters } = fight();
    play(world, h, 'halting', monsters[0].id);
    expect(monsters[0].st.stun).toBeTruthy();
    play(world, h, 'borrowed');
    expect(h.st.quick?.set).toBe(1);
    play(world, h, 'snakeeyes');
    expect(h.burned).toEqual(expect.arrayContaining(['borrowed', 'snakeeyes']));
    expect(enc.events.some((e) => e.actor === h.id && /snake eyes/.test(e.text))).toBe(true);
  });
});

describe('card events (user, 2026-10-16)', () => {
  it('Weapon Rack: a 12s search, then the searcher picks one of three', () => {
    const { world, h } = withEvent('rack');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'zealot' });
    expect(ids(world, 'h')).toEqual(['rummage', 'grab']);
    expect(buildView(world, 'h').event!.choices[0].label).toMatch(/\(12s\)$/);
    choose(world, 'h', 'rummage');
    run(world, CARD_EVENTS.rackTime + 0.2);
    const picks = ids(world, 'h');
    expect(picks).toHaveLength(CARD_EVENTS.rackOffer);
    expect(picks.every((id) => id.startsWith('pick-'))).toBe(true);
    expect(buildView(world, 'o').event!.choices[0].disabled).toMatch(/theirs to choose/);
    const card = picks[1].slice('pick-'.length) as CardId;
    choose(world, 'h', picks[1]);
    expect(h.bonusCards).toContain(card);
    expect(buildView(world, 'h').event).toBeNull();
    expect(o.bonusCards).toEqual([]);
  });

  it('Weapon Rack: or grab a random card in a second', () => {
    const { world, h } = withEvent('rack');
    choose(world, 'h', 'grab');
    run(world, CARD_EVENTS.grabTime + 0.2);
    expect(h.bonusCards).toHaveLength(1);
    expect(FOUND_POOL).toContain(h.bonusCards[0]);
  });

  it("Duelist's Ghost: a duel nobody else joins; winning it gives a Riposte", () => {
    const { world, h, room } = withEvent('duelist');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'zealot' });
    choose(world, 'h', 'duel');
    run(world, CARD_EVENTS.duelTime + 0.2);
    const [ghost] = monstersIn(world, room);
    expect(ghost.type).toBe('duelist');
    expect(h.encounter).toBe(room);
    expect(o.encounter).toBeNull();
    const enc = world.encounters[room];
    heroHits(world, enc, h, ghost, 999, enc.events, 'test');
    expect(world.monsters[ghost.id]).toBeUndefined();
    expect(h.bonusCards).toEqual(['riposte']);
  });

  it("Duelist's Ghost: or bow out for a Parry (a 5s card)", () => {
    const { world, h } = withEvent('duelist');
    choose(world, 'h', 'bow');
    run(world, CARD_EVENTS.bowTime + 0.2);
    expect(h.bonusCards).toEqual(['parry']);
    expect(CARDS.parry.time).toBe(5);
  });

  it('Ember Hearth: warm yourself once each; taking the ember drops the room to Dim', () => {
    const { world, h, room } = withEvent('hearth');
    const o = addHero(world, { id: 'o', name: 'O', cls: 'zealot' });
    h.hp = 10;
    h.light = 30;
    choose(world, 'h', 'warm');
    run(world, CARD_EVENTS.warmTime + 0.2);
    expect(h.hp).toBe(10 + CARD_EVENTS.warmHeal);
    expect(h.light).toBe(30 + CARD_EVENTS.warmLight);
    expect(buildView(world, 'h').event!.choices[1].disabled).toMatch(/already/);
    choose(world, 'o', 'ember');
    run(world, CARD_EVENTS.emberTime + 0.2);
    expect(o.bonusCards).toEqual(['ember']);
    expect(h.light).toBeLessThan(LIGHT_DIM);
    expect(o.light).toBeLessThan(LIGHT_DIM);
    expect(world.events[room].done).toBe(true);
    expect(R.ember).toBe(8);
  });

  it('Cracked Mirror: a copy of a deck card that burns once played; or a Mirror Shard that cuts', () => {
    const { world, h } = withEvent('mirror');
    expect(ids(world, 'h')).toContain('copy-bash');
    const before = liveCards(h).filter((c) => c === 'bash').length;
    choose(world, 'h', 'copy-bash');
    run(world, CARD_EVENTS.gazeTime + 0.2);
    expect(liveCards(h).filter((c) => c === 'bash')).toHaveLength(before + 1);
    settleCard(h, 'bash', world.rng); // played: the copy burns
    expect(liveCards(h).filter((c) => c === 'bash')).toHaveLength(before);
    settleCard(h, 'bash', world.rng); // the original doesn't
    expect(liveCards(h).filter((c) => c === 'bash')).toHaveLength(before);

    const b = withEvent('mirror');
    const hp = b.h.hp;
    choose(b.world, 'h', 'shard');
    run(b.world, CARD_EVENTS.shardTime + 0.2);
    expect(b.h.bonusCards).toEqual(['shard']);
    expect(b.h.hp).toBe(hp - CARD_EVENTS.shardHp);
  });

  it('Oathstone: Blood gives Oathbound Strike and forbids fleeing; Grace quickens and forbids items in a fight', () => {
    const { world, h } = withEvent('oathstone');
    choose(world, 'h', 'blood');
    run(world, CARD_EVENTS.oathTime + 0.2);
    expect(h.oath).toBe('blood');
    expect(h.bonusCards).toEqual(['oathstrike']);
    expect(buildView(world, 'h').event!.choices.every((c) => c.disabled)).toBe(true);

    const f = fight();
    f.h.oath = 'blood';
    expect(submitChoice(f.world, f.h, { action: 'flee' })).toMatch(/Oath of Blood/);
    f.h.oath = 'grace';
    f.h.items.push('bandage');
    expect(submitChoice(f.world, f.h, { action: 'item', item: f.h.items.indexOf('bandage') })).toMatch(/Oath of Grace/);

    const g = withEvent('oathstone', 'lampbearer');
    choose(g.world, 'h', 'grace');
    run(g.world, CARD_EVENTS.oathTime + 0.2);
    expect(g.h.oath).toBe('grace');
    expect(speedOf(g.h, g.world.time)).toBe(5 + CARD_EVENTS.graceSpeed);
    expect(g.h.bonusCards).toEqual([]);
  });

  it("Gambler's Table: bet gold for a card, again and again; or a deck card, doubled or lost", () => {
    const { world, h } = withEvent('gambler');
    expect(buildView(world, 'h').event!.choices[0].disabled).toMatch(/gold/);
    h.gold = 120;
    choose(world, 'h', 'bet');
    run(world, CARD_EVENTS.betTime + 0.2);
    choose(world, 'h', 'bet');
    run(world, CARD_EVENTS.betTime + 0.2);
    expect(h.gold).toBe(20);
    expect(h.bonusCards).toHaveLength(2);
    for (const c of h.bonusCards) expect([...FOUND_POOL, 'snakeeyes']).toContain(c);
    const bashes = liveCards(h).filter((c) => c === 'bash').length;
    choose(world, 'h', 'stake-bash');
    run(world, CARD_EVENTS.betTime + 0.2);
    expect([bashes - 1, bashes + 1]).toContain(liveCards(h).filter((c) => c === 'bash').length);
  });

  it('Forbidden Lectern: read it all for a Word of Unmaking (light out), or skim for a Halting Word', () => {
    const { world, h } = withEvent('lectern');
    choose(world, 'h', 'study');
    run(world, CARD_EVENTS.readTime + 0.2);
    expect(h.light).toBe(0);
    expect(h.bonusCards).toEqual(['unmaking']);
    const b = withEvent('lectern');
    choose(b.world, 'h', 'skim');
    run(b.world, CARD_EVENTS.skimTime + 0.2);
    expect(b.h.light).toBe(100 - CARD_EVENTS.skimLight);
    expect(b.h.bonusCards).toEqual(['halting']);
  });

  it('Altar of Returns: restore one burned card, or take a Borrowed Moment', () => {
    const { world, h } = withEvent('returns');
    expect(buildView(world, 'h').event!.choices[0].disabled).toMatch(/burned nothing/);
    h.burned = ['gate', 'oil'];
    expect(ids(world, 'h')).toEqual(['restore-gate', 'restore-oil', 'moment']);
    choose(world, 'h', 'restore-gate');
    run(world, CARD_EVENTS.returnsTime + 0.2);
    expect(h.burned).toEqual(['oil']);
    const b = withEvent('returns');
    choose(b.world, 'h', 'moment');
    run(b.world, CARD_EVENTS.returnsTime + 0.2);
    expect(b.h.bonusCards).toEqual(['borrowed']);
  });
});
