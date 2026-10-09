import { describe, expect, it } from 'vitest';
import { neighbours } from '../dungeon/gen';
import { botVote } from '../bots/looter';
import { armored, damageMult, spawnGroup } from './combat';
import { addToPile, LEAVE } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { ClassId } from '../content/classes';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
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
    addToPile(world, d.entrance, 0, ['mace']);
    step(world, 0.1);
    expect(buildView(world, 'h0').loot?.vote?.candidates.map((c) => c.id)).toEqual(['h0']);
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    step(world, 0.1);
    expect(h.weapon).toBe('mace');
    expect(h.items).toHaveLength(4);
  });

  it('swaps: the old piece goes on the floor for a vote', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.armor = 'jerkin';
    addToPile(world, d.entrance, 0, ['cuirass']);
    step(world, 0.1);
    expect(buildView(world, 'h0').loot?.vote?.candidates[0].wearing).toBe('jerkin');
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    step(world, 0.1);
    expect(h.armor).toBe('cuirass');
    step(world, 0.1);
    expect(world.piles[d.entrance].vote?.item).toBe('jerkin');
  });

  it('can be taken off and dropped, and falls with the dead', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'spear';
    h.armor = 'chainshirt';
    applyIntent(world, 'h0', { type: 'unequip', slot: 'weapon' });
    expect(h.weapon).toBeNull();
    expect(world.piles[d.entrance].items).toEqual(['spear']);

    h.hp = 0;
    h.downedAt = world.time;
    run(world, 40);
    expect(h.dead).toBe(true);
    expect(h.armor).toBeNull();
    const pile = world.piles[d.entrance];
    expect([...pile.items, ...pile.abandoned, pile.vote?.item]).toContain('chainshirt');
  });

  it('bots back the biggest upgrade, and leave pieces nobody needs', () => {
    const { world, d } = party(['warden', 'hexer']);
    world.heroes.h0.isBot = world.heroes.h1.isBot = true;
    world.heroes.h0.weapon = 'runeblade';
    addToPile(world, d.entrance, 0, ['hatchet']);
    step(world, 0.1);
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', choice: 'h1' });

    world.heroes.h1.weapon = 'emberaxe';
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', choice: LEAVE });
  });
});

describe('gear in combat', () => {
  it('weapons scale all outgoing damage; armor cuts every incoming hit, never below 1', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    expect(damageMult(h)).toBe(1);
    h.weapon = 'runeblade';
    expect(damageMult(h)).toBeCloseTo(1.35);
    expect(armored(h, 5)).toBe(5);
    h.armor = 'chainshirt';
    expect(armored(h, 5)).toBe(3);
    expect(armored(h, 2)).toBe(1);
    expect(armored(h, 0)).toBe(0);
  });

  it('applies in a real fight', () => {
    const { world, room } = party(['cutthroat']);
    const h = world.heroes.h0;
    h.weapon = 'runeblade';
    h.armor = 'cuirass';
    const [ghoul, other] = spawnGroup(world, room, ['ghoul', 'ghoul'], 0);
    applyIntent(world, 'h0', { type: 'goto', room });
    for (let i = 0; i < 100 && h.encounter === null; i++) step(world, 0.1);
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: ghoul.id } });
    run(world, 5.2); // the Cutthroat (Speed 3 + 1 for the gear) acts, then the ghouls (5)
    const stab = enc.events.find((e) => e.actor === 'h0' && e.kind === 'damage');
    expect(stab?.amount).toBe(14); // Backstab 10 × 1.35
    const claw = enc.events.find((e) => e.actor === other.id && e.kind === 'damage');
    expect(claw?.amount).toBe(1); // 4 − 3
  });

  it('armor softens a Pact\'s blood price', () => {
    const { world, room } = party(['hexer']);
    const h = world.heroes.h0;
    h.armor = 'chainshirt';
    spawnGroup(world, room, ['brute'], 0);
    applyIntent(world, 'h0', { type: 'goto', room });
    for (let i = 0; i < 100 && h.encounter === null; i++) step(world, 0.1);
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a2' } });
    run(world, 4.7); // Hexer: Speed 4 + 0.5 for the armor
    const price = enc.events.find((e) => e.text.includes('spills their own blood'));
    expect(price?.amount).toBe(4);
  });
});
