import { describe, expect, it } from 'vitest';
import { emergenciesAt, emergencyWarning, type EmergencyId } from '../content/emergencies';
import type { ClassId } from '../content/classes';
import { Stash } from '../stash';
import { emptyKit, type Loadout } from '../village';
import { bleedOut } from './combat';
import { carriedHome, emergencyDone, emergencyProgress } from './emergency';
import { addHero, createWorld, extractHero, step, type World } from './world';

const SEEDS = Array.from({ length: 12 }, (_, i) => 100 + i * 17);

function loadout(owner: string, emergency: EmergencyId | null, rites: Loadout['kit'] = emptyKit()): Loadout {
  return { charId: 'c1', charName: owner, owner, talent: null, injuries: [], affliction: null, kit: rites, emergency };
}

function hero(w: World, id: string, cls: ClassId, emergency: EmergencyId | null = null, isBot = false, kit = emptyKit()) {
  return addHero(w, { id, name: id, cls, isBot, loadout: loadout(id, emergency, kit) });
}

const quiet = { monsters: false, loot: false, escalates: false, events: false } as const;

describe('Emergency seeding', () => {
  it('guarantees enough captives and Altars (the largest need of the party)', () => {
    for (const seed of SEEDS) {
      const w = createWorld(seed, { emergencies: ['patrol', 'exodus'] });
      expect(Object.values(w.villagers).filter((v) => v.state === 'captive').length).toBeGreaterThanOrEqual(4);
      const a = createWorld(seed, { emergencies: ['wells', 'lamps'] });
      expect(Object.values(a.events).filter((e) => e.kind === 'altar').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Quarry: kill targets are default units and are placed at the start', () => {
    for (const seed of SEEDS) {
      const w = createWorld(seed, { emergencies: ['shadows'] });
      expect(w.roster.main[1]).toContain('wight');
      expect(w.roster.cr[1]).not.toBe('wight');
      expect(Object.values(w.monsters).filter((m) => m.type === 'wight').length).toBeGreaterThanOrEqual(3);
      const q = createWorld(seed, { emergencies: ['envoy'] });
      expect(q.roster.main[2]).toContain('queen');
      expect(Object.values(q.monsters).some((m) => m.type === 'queen')).toBe(true);
    }
  });

  it('Liches come only at CR 5', () => {
    for (const seed of SEEDS) {
      const w = createWorld(seed, { emergencies: ['liches'], cr: 5 });
      expect(Object.values(w.monsters).filter((m) => m.type === 'lich').length).toBeGreaterThanOrEqual(2);
    }
    const low = createWorld(SEEDS[0], { emergencies: ['liches'], cr: 4 });
    expect(Object.values(low.monsters).some((m) => m.type === 'lich')).toBe(false);
    const h = hero(low, 'ann', 'warden', 'liches');
    expect(emergencyProgress(low, h)?.impossible).toMatch(/No Liches/);
  });

  it('Tithe: a sure Relic in a lair and 2 Gems per Tithe player', () => {
    for (const seed of SEEDS) {
      const base = createWorld(seed, {});
      const w = createWorld(seed, { emergencies: ['tithe', 'tithe'] });
      const count = (x: World, it: string) => Object.values(x.piles).reduce((s, p) => s + p.items.filter((f) => f.item === it).length, 0);
      expect(count(w, 'relic') - count(base, 'relic')).toBe(2);
      expect(count(w, 'gem') - count(base, 'gem')).toBe(4);
      const lairRelics = Object.entries(w.piles).filter(([room, p]) => (w.bounty[+room] ?? 0) > 0 && p.items.some((f) => f.item === 'relic'));
      expect(lairRelics.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Emergency progress', () => {
  it('party-wide goals count what anyone did, even if your hero died', () => {
    const w = createWorld(1, quiet);
    const ann = hero(w, 'ann', 'warden', 'shadows');
    hero(w, 'bot', 'zealot', null, true);
    w.kills.wight = 3;
    bleedOut(w, ann);
    expect(emergencyDone(w, ann)).toBe(true);
    expect(w.heroes.bot.emergency).toBeNull();
  });

  it('Exodus needs every player out, not the bots', () => {
    const w = createWorld(1, quiet);
    const ann = hero(w, 'ann', 'warden', 'exodus');
    hero(w, 'bob', 'zealot', 'lamps');
    hero(w, 'bot', 'alchemist', null, true);
    w.objectives.villagers = 4;
    extractHero(w, ann);
    expect(emergencyDone(w, ann)).toBe(false);
    extractHero(w, w.heroes.bob);
    expect(emergencyDone(w, ann)).toBe(true);
  });

  it('personal goals need your hero to carry it out', () => {
    const w = createWorld(1, quiet);
    const ann = hero(w, 'ann', 'warden', 'larders');
    ann.items.push('gem', 'tome', 'effigy');
    expect(emergencyProgress(w, ann)?.done).toBe(true);
    bleedOut(w, ann);
    expect(emergencyDone(w, ann)).toBe(false);
  });

  it('a fallen player an Undertaker Raises and walks out carries their Emergency home', () => {
    const w = createWorld(1, quiet);
    const ann = hero(w, 'ann', 'warden', 'larders');
    const und = hero(w, 'und', 'undertaker', null, true);
    ann.items.push('gem', 'tome', 'effigy', 'torch');
    bleedOut(w, ann);
    step(w, 0.1);
    expect(und.legion.map((r) => r.hero)).toEqual(['ann']);
    expect(emergencyDone(w, ann)).toBe(false);
    extractHero(w, und);
    expect(emergencyDone(w, ann)).toBe(true);
    expect(carriedHome(ann)).toEqual(expect.arrayContaining(['effigy', 'gem', 'tome', 'torch']));
  });

  it('the Tome Rite takes consumables home too, Resources not', () => {
    const w = createWorld(1, quiet);
    const kit = { ...emptyKit(), rites: ['tome' as const] };
    const ann = hero(w, 'ann', 'warden', 'fever', false, kit);
    ann.items.push('bandage', 'salts', 'gem');
    bleedOut(w, ann);
    expect(ann.legacyItems.sort()).toEqual(['bandage', 'salts']);
    expect(emergencyDone(w, ann)).toBe(true);
  });
});

describe('Wellbeing in the Village', () => {
  it('offers the two Emergencies of its Wellbeing, and moves Wellbeing by one per run', () => {
    const s = new Stash(null);
    expect(s.village('Ann').wellbeing).toBe(3);
    expect(s.village('Ann').offered).toEqual(emergenciesAt(3));
    expect(s.chooseEmergency('Ann', 'liches')).toMatch(/isn't/);
    expect(s.chooseEmergency('Ann', 'patrol')).toBeNull();
    expect(s.settleEmergency('Ann', 'patrol', true)).toEqual(['The Missing Patrol: done. Wellbeing 3 → 4.']);
    expect(s.village('Ann').emergency).toBeNull();
    expect(s.village('Ann').offered).toEqual(['envoy', 'tithe']);
  });

  it('wins at 6 and loses at 0; then Reset keeps the Village, Start Over doesn’t', () => {
    const s = new Stash(null);
    s.storeLoot('Ann', ['mace', 'gem']);
    s.settleEmergency('Ann', 'patrol', true);
    s.settleEmergency('Ann', 'tithe', true);
    expect(s.settleEmergency('Ann', 'exodus', true)).toContain('The Village prospers. You have won!');
    expect(s.village('Ann').fate).toBe('won');
    expect(s.village('Ann').wellbeing).toBe(6);
    expect(s.chooseEmergency('Ann', 'liches')).toMatch(/over/);
    expect(s.chooseFate('Ann', 'reset')).toBeNull();
    expect(s.village('Ann')).toMatchObject({ wellbeing: 3, fate: null, items: ['mace'] });

    for (const id of ['patrol', 'fever', 'lamps'] as const) s.settleEmergency('Ann', id, false);
    expect(s.village('Ann').fate).toBe('lost');
    const before = s.village('Ann').characters.map((c) => c.id);
    expect(s.chooseFate('Ann', 'restart')).toBeNull();
    const v = s.village('Ann');
    expect(v).toMatchObject({ wellbeing: 3, fate: null, items: [], purse: 0 });
    expect(v.resources.gem).toBe(0);
    expect(v.characters.map((c) => c.id)).not.toEqual(before);
  });

  it('what has to be carried out can’t be carried in', () => {
    const s = new Stash(null);
    s.storeLoot('Ann', ['bandage', 'torch']);
    expect(s.setKit('Ann', { ...emptyKit(), consumables: ['bandage', 'torch'] })).toBeNull();
    // Fever Season is a Wellbeing 2 Emergency.
    s.settleEmergency('Ann', 'patrol', false);
    expect(s.chooseEmergency('Ann', 'fever')).toBeNull();
    expect(s.kitOf('Ann').consumables).toEqual(['torch']);
    expect(s.setKit('Ann', { ...emptyKit(), consumables: ['bandage'] })).toMatch(/Fever Season/);
  });

  it('warns when the setup makes an Emergency impossible', () => {
    expect(emergencyWarning('liches', { cr: 5 })).toBeNull();
    expect(emergencyWarning('liches', { cr: 4.6 })).toMatch(/60% chance/);
    expect(emergencyWarning('liches', { cr: 3 })).toMatch(/^Impossible/);
    expect(emergencyWarning('liches', {})).toMatch(/lobby/);
    expect(emergencyWarning('fever', { rites: ['gem'] })).toMatch(/Gem Rite/);
    expect(emergencyWarning('patrol', { cr: 0, rites: ['gem'] })).toBeNull();
  });
});
