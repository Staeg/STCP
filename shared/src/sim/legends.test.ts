import { describe, expect, it } from 'vitest';
import { CARD_RULES, CARDS } from '../content/cards';
import { CROWNED } from '../content/events';
import { gearCard, isCursed, ITEMS, itemTier, LEGENDARY_IDS, LOOT_TABLE } from '../content/items';
import { LEGEND_RULES } from '../content/legends';
import { dieOut, heroBlock } from './combat';
import { deckList } from './deck';
import { equip, equipFromPack, giveItem } from './loot';
import { legendsOf, wolvesOf } from './legends';
import { kitCr, kitError } from '../village';
import { arena, play, walkIn } from './testkit';
import { step } from './world';

/** A fight with tough, patient monsters. */
function fight(classes: Parameters<typeof arena>[0], enemies: Parameters<typeof arena>[1] = ['ghoul']) {
  const a = arena(classes, enemies);
  for (const m of a.monsters) m.hp = m.maxHp = 999;
  return a;
}

describe('Legendary items', () => {
  it('are tier 4, never found in ordinary loot, never cursed, and add a whole CR from the Village', () => {
    expect(LEGENDARY_IDS).toHaveLength(8);
    for (const it of LEGENDARY_IDS) {
      expect(itemTier(it)).toBe(4);
      expect(isCursed(it)).toBe(false);
      expect(LOOT_TABLE.some((e) => e.item === it)).toBe(false);
      expect(CARDS[gearCard(it)].name.toLowerCase()).toBe(ITEMS[it].legend);
    }
    expect(kitCr({ gear: { weapon: 'alastor', ring: 'catseye' }, consumables: [], rites: [] })).toBe(1.2);
    expect(CROWNED).toMatchObject({ lairs: 2, legendaries: 1 });
  });

  it('put their card in the deck of whoever wears them, and only one can be worn', () => {
    const { world } = fight(['warden']);
    const h = world.heroes.h0;
    expect(legendsOf(h)).toEqual([]);
    equip(h, 'weapon', 'hollowrod');
    expect(legendsOf(h)).toEqual(['unmake']);
    expect(deckList(h)).toContain('unmake');
    // Only one Legendary at a time: a second goes in the pack, and won't go on.
    giveItem(h, 'fenrir');
    expect(h.amulet).toBeNull();
    expect(equipFromPack(world, h, h.items.indexOf('fenrir'))).toMatch(/one Legendary/);
    equip(h, 'weapon', null);
    expect(equipFromPack(world, h, h.items.indexOf('fenrir'))).toBeNull();
    expect(h.maxHp).toBe(54 + 20);
    expect(deckList(h)).toContain('howl');
    expect(kitError({ gear: { weapon: 'alastor', ring: 'silva' }, consumables: [], rites: [] }, ['alastor', 'silva'], { effigy: 0, gem: 0, tome: 0, relic: 0 })).toMatch(/one Legendary/);
  });
});

describe('Legendary cards', () => {
  it('Quake: every enemy is hit and Stunned', () => {
    const { world, ids, room, monsters } = fight(['warden'], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    play(world, world.heroes.h0, 'quake');
    for (const m of monsters) {
      expect(m.hp).toBe(999 - CARD_RULES.quake);
      expect(m.st.stun).toBe(true);
    }
  });

  it('Redeem: full HP and no stress, but no light either; it burns', () => {
    const { world, ids, room } = fight(['warden', 'zealot']);
    walkIn(world, ids, room);
    const z = world.heroes.h1;
    z.hp = 5;
    z.stress = 60;
    play(world, world.heroes.h0, 'redeem', z.id);
    expect([z.hp, z.light]).toEqual([z.maxHp, 0]);
    expect(z.stress).toBeLessThan(1); // the dark starts gnawing at once
    expect(world.heroes.h0.burned).toEqual(['redeem']);
  });

  it('Bastion: Shield of 3× your Block', () => {
    const { world, ids, room } = fight(['warden']);
    const h = world.heroes.h0;
    h.armor = 'durance';
    walkIn(world, ids, room);
    play(world, h, 'bastion');
    expect(h.st.shield).toBe(heroBlock(h) * CARD_RULES.bastionPerBlock);
  });

  it('Forgive: a dead ally in the room lives again at full HP', () => {
    const { world, ids, room } = fight(['warden', 'cutthroat']);
    walkIn(world, ids, room);
    const c = world.heroes.h1;
    dieOut(world, c);
    expect(c.dead).toBe(true);
    play(world, world.heroes.h0, 'forgive');
    expect(c.dead).toBe(false);
    expect(c.hp).toBe(c.maxHp);
  });

  it('Howl: a wolf joins for the run, up to four; with four, it heals them', () => {
    const { world, ids, room, monsters } = fight(['warden']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    for (let i = 0; i < LEGEND_RULES.maxWolves + 1; i++) play(world, h, 'howl');
    expect(wolvesOf(world, h)).toBe(LEGEND_RULES.maxWolves);
    // The fight ends: the wolves stay with the Warden.
    for (const m of monsters) delete world.monsters[m.id];
    step(world, 0.1);
    expect(h.encounter).toBeNull();
    expect(h.legion.filter((r) => r.type === 'wolf')).toHaveLength(LEGEND_RULES.maxWolves);
  });
});
