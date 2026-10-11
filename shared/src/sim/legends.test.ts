import { describe, expect, it } from 'vitest';
import { neighbours } from '../dungeon/gen';
import { ENEMIES } from '../content/enemies';
import { CROWNED } from '../content/events';
import { isCursed, ITEMS, itemTier, LEGENDARY_IDS, LOOT_TABLE } from '../content/items';
import { LEGEND_RULES, LEGENDS } from '../content/legends';
import { dieOut, downHero, heroBlock, monsterBlock, onHeroInRoom, spawnGroup, submitChoice } from './combat';
import { addToPile, equip, equipFromPack, giveItem } from './loot';
import { checkSkill, fieldSkillsOf, useSkill } from './skills';
import { legendsOf, wolvesOf } from './legends';
import { buildView } from './views';
import { kitCr, kitError } from '../village';
import { addHero, createWorld, step, type World } from './world';
import type { ClassId } from '../content/classes';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

function party(classes: ClassId[]) {
  const world = createWorld(4242, { monsters: false, loot: false, escalates: false, events: false });
  classes.forEach((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }));
  const d = world.dungeon;
  return { world, d, room: neighbours(d, d.entrance)[0] };
}

describe('Legendary items', () => {
  it('are tier 4, never found in ordinary loot, never cursed, and add a whole CR from the Village', () => {
    expect(LEGENDARY_IDS).toHaveLength(8);
    for (const it of LEGENDARY_IDS) {
      expect(itemTier(it)).toBe(4);
      expect(isCursed(it)).toBe(false);
      expect(LOOT_TABLE.some((e) => e.item === it)).toBe(false);
      expect(LEGENDS[ITEMS[it].legend!]).toBeDefined();
    }
    expect(kitCr({ gear: { weapon: 'alastor', ring: 'catseye' }, consumables: [], rites: [] })).toBe(1.2);
    expect(CROWNED).toMatchObject({ lairs: 2, legendaries: 1 });
  });

  it('give their ability to whoever wears them, and only to them', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    expect(legendsOf(h)).toEqual([]);
    equip(h, 'weapon', 'hollowrod');
    expect(legendsOf(h)).toEqual(['unmake']);
    expect(fieldSkillsOf(h)).toEqual(['unmake']);
    // Only one Legendary at a time: a second goes in the pack, and won't go on.
    giveItem(h, 'fenrir');
    expect(h.amulet).toBeNull();
    expect(equipFromPack(world, h, h.items.indexOf('fenrir'))).toMatch(/one Legendary/);
    equip(h, 'weapon', null);
    expect(equipFromPack(world, h, h.items.indexOf('fenrir'))).toBeNull();
    expect(h.maxHp).toBe(54 + 20);
    expect(kitError({ gear: { weapon: 'alastor', ring: 'silva' }, consumables: [], rites: [] }, ['alastor', 'silva'], { effigy: 0, gem: 0, tome: 0, relic: 0 })).toMatch(/one Legendary/);
    // Quake only works in a fight.
    equip(h, 'weapon', 'earthsplitter');
    expect(fieldSkillsOf(h)).not.toContain('quake');
    expect(checkSkill(world, h, 'quake', null)).toBeTruthy();
  });
});

describe('Legendary abilities', () => {
  it('Promise: the strongest non-Boss foe of the next fight dies as it begins', () => {
    const { world, room } = party(['cutthroat']);
    const h = world.heroes.h0;
    equip(h, 'weapon', 'alastor');
    useSkill(world, h, 'promise', null);
    expect(h.promise).toBe(true);
    expect(h.cooldowns.promise).toBe(LEGENDS.promise.cooldown);
    expect(checkSkill(world, h, 'promise', null)).toBeTruthy();
    const [ghoul, giant, king] = spawnGroup(world, room, ['ghoul', 'giant', 'king'], 0);
    h.pos = { kind: 'room', room };
    onHeroInRoom(world, h, room);
    expect(world.monsters[giant.id]).toBeUndefined();
    expect(world.encounters[room].log).toContain('The Bone Giant dies as faint laughter echoes.');
    expect(world.monsters[ghoul.id]).toBeDefined();
    expect(world.monsters[king.id]).toBeDefined();
    expect(h.promise).toBe(false);
  });

  it('Quake: every enemy takes your basic attack and is Stunned', () => {
    const { world, room } = party(['warden']);
    const h = world.heroes.h0;
    equip(h, 'weapon', 'earthsplitter');
    const foes = spawnGroup(world, room, ['giant', 'giant'], 0);
    h.pos = { kind: 'room', room };
    onHeroInRoom(world, h, room);
    expect(submitChoice(world, h, { action: 'legend', legend: 'quake' })).toBeNull();
    run(world, 6.6); // Speed 6, +0.5 for the hammer
    for (const m of foes) {
      expect(m.hp).toBeLessThan(m.maxHp);
      expect(m.st.stun || m.hp <= 0).toBeTruthy();
    }
    expect(h.cooldowns.quake).toBeGreaterThan(0);
  });

  it('Unmake: monsters, loot and the event in a known room are gone', () => {
    const { world, room } = party(['sorceress']);
    const h = world.heroes.h0;
    equip(h, 'weapon', 'hollowrod');
    spawnGroup(world, room, ['ghoul'], 0);
    addToPile(world, room, 20, ['bandage']);
    world.events[room] = { kind: 'altar', room, done: false } as never;
    expect(checkSkill(world, h, 'unmake', null, null)).toMatch(/room/);
    if (!h.seen.includes(room)) h.seen.push(room);
    useSkill(world, h, 'unmake', null, room);
    expect(world.events[room]).toBeUndefined();
    expect(world.piles[room]).toBeUndefined();
    expect(Object.values(world.monsters).filter((m) => m.room === room)).toEqual([]);
  });

  it('Redeem: full HP and no stress, but no light either', () => {
    const { world } = party(['warden', 'lampbearer']);
    const [h, t] = [world.heroes.h0, world.heroes.h1];
    equip(h, 'armor', 'daystar');
    t.hp = 5;
    t.stress = 60;
    useSkill(world, h, 'redeem', t.id);
    expect(t).toMatchObject({ hp: t.maxHp, stress: 0, light: 0 });
  });

  it('Bastion: Shield of 3× your Block', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    equip(h, 'armor', 'durance');
    expect(heroBlock(h)).toBe(6);
    useSkill(world, h, 'bastion', null);
    expect(h.st.shield).toBe(6 * LEGEND_RULES.bastionPerBlock);
  });

  it('Forgive: a dead ally in your room lives again at full HP', () => {
    const { world, d } = party(['warden', 'zealot']);
    const [h, t] = [world.heroes.h0, world.heroes.h1];
    equip(h, 'armor', 'pilgrim');
    downHero(world, t, null);
    dieOut(world, t);
    expect(t.dead).toBe(true);
    expect(checkSkill(world, h, 'forgive', t.id)).toBeNull();
    useSkill(world, h, 'forgive', t.id);
    expect(t.dead).toBe(false);
    expect(t.downedAt).toBeNull();
    expect(t.hp).toBe(t.maxHp);
    expect(t.pos).toEqual({ kind: 'room', room: d.entrance });
  });

  it('Howl: up to four wolves follow you into fights, and their bites cost Block', () => {
    const { world, room } = party(['warden']);
    const h = world.heroes.h0;
    equip(h, 'amulet', 'fenrir');
    for (let i = 0; i < LEGEND_RULES.maxWolves; i++) {
      delete h.cooldowns.howl;
      useSkill(world, h, 'howl', null);
    }
    expect(wolvesOf(world, h)).toBe(LEGEND_RULES.maxWolves);
    delete h.cooldowns.howl;
    expect(checkSkill(world, h, 'howl', null)).toMatch(/wolves/);
    const [giant] = spawnGroup(world, room, ['giant'], 0);
    giant.hp = giant.maxHp = 999;
    h.pos = { kind: 'room', room };
    onHeroInRoom(world, h, room);
    expect(world.encounters[room].legion).toHaveLength(LEGEND_RULES.maxWolves);
    expect(buildView(world, 'h0').encounter!.legion.map((u) => u.name)).toEqual(Array(4).fill(ENEMIES.wolf.name));
    run(world, 5.5);
    expect(giant.st.sunder).toBeGreaterThan(0);
    expect(monsterBlock(world, giant)).toBe(ENEMIES.giant.block - giant.st.sunder!);
  });

  it('Waystep: into any room on your map, out of a fight if need be', () => {
    const { world, d, room } = party(['warden']);
    const h = world.heroes.h0;
    equip(h, 'ring', 'silva');
    const far = d.rooms.find((r) => r.id !== d.entrance && !neighbours(d, d.entrance).includes(r.id))!.id;
    expect(checkSkill(world, h, 'waystep', null, far)).toMatch(/know/);
    h.seen.push(far, room);
    useSkill(world, h, 'waystep', null, far);
    expect(h.pos).toEqual({ kind: 'room', room: far });
    expect(h.explored).toContain(far);
    // From a fight.
    delete h.cooldowns.waystep;
    spawnGroup(world, far, ['giant'], 0);
    onHeroInRoom(world, h, far);
    expect(h.encounter).toBe(far);
    expect(submitChoice(world, h, { action: 'legend', legend: 'waystep', room })).toBeNull();
    run(world, 6.1);
    expect(h.encounter).toBeNull();
    expect(h.pos).toEqual({ kind: 'room', room });
  });
});
