import { describe, expect, it } from 'vitest';
import { CLASS_IDS, CLASSES } from './content/classes';
import { Stash } from './stash';
import { applyRun, BUILDINGS, injuredMaxHp, upkeepOf, VILLAGE_RULES, VILLAGE_UPKEEP, type Character } from './village';
import { isGear, ITEMS, itemTier, type ItemId } from './content/items';
import { gearKind } from './content/forge';
import { addHero, createWorld } from './sim/world';
import { addToPile } from './sim/loot';

const fresh = (): Character => ({ id: 'c1', name: 'Ilse', cls: 'warden', xp: 0, survived: 0, talent: null, injuries: [], insane: false });
const ok = { escaped: true, lowestHp: 1, downedMajor: false, insane: false };

describe('applyRun', () => {
  it('gives 1 XP per run survived; 2 XP earns a Talent choice', () => {
    const c = fresh();
    applyRun(c, ok);
    expect(c.xp).toBe(1);
    const { lines } = applyRun(c, ok);
    expect(c.xp).toBe(VILLAGE_RULES.xpForTalent);
    expect(lines.join(' ')).toMatch(/choose a Talent/);
    applyRun(c, ok);
    expect(c.xp).toBe(VILLAGE_RULES.xpForTalent);
  });

  it('leaves a Minor below 50%, only a Major below 25%, and another Major for going down', () => {
    const c = fresh();
    applyRun(c, { ...ok, lowestHp: 0.4 });
    expect(c.injuries).toEqual(['minor']);
    applyRun(c, { ...ok, lowestHp: 0.2 });
    expect(c.injuries).toEqual(['minor', 'major']);
    c.injuries = [];
    applyRun(c, { ...ok, lowestHp: 0, downedMajor: true });
    expect(c.injuries).toEqual(['major', 'major']);
  });

  it('keeps Insanity from the run', () => {
    const c = fresh();
    applyRun(c, { ...ok, insane: true });
    expect(c.insane).toBe(true);
  });

  it('reports a death (the Stash replaces them)', () => {
    expect(applyRun(fresh(), { ...ok, escaped: false }).died).toBe(true);
  });
});

describe('injuries', () => {
  it('cut max HP by 10% (Minor) / 20% (Major), never below 40% of base', () => {
    const base = CLASSES.warden.maxHp;
    expect(injuredMaxHp('warden', [])).toBe(base);
    expect(injuredMaxHp('warden', ['minor'])).toBe(Math.round(base * 0.9));
    expect(injuredMaxHp('warden', ['minor', 'major'])).toBe(Math.round(base * 0.7));
    expect(injuredMaxHp('warden', ['major', 'major', 'major', 'major'])).toBe(Math.ceil(base * 0.4));
  });
});

describe('Stash villages', () => {
  it('founds a Village of one Character per class, with distinct names', () => {
    const stash = new Stash(null);
    const v = stash.village('Ann');
    expect(v.characters.map((c) => c.cls).sort()).toEqual([...CLASS_IDS].sort());
    expect(new Set(v.characters.map((c) => c.name)).size).toBe(CLASS_IDS.length);
    expect(stash.village('ann').characters).toEqual(v.characters);
  });

  it('only lets an earned Talent of the right class be chosen', () => {
    const stash = new Stash(null);
    const c = stash.characterFor('Ann', 'warden');
    expect(stash.chooseTalent('Ann', c.id, 'ironOath')).toMatch(/XP first/);
    stash.recordCharacter('Ann', c.id, ok);
    stash.recordCharacter('Ann', c.id, ok);
    expect(stash.chooseTalent('Ann', c.id, 'ghostStep')).toMatch(/not a Warden Talent/);
    expect(stash.chooseTalent('Ann', c.id, 'ironOath')).toBeNull();
    expect(stash.characterFor('Ann', 'warden').talent).toBe('ironOath');
    expect(stash.chooseTalent('Ann', c.id, 'unyielding')).toMatch(/already/);
  });

  it('replaces a Character who dies with a fresh recruit', () => {
    const stash = new Stash(null);
    const c = stash.characterFor('Ann', 'zealot');
    stash.recordCharacter('Ann', c.id, ok);
    const lines = stash.recordCharacter('Ann', c.id, { ...ok, escaped: false });
    const recruit = stash.characterFor('Ann', 'zealot');
    expect(recruit.id).not.toBe(c.id);
    expect(recruit.xp).toBe(0);
    expect(lines.join(' ')).toMatch(/takes their place/);
    expect(stash.village('Ann').report).toEqual(lines);
  });

  it('turns banked gold from before villages into the purse', () => {
    const stash = new Stash({ load: () => JSON.stringify({ ann: { name: 'Ann', gold: 300, runs: 3, escapes: 2, best: 200 } }), save: () => {} });
    expect(stash.purse('Ann')).toBe(300);
  });
});

describe('Stash migration', () => {
  it("loads Characters saved as the old 'witch' class as Sorceresses", () => {
    let saved = '';
    const first = new Stash({ load: () => null, save: (j) => void (saved = j) });
    first.village('Ada');
    first.recordRun('Ada', true, 10); // saves
    const old = saved.replace(/"cls"\s*:\s*"sorceress"/g, '"cls": "witch"');
    expect(old).toContain('"witch"');
    const loaded = new Stash({ load: () => old, save: () => {} });
    expect(loaded.village('Ada').characters.map((c) => c.cls).sort()).toEqual([...CLASS_IDS].sort());
  });
});

/** A Stash with plenty of every Resource. */
function rich(n = 40) {
  const stash = new Stash(null);
  stash.storeLoot('Ann', [...Array(n).fill('effigy'), ...Array(n).fill('gem'), ...Array(n).fill('tome'), ...Array(n).fill('relic')] as ItemId[]);
  return stash;
}

describe('Village buildings', () => {
  it('cost Resources to build, add upkeep per level, and come down for free', () => {
    const stash = new Stash(null);
    expect(stash.build('Ann', 'elder')).toMatch(/needs 2 Gems/);
    stash.storeLoot('Ann', ['gem', 'gem', 'gem', 'tome']);
    expect(stash.build('Ann', 'elder')).toBeNull();
    let v = stash.village('Ann');
    expect(v.buildings.elder).toBe(1);
    expect(v.resources.gem).toBe(1);
    expect(v.resources.tome).toBe(0);
    expect(v.upkeep).toBe(VILLAGE_UPKEEP + BUILDINGS.elder.levels[0].upkeep);
    expect(stash.demolish('Ann', 'elder')).toBeNull();
    v = stash.village('Ann');
    expect(v.buildings.elder).toBe(0);
    expect(v.resources.gem).toBe(1); // nothing back
    expect(upkeepOf({ blacksmith: 0, seer: 0, elder: 0 })).toBe(100);
    expect(upkeepOf({ blacksmith: 3, seer: 3, elder: 3 })).toBe(800);
  });

  it('upkeep comes out of the purse after the haul; short, levels fall at random until it can be paid', () => {
    const stash = rich();
    for (let i = 0; i < 3; i++) for (const b of ['blacksmith', 'seer', 'elder'] as const) expect(stash.build('Ann', b)).toBeNull();
    expect(stash.village('Ann').upkeep).toBe(800);
    stash.recordRun('Ann', true, 1000);
    stash.payUpkeep('Ann');
    expect(stash.purse('Ann')).toBe(200);
    // Next run brings nothing home: 200 gold can't keep 800 a run going.
    stash.recordRun('Ann', false, 0);
    const lines = stash.payUpkeep('Ann');
    const v = stash.village('Ann');
    expect(v.upkeep).toBeLessThanOrEqual(200);
    expect(stash.purse('Ann')).toBe(200 - v.upkeep);
    expect(lines.filter((l) => /closed/.test(l)).length).toBeGreaterThan(0);
    expect(v.wellbeing).toBe(3);
    // The lifetime total is untouched by upkeep.
    expect(stash.get('Ann')).toBe(1000);
  });

  it("a purse that can't cover the Village's own upkeep pays what it has and costs 1 Wellbeing", () => {
    const stash = rich();
    expect(stash.build('Ann', 'seer')).toBeNull();
    stash.recordRun('Ann', true, 60);
    const lines = stash.payUpkeep('Ann');
    const v = stash.village('Ann');
    expect(v.buildings.seer).toBe(0);
    expect(stash.purse('Ann')).toBe(0);
    expect(v.wellbeing).toBe(2);
    expect(lines).toContain(`Upkeep: −60 gold, ${VILLAGE_UPKEEP - 60} short.`);
    // At Wellbeing 1, going unpaid loses the game.
    stash.payUpkeep('Ann');
    stash.payUpkeep('Ann');
    expect(stash.village('Ann').wellbeing).toBe(0);
    expect(stash.village('Ann').fate).toBe('lost');
  });

  it('Elder: heals an Injury, cures Insanity, teaches XP for a Relic; each once before a run', () => {
    const stash = rich();
    for (let i = 0; i < 3; i++) stash.build('Ann', 'elder');
    const c = stash.characterFor('Ann', 'sorceress');
    stash.recordCharacter('Ann', c.id, { ...ok, lowestHp: 0.4, downedMajor: true, insane: true });
    expect(stash.characterFor('Ann', 'sorceress').injuries.sort()).toEqual(['major', 'minor']);
    expect(stash.useService('Ann', { service: 'heal', charId: c.id, injury: 'major' })).toBeNull();
    expect(stash.useService('Ann', { service: 'heal', charId: c.id, injury: 'minor' })).toMatch(/once before each run/);
    expect(stash.useService('Ann', { service: 'cure', charId: c.id })).toBeNull();
    const relics = stash.village('Ann').resources.relic;
    expect(stash.useService('Ann', { service: 'train', charId: c.id })).toBeNull();
    const after = stash.characterFor('Ann', 'sorceress');
    expect(after.injuries).toEqual(['minor']);
    expect(after.insane).toBe(false);
    expect(after.xp).toBe(2); // 1 for surviving, 1 taught
    expect(stash.village('Ann').resources.relic).toBe(relics - 1);
    // A new run (with the gold to keep the Elder), and the Elder is ready again.
    stash.recordRun('Ann', true, 500);
    stash.payUpkeep('Ann');
    expect(stash.useService('Ann', { service: 'heal', charId: c.id })).toBeNull();
    expect(stash.characterFor('Ann', 'sorceress').injuries).toEqual([]);
  });

  it('Blacksmith: forges a common piece, rerolls within type and rarity, and betters one for a Relic', () => {
    const stash = rich();
    for (let i = 0; i < 3; i++) stash.build('Ann', 'blacksmith');
    expect(stash.useService('Ann', { service: 'forge' })).toBeNull();
    const [made] = stash.village('Ann').items;
    expect(isGear(made)).toBe(true);
    expect(itemTier(made)).toBe(1);
    stash.storeLoot('Ann', ['ringmail', 'censer']);
    // The forged piece may share a kind (or even a name) with the ones reworked, and the Stash keeps itself sorted,
    // so find each new piece as what the Stash gained and lost across the service.
    const swap = (service: 'reroll' | 'upgrade', item: ItemId) => {
      const before = [...stash.village('Ann').items];
      expect(stash.useService('Ann', { service, item })).toBeNull();
      const left = [...before];
      const gained = stash.village('Ann').items.filter((x) => {
        const i = left.indexOf(x);
        return i < 0 || (left.splice(i, 1), false);
      });
      expect(left).toEqual([item]);
      expect(gained).toHaveLength(1);
      return gained[0];
    };
    const rolled = swap('reroll', 'ringmail');
    expect(gearKind(rolled)).toBe('mail');
    expect(itemTier(rolled)).toBe(1);
    const up = swap('upgrade', 'censer');
    expect(gearKind(up)).toBe('staff');
    expect(itemTier(up)).toBe(2);
  });

  it('Seer: what was foreseen shows on the map at the start of the next run', () => {
    const stash = rich();
    for (let i = 0; i < 2; i++) stash.build('Ann', 'seer');
    expect(stash.useService('Ann', { service: 'seeConsumable', pick: 'salts' })).toBeNull();
    expect(stash.useService('Ann', { service: 'seeResource', pick: 'gem' })).toBeNull();
    const sight = stash.takeSight('Ann');
    expect(sight).toEqual({ consumable: 'salts', resource: 'gem' });
    expect(stash.takeSight('Ann')).toBeUndefined();
    const world = createWorld(7, { monsters: false, loot: false });
    const far = world.dungeon.rooms.filter((r) => r.kind === 'normal').map((r) => r.id).slice(-2);
    addToPile(world, far[0], 0, ['salts']);
    addToPile(world, far[1], 0, ['torch']);
    const h = addHero(world, { id: 'h0', name: 'Ann', cls: 'warden', loadout: { charId: 'c', charName: 'A', owner: 'Ann', talents: [], injuries: [], insane: false, sight } });
    expect(h.seen).toContain(far[0]);
    expect(h.knownContents[far[0]].items).toContain('salts');
    expect(h.knownContents[far[1]]?.items ?? []).not.toContain('torch');
    expect(ITEMS.salts.kind).toBe('consumable');
  });
});
