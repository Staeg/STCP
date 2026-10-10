import { describe, expect, it } from 'vitest';
import { neighbours } from '../dungeon/gen';
import { botUseItem, botVote } from '../bots/looter';
import { armored, damageMult, spawnGroup } from './combat';
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
    addToPile(world, d.entrance, 0, ['mace']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', item: world.piles[d.entrance].items[0].id, choice: 'h0' });
    step(world, 0.1);
    expect(h.weapon).toBe('mace');
    expect(h.items).toHaveLength(4);
  });

  it('a rarer piece goes on; the old one goes in the pack', () => {
    const { world, d } = party(['warden', 'sorceress']);
    const h = world.heroes.h0;
    h.armor = 'jerkin';
    addToPile(world, d.entrance, 0, ['cuirass']);
    step(world, 0.1);
    const loot = buildView(world, 'h0').loot!;
    expect(loot.items[0].candidates[0].wearing).toBe('jerkin');
    applyIntent(world, 'h0', { type: 'vote', item: loot.items[0].id, choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', item: loot.items[0].id, choice: 'h0' });
    step(world, 0.1);
    expect(h.armor).toBe('cuirass');
    expect(h.items).toEqual(['jerkin']);
    expect(world.piles[d.entrance]).toBeUndefined();
  });

  it('with a full pack, the old piece goes on the floor instead', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.armor = 'jerkin';
    h.items = Array(14).fill('torch');
    addToPile(world, d.entrance, 0, ['cuirass']);
    takeAll(world);
    expect(h.armor).toBe('cuirass');
    const loot = buildView(world, 'h0').loot!;
    expect(loot.items).toEqual([]);
    expect(loot.ignored.map((f) => f.item)).toEqual(['jerkin']);
  });

  it('no rarer than what you wear, it goes in the pack (after consumables, before resources)', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'runeblade'; // rare
    h.items = ['torch', 'gem'];
    addToPile(world, d.entrance, 0, ['emberaxe', 'shortsword']); // rare, common
    takeAll(world);
    expect(h.weapon).toBe('runeblade');
    expect(h.items).toEqual(['torch', 'emberaxe', 'shortsword', 'gem']);
  });

  it('a full pack leaves it on the floor', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'runeblade';
    h.items = Array(14).fill('torch');
    addToPile(world, d.entrance, 0, ['shortsword']);
    takeAll(world);
    expect(h.items).not.toContain('shortsword');
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['shortsword']);
  });

  it('gear in the pack can be put on, swapping with what is worn', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'runeblade';
    h.items = ['torch', 'shortsword'];
    applyIntent(world, 'h0', { type: 'useItem', index: 1 });
    expect(h.weapon).toBe('shortsword');
    expect(h.items).toEqual(['torch', 'runeblade']);
  });

  it('can be taken off and dropped, and falls with the dead', () => {
    const { world, d } = party(['warden']);
    const h = world.heroes.h0;
    h.weapon = 'spear';
    h.armor = 'chainshirt';
    applyIntent(world, 'h0', { type: 'unequip', slot: 'weapon' });
    expect(h.weapon).toBeNull();
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['spear']);

    h.hp = 0;
    h.downedAt = world.time;
    run(world, 40);
    expect(h.dead).toBe(true);
    expect(h.armor).toBeNull();
    const pile = world.piles[d.entrance];
    expect(pile.items.map((f) => f.item)).toContain('chainshirt');
  });

  it('bots back the biggest upgrade; pieces nobody needs go to a player, else stay down', () => {
    const { world, d } = party(['warden', 'sorceress']);
    world.heroes.h0.isBot = world.heroes.h1.isBot = true;
    world.heroes.h0.weapon = 'runeblade';
    addToPile(world, d.entrance, 0, ['hatchet']);
    step(world, 0.1);
    const item = world.piles[d.entrance].items[0].id;
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', item, choice: 'h1' });

    // An upgrade for nobody: no player to carry it home, so leave it.
    world.heroes.h1.weapon = 'emberaxe';
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', item, choice: LEAVE });
    // A player's Stash would keep it.
    world.heroes.h1.isBot = false;
    expect(botVote(buildView(world, 'h0'))).toEqual({ type: 'vote', item, choice: 'h1' });
  });

  it('bots put on better gear from their pack', () => {
    const { world } = party(['warden']);
    const h = world.heroes.h0;
    h.isBot = true;
    h.weapon = 'hatchet';
    h.items = ['shortsword', 'spear'];
    expect(botUseItem(buildView(world, 'h0'))).toEqual({ type: 'useItem', index: 1 });
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
    h.armor = 'chainshirt';
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
