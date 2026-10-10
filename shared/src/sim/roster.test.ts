import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRESS } from '../content/events';
import type { ClassId } from '../content/classes';
import { CR_RULES, crUnitChance, ENEMIES, rollRoster, UNITS_BY_TIER, type EnemyId, type Roster } from '../content/enemies';
import { neighbours } from '../dungeon/gen';
import { Rng } from '../rng';
import { armored, crUnits, doomOf, fieldTurn, pickGroup, spawnGroup } from './combat';
import { addHero, applyIntent, createWorld, step, type World } from './world';

const baseStress = STRESS.basePerSec;
beforeEach(() => void (STRESS.basePerSec = 0));
afterEach(() => void (STRESS.basePerSec = baseStress));

/** Ghoul and Crawler by default, Wight, Brute; Acolyte, Zombie, Queen and Lich only with CR. */
const ROSTER: Roster = {
  main: { 0: ['ghoul', 'crawler'], 1: ['wight'], 2: ['brute'], 3: [] },
  cr: { 0: 'acolyte', 1: 'zombie', 2: 'queen', 3: 'lich' },
};

function world(cr = 0) {
  return createWorld(3, { monsters: false, loot: false, escalates: false, events: false, cr, roster: ROSTER });
}

function arena(classes: ClassId[], enemies: EnemyId[]) {
  const w = createWorld(777, { monsters: false, loot: false, escalates: false, events: false });
  const d = w.dungeon;
  const ids = classes.map((cls, i) => addHero(w, { id: `h${i}`, name: `H${i}`, cls }).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(w, room, enemies, 0);
  for (const m of monsters) m.hp = m.maxHp = 999;
  return { world: w, ids, room, monsters };
}

function walkIn(w: World, ids: string[], room: number) {
  for (const id of ids) applyIntent(w, id, { type: 'goto', room });
  for (let i = 0; i < 100 && ids.some((id) => w.heroes[id].encounter === null); i++) step(w, 0.1);
}

function untilTurn(w: World, room: number, id: string) {
  const enc = w.encounters[room];
  if (!enc) return;
  const due = enc.next[id];
  for (let i = 0; i < 300 && w.encounters[room] === enc && enc.next[id] === due; i++) step(w, 0.1);
}

describe('Roster', () => {
  it('picks 2 T0, 1 T1 and 1 T2 default units, and one CR unit per tier from the rest', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = rollRoster(new Rng(seed));
      expect([r.main[0].length, r.main[1].length, r.main[2].length, r.main[3].length]).toEqual([2, 1, 1, 0]);
      for (const t of [0, 1, 2, 3] as const) {
        expect(r.cr[t]).not.toBeNull();
        expect(ENEMIES[r.cr[t]!].tier).toBe(t);
        expect(r.main[t]).not.toContain(r.cr[t]);
        expect([...r.main[t], r.cr[t]].sort()).toEqual([...UNITS_BY_TIER[t]].sort());
      }
    }
  });

  it('ordinary groups use only the default units: T1 from Escalation 1, T2 from Escalation 3', () => {
    const w = world();
    const seen = (esc: number) => {
      const s = new Set<EnemyId>();
      for (let i = 0; i < 300; i++) for (const u of pickGroup(w, esc)) s.add(u);
      return [...s].sort();
    };
    expect(seen(0)).toEqual(['crawler', 'ghoul']);
    expect(seen(1)).toEqual(['crawler', 'ghoul', 'wight']);
    expect(seen(3)).toEqual(['brute', 'crawler', 'ghoul', 'wight']);
  });

  it('a default Queen never stands alone', () => {
    const w = createWorld(3, { monsters: false, loot: false, events: false, roster: { ...ROSTER, main: { ...ROSTER.main, 2: ['queen'] } } });
    for (let i = 0; i < 200; i++) {
      const g = pickGroup(w, 3);
      if (g.includes('queen')) expect(g.length).toBeGreaterThan(1);
    }
  });
});

describe('CR units', () => {
  it('unlock at CR 1/2/4/5 at 25/20/15/10%, and grow 5/4/3/2% per CR above 6', () => {
    expect([0, 1, 2, 3].map((t) => crUnitChance(t as 0, 0))).toEqual([0, 0, 0, 0]);
    expect(crUnitChance(0, 1)).toBe(0.25);
    expect(crUnitChance(1, 1)).toBe(0);
    expect(crUnitChance(1, 2)).toBe(0.2);
    expect(crUnitChance(2, 3)).toBe(0);
    expect(crUnitChance(2, 4)).toBe(0.15);
    expect(crUnitChance(3, 5)).toBe(0.1);
    expect(crUnitChance(3, 6)).toBe(0.1);
    expect(crUnitChance(0, 8)).toBeCloseTo(0.35);
    expect(crUnitChance(3, 8)).toBeCloseTo(0.14);
  });

  it('are rolled independently for each group, and all come to a lair', () => {
    const w = world(5);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) for (const u of crUnits(w, ['ghoul'], 'room', 0)) counts[u] = (counts[u] ?? 0) + 1;
    expect(counts.acolyte / 2000).toBeCloseTo(0.25, 1);
    expect(counts.zombie / 2000).toBeCloseTo(0.2, 1);
    expect(counts.queen / 2000).toBeCloseTo(0.15, 1);
    expect(counts.lich / 2000).toBeCloseTo(0.1, 1);
    expect(crUnits(w, ['ghoul'], 'lair', 0).sort()).toEqual(['acolyte', 'ghoul', 'lich', 'queen', 'zombie']);
    expect(crUnits(world(2), ['ghoul'], 'lair', 0).sort()).toEqual(['acolyte', 'ghoul', 'zombie']);
    expect(crUnits(world(0), ['ghoul'], 'lair', 0)).toEqual(['ghoul']);
  });

  it('never put a second Queen or Lich in a room', () => {
    const w = world(5);
    spawnGroup(w, 0, ['queen', 'lich'], 0);
    expect(crUnits(w, ['ghoul'], 'lair', 0).sort()).toEqual(['acolyte', 'ghoul', 'zombie']);
  });
});

describe('Zombie', () => {
  it('gets back up where it fell 12s later, worth nothing the second time', () => {
    const { world: w, ids, room, monsters } = arena(['undertaker'], ['zombie']);
    walkIn(w, ids, room);
    const z = monsters[0];
    z.hp = 998;
    // Last Rites kills it outright.
    applyIntent(w, 'h0', { type: 'combat', choice: { action: 'a1', target: z.id } });
    untilTurn(w, room, 'h0');
    expect(w.monsters[z.id]).toBeUndefined();
    expect(w.risings).toHaveLength(1);
    expect(w.encounters[room]).toBeUndefined();
    for (let i = 0; i < CR_RULES.zombieRise * 10 + 2; i++) step(w, 0.1);
    const back = Object.values(w.monsters).find((m) => m.room === room);
    expect(back?.type).toBe('zombie');
    expect(back?.hp).toBe(999);
    expect(back?.again).toBe(true);
    expect(w.encounters[room]?.heroes).toContain('h0');
  });

  it('stays down if an Undertaker raises it', () => {
    const { world: w, ids, room, monsters } = arena(['undertaker'], ['zombie', 'ghoul']);
    walkIn(w, ids, room);
    const z = monsters[0];
    z.hp = 998;
    applyIntent(w, 'h0', { type: 'combat', choice: { action: 'a1', target: z.id } });
    untilTurn(w, room, 'h0');
    expect(w.risings).toHaveLength(1);
    applyIntent(w, 'h0', { type: 'combat', choice: { action: 'a2' } });
    untilTurn(w, room, 'h0');
    expect(w.encounters[room].risen?.type).toBe('zombie');
    expect(w.risings).toHaveLength(0);
  });
});

describe('Lich', () => {
  it('sears every hero before each of their turns (armor applies, Doom adds)', () => {
    const { world: w, ids, room } = arena(['warden'], ['lich']);
    walkIn(w, ids, room);
    const enc = w.encounters[room];
    const h = w.heroes.h0;
    h.st.doom = 2;
    untilTurn(w, room, 'h0');
    const aura = enc.events.find((e) => e.target === 'h0' && e.text.includes('cold presence'));
    expect(aura?.amount).toBe(armored(h, ENEMIES.lich.dmg) + 2);
  });

  it('raises the newest slain monster whole, once; otherwise stacks Doom', () => {
    const { world: w, ids, room, monsters } = arena(['sorceress'], ['lich', 'ghoul']);
    walkIn(w, ids, room);
    const [lich, ghoul] = monsters;
    const enc = w.encounters[room];
    delete w.monsters[ghoul.id];
    enc.slain = [{ id: ghoul.id, type: 'ghoul', maxHp: 40, dmgMult: 1 }];
    untilTurn(w, room, lich.id);
    const back = Object.values(w.monsters).find((m) => m.type === 'ghoul');
    expect(back?.hp).toBe(40);
    expect(lich.spent).toBe(true);
    const h = w.heroes.h0;
    expect(h.st.doom).toBeUndefined();
    untilTurn(w, room, lich.id);
    untilTurn(w, room, lich.id);
    // Two stacks, and none faded on the hero's turns between: the Lich still stands.
    expect(h.st.doom).toBe(2);
    expect(doomOf(h)).toBe(2 * CR_RULES.doom);
  });

  it('Doom fades one stack per turn once no Lich stands, and outlasts the fight', () => {
    const { world: w, ids, room, monsters } = arena(['warden'], ['ghoul']);
    walkIn(w, ids, room);
    const h = w.heroes.h0;
    h.st.doom = 3;
    applyIntent(w, 'h0', { type: 'combat', choice: { action: 'a0' } });
    untilTurn(w, room, 'h0');
    expect(h.st.doom).toBe(2);
    delete w.monsters[monsters[0].id];
    h.encounter = null;
    h.st = { doom: 2 };
    h.cooldowns = {};
    fieldTurn(w, h);
    expect(h.st.doom).toBe(1);
    fieldTurn(w, h);
    expect(h.st.doom).toBeUndefined();
  });
});
