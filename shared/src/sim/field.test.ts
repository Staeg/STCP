import { describe, expect, it } from 'vitest';
import { FIELD_RULES as F } from '../content/innates';
import type { ClassId } from '../content/classes';
import { neighbours } from '../dungeon/gen';
import { monstersIn, onHeroInRoom, spawnGroup, submitChoice } from './combat';
import { CARD_RULES } from '../content/cards';
import { speedOf } from './speed';
import { setHand } from './testkit';
import { checkSkill, fieldSkillsOf, skillWait } from './skills';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Heroes at the exit of a quiet dungeon (no monsters, loot or events). */
function quiet(classes: ClassId[]) {
  const world = createWorld(41, { monsters: false, loot: false, escalates: false, events: false });
  const heroes = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }));
  return { world, heroes, h: heroes[0], room: world.dungeon.exit };
}

/** Pick a field ability and let the turn come round. */
function use(world: World, id: string, skill: Parameters<typeof checkSkill>[2]) {
  applyIntent(world, id, { type: 'skill', skill });
  run(world, 8);
}

describe('field abilities', () => {
  it('each class has one; the Bellwright keeps the Toll beside his', () => {
    expect(fieldSkillsOf({ cls: 'warden' })).toEqual(['formup']);
    expect(fieldSkillsOf({ cls: 'bellwright' })).toEqual(['toll', 'ringin']);
    expect(fieldSkillsOf({ cls: 'zealot' })).toEqual(['flagellate']);
  });

  it('take a turn, then cool down; not in a fight or a tunnel', () => {
    const { world, h } = quiet(['warden']);
    use(world, 'h0', 'formup');
    expect(h.st.shield).toBe(F.formUpShield);
    expect(skillWait(world, h, 'formup')).toBeGreaterThan(F.formUpCooldown - 9);
    expect(checkSkill(world, h, 'formup')).toMatch(/ready again in/);
    run(world, F.formUpCooldown);
    expect(checkSkill(world, h, 'formup')).toBeNull();
    const next = neighbours(world.dungeon, world.dungeon.exit)[0];
    spawnGroup(world, next, ['ghoul'], 0);
    h.pos = { kind: 'room', room: next };
    onHeroInRoom(world, h, next);
    expect(checkSkill(world, h, 'formup')).toBe('Not in a fight.');
  });

  it('Form Up: Shield for everyone in the room, never past 15', () => {
    const { world, heroes } = quiet(['warden', 'cutthroat']);
    heroes[1].st.shield = 12;
    use(world, 'h0', 'formup');
    expect(heroes[0].st.shield).toBe(F.formUpShield);
    expect(heroes[1].st.shield).toBe(F.formUpCap);
    // Shield already past the cap stays where it is.
    heroes[1].st.shield = 20;
    run(world, F.formUpCooldown);
    use(world, 'h0', 'formup');
    expect(heroes[1].st.shield).toBe(20);
  });

  it('Rekindle: every lamp in the room +25', () => {
    const { world, heroes } = quiet(['lampbearer', 'warden']);
    heroes[0].light = 30;
    heroes[1].light = 10;
    use(world, 'h0', 'rekindle');
    expect(heroes[0].light).toBeGreaterThan(30 + F.rekindleLight - 3);
    expect(heroes[1].light).toBeGreaterThan(10 + F.rekindleLight - 3);
  });

  it('Ring In: Clang stacks before a fight', () => {
    const { world, h } = quiet(['bellwright']);
    use(world, 'h0', 'ringin');
    expect(h.st.clang?.stacks).toBe(F.ringInClang);
  });

  it('Flagellate: HP and light lost, the light shared with the others here', () => {
    const { world, heroes } = quiet(['zealot', 'warden', 'warden']);
    const [z, a, b] = heroes;
    a.light = b.light = 40;
    const hp = z.hp;
    use(world, 'h0', 'flagellate');
    expect(z.hp).toBe(hp - F.flagellateHp);
    expect(z.light).toBeLessThan(100 - F.flagellateLight);
    expect(a.light).toBeGreaterThan(40 + F.flagellateLight / 2 - 3);
    expect(b.light).toBeGreaterThan(40 + F.flagellateLight / 2 - 3);
  });

  it('Brew: a consumable into the pack, on a cooldown (no longer by itself)', () => {
    const { world, h } = quiet(['alchemist']);
    run(world, 60);
    expect(h.items).toHaveLength(0);
    use(world, 'h0', 'brew');
    expect(h.items).toHaveLength(1);
    expect(checkSkill(world, h, 'brew')).toMatch(/ready again/);
  });
});

describe('Stalwart', () => {
  it('the Warden keeps half his Shield when a fight ends; others keep none', () => {
    const { world, heroes } = quiet(['warden', 'cutthroat']);
    const next = neighbours(world.dungeon, world.dungeon.exit)[0];
    const [m] = spawnGroup(world, next, ['ghoul'], 0);
    for (const h of heroes) {
      h.pos = { kind: 'room', room: next };
      onHeroInRoom(world, h, next);
      h.st.shield = 11;
    }
    delete world.monsters[m.id];
    run(world, 0.2);
    expect(world.encounters[next]).toBeUndefined();
    expect(heroes[0].st.shield).toBe(5);
    expect(heroes[1].st.shield).toBeUndefined();
  });
});

describe('Long Reach', () => {
  it('the Alchemist lobs a Firebomb into a room next door; nobody else can', () => {
    const { world, heroes } = quiet(['alchemist', 'warden']);
    const next = neighbours(world.dungeon, world.dungeon.exit)[0];
    const monsters = spawnGroup(world, next, ['ghoul', 'ghoul'], 0);
    for (const m of monsters) m.hp = m.maxHp = 50;
    heroes[0].items = ['firebomb'];
    heroes[1].items = ['firebomb'];
    applyIntent(world, 'h1', { type: 'useItem', index: 0, room: next });
    run(world, 8);
    expect(heroes[1].items).toEqual(['firebomb']);
    applyIntent(world, 'h0', { type: 'useItem', index: 0, room: next });
    run(world, 8);
    expect(heroes[0].items).toEqual([]);
    expect(monstersIn(world, next).every((m) => m.hp === 50 - 8)).toBe(true);
    expect(world.encounters[next]).toBeUndefined(); // they don't come looking
  });

  it('a Bandage reaches an ally next door', () => {
    const { world, heroes } = quiet(['alchemist', 'warden']);
    const next = neighbours(world.dungeon, world.dungeon.exit)[0];
    heroes[1].pos = { kind: 'room', room: next };
    heroes[1].hp = 10;
    heroes[0].items = ['bandage'];
    applyIntent(world, 'h0', { type: 'useItem', index: 0, target: 'h1' });
    run(world, 8);
    expect(heroes[1].hp).toBe(22);
  });
});

describe('Sneak (Cutthroat)', () => {
  /** A Cutthroat walking (being put) into a room with a Ghoul next door. */
  function sneaker(light: number, sneak = true) {
    const { world, h } = quiet(['cutthroat']);
    const next = neighbours(world.dungeon, world.dungeon.exit)[0];
    const [m] = spawnGroup(world, next, ['ghoul'], 0);
    m.hp = m.maxHp = 999;
    h.light = light;
    if (sneak) applyIntent(world, 'h0', { type: 'skill', skill: 'sneak' });
    return { world, h, m, next };
  }
  const enter = (world: World, h: ReturnType<typeof quiet>['h'], room: number) => {
    h.pos = { kind: 'room', room };
    onHeroInRoom(world, h, room);
  };

  it('toggles at once, without a turn; Speed doubles while on', () => {
    const { world, h } = quiet(['cutthroat']);
    const base = speedOf(h, world.time);
    applyIntent(world, 'h0', { type: 'skill', skill: 'sneak' });
    expect(h.sneaking).toBe(true);
    expect(h.queuedSkill).toBeNull();
    expect(speedOf(h, world.time)).toBeCloseTo(base * 2);
    applyIntent(world, 'h0', { type: 'skill', skill: 'sneak' });
    expect(h.sneaking).toBe(false);
  });

  it('an Ambush: Sneaking, alone, Stealth under every Speed: nothing moves until the Cutthroat does', () => {
    const { world, h, m, next } = sneaker(30); // Stealth 2, the Ghoul's Speed 5
    enter(world, h, next);
    const enc = world.encounters[next];
    expect(enc.ambush).toBe(h.id);
    enc.next[h.id] = world.time + 20;
    run(world, 15);
    expect(enc.events.some((e) => e.actor === m.id)).toBe(false);
    enc.next[h.id] = world.time;
    run(world, 0.2);
    expect(enc.ambush).toBeUndefined();
    expect(enc.next[m.id] - world.time).toBeCloseTo(5, 0);
  });

  it('no Ambush with a bright lamp (Stealth too high), or without Sneak', () => {
    const bright = sneaker(100); // Stealth 6.7
    enter(bright.world, bright.h, bright.next);
    expect(bright.world.encounters[bright.next].ambush).toBeUndefined();
    const plain = sneaker(30, false);
    enter(plain.world, plain.h, plain.next);
    expect(plain.world.encounters[plain.next].ambush).toBeUndefined();
  });

  it('Sneak Past on the first turn: no fight, unnoticed in the room; turning Sneak off starts it', () => {
    const { world, h, next } = sneaker(30);
    enter(world, h, next);
    expect(submitChoice(world, h, { action: 'flee' })).toBeNull();
    world.encounters[next].next[h.id] = world.time;
    run(world, 0.2);
    expect(world.encounters[next]).toBeUndefined();
    expect(h.encounter).toBeNull();
    expect(h.pos).toEqual({ kind: 'room', room: next });
    expect(h.unnoticedIn).toBe(next);
    expect(monstersIn(world, next)).toHaveLength(1);
    run(world, 10);
    expect(world.encounters[next]).toBeUndefined();
    applyIntent(world, 'h0', { type: 'skill', skill: 'sneak' });
    expect(world.encounters[next]?.heroes).toEqual([h.id]);
  });

  it('Sneaking: Backstab crits ×3', () => {
    const { world, h, m, next } = sneaker(30);
    enter(world, h, next);
    const enc = world.encounters[next];
    setHand(h, ['backstab', 'signal', 'cheap']);
    submitChoice(world, h, { action: 'card', card: 'backstab', target: m.id });
    enc.next[h.id] = world.time;
    run(world, 0.1);
    expect(999 - m.hp).toBe(CARD_RULES.backstab * CARD_RULES.backstabSneakCrit);
  });
});

describe('Siphon the Flame (Sorceress)', () => {
  it('burns 20 light for 1 Anima; refused with too little light', () => {
    const { world, h } = quiet(['sorceress']);
    h.light = 50;
    use(world, 'h0', 'siphon');
    expect(h.anima).toBe(1);
    expect(h.light).toBeLessThan(31);
    run(world, F.siphonCooldown);
    h.light = 10;
    expect(checkSkill(world, h, 'siphon')).toMatch(/need/);
  });
});

describe('Unearth (Undertaker)', () => {
  it('a Ghoul joins the following for good', () => {
    const { world, h } = quiet(['undertaker']);
    use(world, 'h0', 'unearth');
    expect(h.legion.map((r) => [r.type, r.decay])).toEqual([['ghoul', 0]]);
  });
});
