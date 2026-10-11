import { describe, expect, it } from 'vitest';
import { neighbours } from '../dungeon/gen';
import { botUseItem, botVote } from '../bots/looter';
import { afterBlock, damageMult, hitDamage, hurtHero, onHeroInRoom, spawnGroup, weakMult } from './combat';
import { clothReady, spendCloth, witchwoodMult } from './gear';
import { eventTime } from './events';
import { wornMult } from './loot';
import { useSkill } from './skills';
import { CLASS_RULES, abilityById } from '../content/abilities';
import { ENEMIES, type EnemyId } from '../content/enemies';
import { STRESS } from '../content/events';
import { speedOf } from './speed';
import { CLOTH, isArms, ITEMS, LOOT_TABLE, STAFF } from '../content/items';
import { Stash } from '../stash';
import { addToPile, LEAVE } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { ClassId } from '../content/classes';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** h0, alone in the entrance, takes everything up for grabs there. */
function takeAll(world: World) {
  step(world, 0.1);
  for (const f of buildView(world, 'h0').loot?.items ?? []) applyIntent(world, 'h0', { type: 'vote', item: f.id, choice: 'h0' });
  step(world, 0.1);
}

function party(classes: ClassId[]) {
  const world = createWorld(4242, { monsters: false, loot: false });
  classes.forEach((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }));
  const d = world.dungeon;
  return { world, d, room: neighbours(d, d.entrance)[0] };
}

describe('equipping gear', () => {
  it('goes in its own slot, even with a full pack', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.items = ['torch', 'torch', 'torch', 'torch'];
    addToPile(world, d.entrance, 0, ['stiletto']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', item: world.piles[d.entrance].items[0].id, choice: 'h0' });
    step(world, 0.1);
    expect(h.weapon).toBe('stiletto');
    expect(h.items).toHaveLength(4);
  });

  it('even a rarer piece goes in the pack, not on', () => {
    const { world, d } = party(['warden', 'sorceress']);
    const h = world.heroes.h0;
    h.armor = 'jerkin';
    addToPile(world, d.entrance, 0, ['drakehide']);
    step(world, 0.1);
    const loot = buildView(world, 'h0').loot!;
    expect(loot.items[0].candidates[0].wearing).toBe('jerkin');
    applyIntent(world, 'h0', { type: 'vote', item: loot.items[0].id, choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', item: loot.items[0].id, choice: 'h0' });
    step(world, 0.1);
    expect(h.armor).toBe('jerkin');
    expect(h.items).toEqual(['drakehide']);
    expect(world.piles[d.entrance]).toBeUndefined();
  });

  it('with a full pack, even a rarer piece stays on the floor', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.armor = 'jerkin';
    h.items = Array(14).fill('torch');
    addToPile(world, d.entrance, 0, ['drakehide']);
    takeAll(world);
    expect(h.armor).toBe('jerkin');
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['drakehide']);
  });

  it('no rarer than what you wear, it goes in the pack (after consumables, before resources)', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'misericorde'; // rare
    h.items = ['torch', 'gem'];
    addToPile(world, d.entrance, 0, ['bonebreaker', 'dirk']); // rare, common
    takeAll(world);
    expect(h.weapon).toBe('misericorde');
    expect(h.items).toEqual(['torch', 'bonebreaker', 'dirk', 'gem']);
  });

  it('a full pack leaves it on the floor', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'misericorde';
    h.items = Array(14).fill('torch');
    addToPile(world, d.entrance, 0, ['dirk']);
    takeAll(world);
    expect(h.items).not.toContain('dirk');
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['dirk']);
  });

  it('gear in the pack can be put on, swapping with what is worn', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'misericorde';
    h.items = ['torch', 'dirk'];
    applyIntent(world, 'h0', { type: 'useItem', index: 1 });
    expect(h.weapon).toBe('dirk');
    expect(h.items).toEqual(['torch', 'misericorde']);
  });

  it('can be taken off and dropped, and falls with the dead', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'kris';
    h.armor = 'studded';
    applyIntent(world, 'h0', { type: 'unequip', slot: 'weapon' });
    expect(h.weapon).toBeNull();
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['kris']);

    h.hp = 0;
    h.downedAt = world.time;
    run(world, 40);
    expect(h.dead).toBe(true);
    expect(h.armor).toBeNull();
    const pile = world.piles[d.entrance];
    expect(pile.items.map((f) => f.item)).toContain('studded');
  });

  it('bots back the biggest upgrade; pieces nobody needs go to a player, else stay down', () => {
    const { world, d } = party(['warden', 'sorceress']);
    world.heroes.h0.isBot = world.heroes.h1.isBot = true;
    world.heroes.h0.weapon = 'misericorde';
    addToPile(world, d.entrance, 0, ['knife']);
    step(world, 0.1);
    const item = world.piles[d.entrance].items[0].id;
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', item, choice: 'h1' });

    // An upgrade for nobody: no player to carry it home, so leave it.
    world.heroes.h1.weapon = 'bonebreaker';
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', item, choice: LEAVE });
    // A player's Stash would keep it.
    world.heroes.h1.isBot = false;
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', item, choice: 'h1' });
  });

  it('bots put on better gear from their pack', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    h.isBot = true;
    h.weapon = 'knife';
    h.items = ['dirk', 'kris'];
    expect(botUseItem(buildView(world, 'h0'))).toEqual({ type: 'useItem', index: 1 });
  });
});

describe('gear in combat', () => {
  it('weapons scale all outgoing damage; armor cuts every incoming hit, never below 1', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    expect(damageMult(h)).toBe(1);
    h.weapon = 'misericorde';
    expect(damageMult(h)).toBeCloseTo(1.35);
    expect(afterBlock(h, 5)).toBe(5);
    h.armor = 'studded';
    expect(afterBlock(h, 5)).toBe(3);
    expect(afterBlock(h, 2)).toBe(1);
    expect(afterBlock(h, 0)).toBe(0);
  });

  it('applies in a real fight', () => {
    const { world, room } = party(['cutthroat']);
    const h = world.heroes.h0;
    h.weapon = 'misericorde';
    h.armor = 'drakehide';
    const [ghoul, other] = spawnGroup(world, room, ['ghoul', 'ghoul'], 0);
    applyIntent(world, 'h0', { type: 'goto', room });
    for (let i = 0; i < 100 && h.encounter === null; i++) step(world, 0.1);
    const enc = world.encounters[room];
    ghoul.st.acted = true; // no first-strike crit
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: ghoul.id } });
    run(world, 5.2); // the Cutthroat (Speed 3 + 1 for the gear) acts, then the ghouls (5)
    const stab = enc.events.find((e) => e.actor === 'h0' && e.kind === 'damage');
    expect(stab?.amount).toBe(9); // Backstab 7 × 1.35
    const claw = enc.events.find((e) => e.actor === other.id && e.kind === 'damage');
    expect(claw?.amount).toBe(1); // 4 − 3
  });

  it('armor softens a Pact\'s blood price', () => {
    const { world, room } = party(['sorceress']);
    const h = world.heroes.h0;
    h.armor = 'studded';
    spawnGroup(world, room, ['giant'], 0);
    applyIntent(world, 'h0', { type: 'goto', room });
    for (let i = 0; i < 100 && h.encounter === null; i++) step(world, 0.1);
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1' } });
    run(world, 4.7); // Sorceress: Speed 4 + 0.5 for the armor
    const price = enc.events.find((e) => e.text.includes('spills their own blood'));
    expect(price?.amount).toBe(4);
  });
});

describe('gear types', () => {
  it('light gear never slows you (a few rares quicken); heavy gear does', () => {
    const { world } = party(['lampbearer']);
    const h = world.heroes.h0;
    const base = speedOf(h, 0);
    for (const [weapon, armor, delta] of [
      ['misericorde', 'drakehide', 0], ['whisperblade', 'shadowskin', -1],
      ['cudgel', 'ringmail', 1], ['giantmaul', 'bulwark', 2],
    ] as const) {
      h.weapon = weapon;
      h.armor = armor;
      expect(speedOf(h, 0)).toBe(base + delta);
    }
  });

  it('Hammers add their flat damage to each hit before the percentages', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'cudgel'; // +1, +20%
    expect(hitDamage(h, 10)).toBe(13); // (10 + 1) × 1.2 = 13.2
    h.weapon = 'giantmaul'; // +5, +75%
    expect(hitDamage(h, 10)).toBe(26); // 15 × 1.75 = 26.25
    h.weapon = 'kris'; // +25%, no flat
    expect(hitDamage(h, 10)).toBe(13); // 12.5 rounds up
  });

  it('no two pieces share a rarity and an effect', () => {
    const seen = new Set<string>();
    for (const e of LOOT_TABLE.filter((x) => isArms(x.item))) {
      const { kind, dmgPct, flatDmg, block, speed, staff, cloth } = ITEMS[e.item];
      const key = JSON.stringify([kind, e.rarity, dmgPct, flatDmg, block, speed, staff, cloth?.effect]);
      expect(seen.has(key), e.item).toBe(false);
      seen.add(key);
    }
  });

  it('old weapons and armor in a saved Stash load as the new piece of the same rarity', () => {
    const saved = JSON.stringify({ ann: { name: 'Ann', gold: 0, runs: 0, escapes: 0, best: 0, items: ['mace', 'cuirass', 'jerkin', 'bandage'], kit: { gear: { weapon: 'runeblade', armor: 'chainshirt' }, consumables: [], rites: [] } } });
    const stash = new Stash({ load: () => saved, save: () => {} });
    const v = stash.village('Ann');
    expect([...v.items].sort()).toEqual(['bandage', 'drakehide', 'jerkin', 'stiletto']);
    expect(v.kit.gear).toEqual({ weapon: 'misericorde', armor: 'studded' });
  });
});

describe('staves', () => {
  function arena(classes: ClassId[], enemies: EnemyId[]) {
    const world = createWorld(777, { monsters: false, loot: false });
    const d = world.dungeon;
    const ids = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }).id);
    const room = neighbours(d, d.entrance)[0];
    const monsters = spawnGroup(world, room, enemies, 0);
    for (const m of monsters) m.hp = m.maxHp = 999;
    return { world, d, ids, room, monsters };
  }
  function walkIn(world: World, ids: string[], room: number) {
    for (const id of ids) applyIntent(world, id, { type: 'goto', room });
    for (let i = 0; i < 100 && ids.some((id) => world.heroes[id].encounter === null); i++) step(world, 0.1);
  }
  /** Pick `action` for h0 and run until it has been used. */
  function act(world: World, room: number, action: 'a0' | 'a1' | 'a2', target?: string) {
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action, target } });
    const due = enc.next.h0;
    for (let i = 0; i < 300 && enc.next.h0 === due; i++) step(world, 0.1);
  }

  it('Twinned: Wither lands two stacks (−75%) and Clang pushes twice as far', () => {
    const { world, ids, room, monsters } = arena(['sorceress'], ['ghoul']);
    world.heroes.h0.weapon = 'twinned';
    walkIn(world, ids, room);
    act(world, room, 'a2');
    expect(monsters[0].st.weak?.stacks).toBe(2);
    expect(weakMult(monsters[0].st)).toBe(0.25);

    const b = arena(['bellwright'], ['ghoul']);
    b.world.heroes.h0.weapon = 'twinned';
    walkIn(b.world, b.ids, b.room);
    const enc = b.world.encounters[b.room];
    applyIntent(b.world, 'h0', { type: 'combat', choice: { action: 'a0' } });
    const before = () => enc.next[b.monsters[0].id];
    let was = before();
    for (let i = 0; i < 300 && !b.world.heroes.h0.st.clang; i++) {
      was = before();
      step(b.world, 0.1);
    }
    expect(before() - was).toBeCloseTo(2 * CLASS_RULES.clangDelay);
  });

  it('Rowan makes debuffs last a turn longer; Hourglass cuts every cooldown by 1, down to 0', () => {
    const { world, ids, room, monsters } = arena(['sorceress'], ['ghoul']);
    const h = world.heroes.h0;
    h.weapon = 'rowan';
    walkIn(world, ids, room);
    act(world, room, 'a0');
    expect(monsters[0].st.hexed).toEqual([CLASS_RULES.hexedTurns + 1]);
    h.weapon = 'hourglass';
    act(world, room, 'a2');
    expect(h.cooldowns.wither).toBe(abilityById('wither')!.cooldown - 1);

    const l = arena(['lampbearer', 'warden'], ['ghoul']);
    l.world.heroes.h0.weapon = 'hourglass';
    l.world.heroes.h1.hp -= 20;
    walkIn(l.world, l.ids, l.room);
    act(l.world, l.room, 'a2', 'h1'); // Mend: cooldown 1 → 0
    expect(l.world.heroes.h0.cooldowns.mend).toBeUndefined();
  });

  it("Shepherd's Crook heals twice as much; Censer Staff eases twice the stress", () => {
    const { world, ids, room } = arena(['lampbearer', 'warden'], ['ghoul']);
    const [l, w] = [world.heroes.h0, world.heroes.h1];
    l.weapon = 'crook';
    w.hp -= 30;
    w.st.shield = 999; // the Ghoul's blows don't blur the numbers
    walkIn(world, ids, room);
    const hp = w.hp;
    act(world, room, 'a2', 'h1');
    expect(w.hp - hp).toBe(Math.round(abilityById('mend')!.power * STAFF.healMult));
    l.weapon = 'censer';
    const base = STRESS.basePerSec;
    STRESS.basePerSec = 0;
    w.stress = 50;
    act(world, room, 'a1', 'h1');
    STRESS.basePerSec = base;
    expect(w.stress).toBeCloseTo(50 - Math.round(abilityById('vigil')!.power * STAFF.reliefMult), 0);
  });

  it('Evergreen doubles the buffs you place', () => {
    const { world, ids, room } = arena(['warden'], ['ghoul']);
    world.heroes.h0.weapon = 'evergreen';
    walkIn(world, ids, room);
    act(world, room, 'a1'); // Vengeance
    expect(world.heroes.h0.st.vengeance).toBe(2 * CLASS_RULES.vengeanceTurns);
  });

  it('Warding Staff shields whoever you help, even out of a fight; the Shield lasts into the next fight and ends with it', () => {
    const { world, room, monsters } = arena(['lampbearer', 'warden'], ['ghoul']);
    const [l, w] = [world.heroes.h0, world.heroes.h1];
    l.weapon = 'wardstaff';
    w.hp -= 10;
    useSkill(world, l, 'mend', 'h1');
    expect(w.st.shield).toBe(STAFF.wardShield);
    walkIn(world, ['h1'], room);
    expect(w.encounter).toBe(room);
    expect(w.st.shield).toBe(STAFF.wardShield);
    for (const m of monsters) m.hp = 1;
    applyIntent(world, 'h1', { type: 'combat', choice: { action: 'a0' } });
    for (let i = 0; i < 300 && w.encounter !== null; i++) step(world, 0.1);
    expect(w.encounter).toBeNull();
    expect(w.st.shield).toBeUndefined();
  });

  it('Witchwood: what carries your debuff takes 15% more from everyone, until its debuffs are gone', () => {
    const { world, ids, room, monsters } = arena(['sorceress'], ['ghoul']);
    world.heroes.h0.weapon = 'witchwood';
    walkIn(world, ids, room);
    act(world, room, 'a2'); // Wither marks every foe
    const m = monsters[0];
    expect(m.st.witchwood).toBe(true);
    expect(witchwoodMult(m.st)).toBe(STAFF.witchMult);
    delete m.st.weak;
    expect(witchwoodMult(m.st)).toBe(1);
    expect(m.st.witchwood).toBeUndefined();
  });
});

describe('cloth', () => {
  function arena(classes: ClassId[], enemies: EnemyId[] = []) {
    const world = createWorld(777, { monsters: false, loot: false });
    const d = world.dungeon;
    classes.forEach((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }));
    const room = neighbours(d, d.entrance)[0];
    const monsters = spawnGroup(world, room, enemies, 0);
    for (const m of monsters) m.hp = m.maxHp = 999;
    return { world, d, room, monsters };
  }
  function walk(world: World, id: string, room: number) {
    applyIntent(world, id, { type: 'goto', room });
    for (let i = 0; i < 150 && !(world.heroes[id].pos.kind === 'room' && world.heroes[id].pos.room === room); i++) step(world, 0.1);
  }

  it('a copy keeps its charge when it changes hands: a spent Gravecloth stays spent', () => {
    const { world, d } = arena(['warden', 'cutthroat']);
    const [a, b] = [world.heroes.h0, world.heroes.h1];
    a.armor = 'gravecloth';
    spendCloth(a, clothReady(a, 'grave')!);
    expect(clothReady(a, 'grave')).toBeNull();
    applyIntent(world, 'h0', { type: 'unequip', slot: 'armor' });
    const f = world.piles[d.entrance].items[0];
    expect(f.charge?.usesLeft).toBe(0);
    applyIntent(world, 'h1', { type: 'claim', item: f.id });
    expect(b.armor).toBe('gravecloth');
    expect(clothReady(b, 'grave')).toBeNull();
  });

  it('cooldowns only run while worn; a disabled piece never goes off', () => {
    const { world } = arena(['warden']);
    const h = world.heroes.h0;
    h.armor = 'wayfarer';
    spendCloth(h, clothReady(h, 'wayfarer')!);
    h.items = ['jerkin'];
    applyIntent(world, 'h0', { type: 'useItem', index: 0 }); // puts on the jerkin; the cloak goes in the pack
    expect(h.armor).toBe('jerkin');
    run(world, 30);
    expect(h.packCharges[0].charge.cdLeft).toBe(12);
    applyIntent(world, 'h0', { type: 'useItem', index: h.items.indexOf('wayfarer') });
    expect(h.armor).toBe('wayfarer');
    run(world, 12.2);
    expect(clothReady(h, 'wayfarer')).not.toBeNull();
    applyIntent(world, 'h0', { type: 'toggleAuto', slot: 'armor' });
    expect(clothReady(h, 'wayfarer')).toBeNull();
    applyIntent(world, 'h0', { type: 'toggleAuto', slot: 'armor' });
    expect(clothReady(h, 'wayfarer')).not.toBeNull();
  });

  it("Wayfarer's Cloak: the next tunnel takes 1s", () => {
    const { world, room } = arena(['bellwright']);
    const h = world.heroes.h0;
    h.armor = 'wayfarer';
    applyIntent(world, 'h0', { type: 'goto', room });
    run(world, 0.3);
    expect(h.pos.kind === 'corridor' && h.pos.dur).toBe(CLOTH.wayfarerSecs);
    run(world, 1.2);
    expect(h.pos).toEqual({ kind: 'room', room });
  });

  it('Hastening Robe: an event takes 3s', () => {
    const { world } = arena(['warden']);
    const h = world.heroes.h0;
    h.armor = 'hastening';
    expect(eventTime(world, h, 'altar')).toBe(CLOTH.hastenSecs);
    spendCloth(h, clothReady(h, 'hasten')!);
    expect(eventTime(world, h, 'altar')).toBe(18);
  });

  it('Softstep: walking in on monsters starts no fight, until an ally walks in; it hides you from wanderers too', () => {
    const { world, room } = arena(['cutthroat', 'warden'], ['ghoul']);
    const [s, w] = [world.heroes.h0, world.heroes.h1];
    s.armor = 'softstep';
    walk(world, 'h0', room);
    expect(s.encounter).toBeNull();
    expect(world.encounters[room]).toBeUndefined();
    expect(s.unnoticedIn).toBe(room);
    walk(world, 'h1', room);
    expect(w.encounter).toBe(room);
    expect(s.encounter).toBe(room);

    const quiet = arena(['cutthroat'], []);
    const q = quiet.world.heroes.h0;
    q.armor = 'softstep';
    const here = quiet.d.entrance;
    spawnGroup(quiet.world, here, ['ghoul'], 0); // a pack wanders in
    onHeroInRoom(quiet.world, q, here);
    expect(q.encounter).toBeNull();
  });

  it('Blinkcloth: instead of going down, out at 1 HP to a room next door, once a fight', () => {
    const { world, room } = arena(['cutthroat'], ['ghoul']);
    const h = world.heroes.h0;
    h.armor = 'blinkcloth';
    walk(world, 'h0', room);
    expect(h.encounter).toBe(room);
    const stress = h.stress;
    hurtHero(world, h, 999, null, world.encounters[room]);
    expect(h.downedAt).toBeNull();
    expect(h.hp).toBe(1);
    expect(h.encounter).toBeNull();
    expect(h.pos.kind === 'room' && h.pos.room !== room && neighbours(world.dungeon, room).includes(h.pos.room)).toBe(true);
    expect(h.stress).toBeGreaterThanOrEqual(stress + CLOTH.blinkStress);
    // Spent until the next fight it joins (leaving the old one doesn't rearm it).
    expect(clothReady(h, 'blink')).toBeNull();
    walk(world, 'h0', room);
    expect(h.encounter).toBe(room);
    expect(clothReady(h, 'blink')).not.toBeNull();
  });

  it('Gravecloth: gets you back up, again and again in that room, but not once you have left it', () => {
    const { world, d } = arena(['warden']);
    const h = world.heroes.h0;
    h.armor = 'gravecloth';
    const fall = () => hurtHero(world, h, 999, null);
    fall();
    expect(h.downedAt).not.toBeNull();
    run(world, 2 * speedOf(h, world.time) + 0.2);
    expect(h.downedAt).toBeNull();
    expect(h.hp).toBe(Math.ceil(h.maxHp * CLOTH.graveHp));
    fall();
    run(world, 2 * speedOf(h, world.time) + 0.2);
    expect(h.downedAt).toBeNull();
    walk(world, 'h0', neighbours(d, d.entrance)[0]);
    fall();
    expect(h.riseAt).toBeNull();
  });

  it("Patchwork halves the first blow of a fight; Gossamer makes the first attack miss; Penitent's Sackcloth heals below 30%", () => {
    const { world } = arena(['warden']);
    const h = world.heroes.h0;
    h.armor = 'sackcloth';
    expect(wornMult(h, 'stressMult')).toBe(1.25);
    const low = Math.floor(h.maxHp * 0.3) - 2; // below 30% (going below half also costs a Minor Injury's max HP)
    h.hp = low + 4;
    hurtHero(world, h, 4, null);
    expect(h.hp).toBe(Math.min(h.maxHp, low + CLOTH.penitentHeal));
    expect(clothReady(h, 'penitent')).toBeNull();

    for (const [armor, expectHit] of [['gossamer', false], ['patchwork', true]] as const) {
      const a = arena(['warden'], ['ghoul']);
      const w = a.world.heroes.h0;
      w.armor = armor;
      walk(a.world, 'h0', a.room);
      const hp = w.hp;
      for (let i = 0; i < 100 && !a.monsters[0].st.acted; i++) step(a.world, 0.1);
      expect(w.hp < hp, armor).toBe(expectHit);
      if (armor === 'patchwork') expect(hp - w.hp).toBeLessThan(ENEMIES.ghoul.dmg);
      expect(clothReady(w, armor === 'gossamer' ? 'gossamer' : 'patchwork')).toBeNull();
    }
  });
});
