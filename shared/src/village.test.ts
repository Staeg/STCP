import { describe, expect, it } from 'vitest';
import { CLASS_IDS, CLASSES } from './content/classes';
import { Stash } from './stash';
import { applyRun, injuredMaxHp, VILLAGE_RULES, type Character } from './village';

const fresh = (): Character => ({ id: 'c1', name: 'Ilse', cls: 'warden', xp: 0, survived: 0, talent: null, injuries: [], affliction: null });
const ok = { escaped: true, lowestHp: 1, downedMajor: false, affliction: null };

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

  it('keeps an affliction from the run', () => {
    const c = fresh();
    applyRun(c, { ...ok, affliction: 'fearful' });
    expect(c.affliction).toBe('fearful');
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

  it('spends the purse on treatment, and refuses when it is short', () => {
    const stash = new Stash(null);
    const c = stash.characterFor('Ann', 'sorceress');
    stash.recordCharacter('Ann', c.id, { ...ok, lowestHp: 0.1, affliction: 'paranoid' });
    expect(stash.treat('Ann', c.id, 'major')).toMatch(/costs 100/);
    stash.recordRun('Ann', true, 250);
    expect(stash.purse('Ann')).toBe(250);
    expect(stash.treat('Ann', c.id, 'minor')).toMatch(/nothing like that/);
    expect(stash.treat('Ann', c.id, 'major')).toBeNull();
    expect(stash.treat('Ann', c.id, 'affliction')).toBeNull();
    expect(stash.purse('Ann')).toBe(50);
    const after = stash.characterFor('Ann', 'sorceress');
    expect(after.injuries).toEqual([]);
    expect(after.affliction).toBeNull();
    // The lifetime total (titles, Hall of Fortune) is untouched by spending.
    expect(stash.get('Ann')).toBe(250);
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
