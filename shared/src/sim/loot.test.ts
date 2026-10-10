import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT } from '../content/constants';
import { INVENTORY_SLOTS, packSlotsUsed } from '../content/items';
import { neighbours } from '../dungeon/gen';
import { armored, BLEED_OUT, spawnGroup } from './combat';
import { Game } from './game';
import { activeItems, addToPile, canTake, giveItem, LEAVE, votersIn, wornStat } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, extractHero, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

function party(n: number) {
  const world = createWorld(4242, { monsters: false, loot: false });
  const classes = ['warden', 'cutthroat', 'lampbearer', 'sorceress'] as const;
  for (let i = 0; i < n; i++) addHero(world, { id: `h${i}`, name: `H${i}`, cls: classes[i] });
  const d = world.dungeon;
  return { world, d, room: neighbours(d, d.entrance)[0] };
}

describe('gold', () => {
  it('is split equally among everyone present, downed included', () => {
    const { world, d } = party(3);
    world.heroes.h2.downedAt = world.time;
    world.heroes.h2.hp = 0;
    addToPile(world, d.entrance, 31, []);
    step(world, 0.1);
    const golds = ['h0', 'h1', 'h2'].map((id) => world.heroes[id].gold);
    expect(golds.reduce((a, b) => a + b)).toBe(31);
    expect(Math.max(...golds) - Math.min(...golds)).toBeLessThanOrEqual(1);
    expect(world.piles[d.entrance]).toBeUndefined();
  });

  it('Lucky Coin adds 10% to your share', () => {
    const { world, d } = party(1);
    world.heroes.h0.amulet = 'coin';
    addToPile(world, d.entrance, 20, []);
    step(world, 0.1);
    expect(world.heroes.h0.gold).toBe(22);
  });
});

/** The floor item id of the first `item` lying in `room`. */
/** Use a pack item out of a fight and wait for the timer that carries it out. */
function use(world: World, id: string, index: number) {
  applyIntent(world, id, { type: 'useItem', index });
  expect(world.heroes[id].queuedItem).not.toBeNull();
  while (world.heroes[id].queuedItem) run(world, 0.1);
}

function fid(world: World, room: number, item: string): number {
  return world.piles[room].items.find((f) => f.item === item)!.id;
}

describe('item votes', () => {
  it('needs unanimous agreement', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['bandage']);
    step(world, 0.1);
    const id = fid(world, d.entrance, 'bandage');
    expect(buildView(world, 'h0').loot?.items.map((f) => f.item)).toEqual(['bandage']);

    applyIntent(world, 'h0', { type: 'vote', item: id, choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', item: id, choice: 'h1' });
    step(world, 0.1);
    expect(world.piles[d.entrance].items).toHaveLength(1); // disagreement

    applyIntent(world, 'h1', { type: 'vote', item: id, choice: 'h0' });
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual(['bandage']);
  });

  it('every item is up at once, each settled on its own', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['bandage', 'torch', 'tonic']);
    step(world, 0.1);
    expect(buildView(world, 'h1').loot?.items.map((f) => f.item)).toEqual(['bandage', 'torch', 'tonic']);
    const torch = fid(world, d.entrance, 'torch');
    applyIntent(world, 'h0', { type: 'vote', item: torch, choice: 'h1' });
    applyIntent(world, 'h1', { type: 'vote', item: torch, choice: 'h1' });
    step(world, 0.1);
    expect(world.heroes.h1.items).toEqual(['torch']);
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['bandage', 'tonic']);
  });

  it("doesn't stop you leaving; whoever stays decides", () => {
    const { world, d, room } = party(2);
    addToPile(world, d.entrance, 0, ['bandage']);
    step(world, 0.1);
    const id = fid(world, d.entrance, 'bandage');
    applyIntent(world, 'h0', { type: 'vote', item: id, choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', item: id, choice: 'h1' });
    applyIntent(world, 'h0', { type: 'goto', room });
    expect(world.heroes.h0.path).toEqual([room]);
    for (let i = 0; i < 100 && world.heroes.h0.pos.kind === 'room'; i++) step(world, 0.1);
    expect(world.heroes.h0.pos.kind).toBe('corridor');
    step(world, 0.1);
    expect(world.heroes.h1.items).toEqual(['bandage']);
  });

  it('"leave it" makes everyone ignore it; it can be claimed back', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['torch']);
    step(world, 0.1);
    const id = fid(world, d.entrance, 'torch');
    applyIntent(world, 'h0', { type: 'vote', item: id, choice: LEAVE });
    applyIntent(world, 'h1', { type: 'vote', item: id, choice: LEAVE });
    step(world, 0.1);
    const loot = buildView(world, 'h0').loot!;
    expect(loot.items).toEqual([]);
    expect(loot.ignored).toEqual([{ id, item: 'torch' }]);
    applyIntent(world, 'h0', { type: 'claim', item: id });
    step(world, 0.1);
    expect(buildView(world, 'h1').loot?.items.map((f) => f.id)).toEqual([id]);
    applyIntent(world, 'h0', { type: 'vote', item: id, choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', item: id, choice: 'h0' });
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual(['torch']);
  });

  it('a full pack is not a valid recipient', () => {
    const { world, d } = party(2);
    world.heroes.h0.items = Array(INVENTORY_SLOTS).fill('torch');
    addToPile(world, d.entrance, 0, ['tonic']);
    step(world, 0.1);
    const id = fid(world, d.entrance, 'tonic');
    applyIntent(world, 'h0', { type: 'vote', item: id, choice: 'h0' });
    expect(world.piles[d.entrance].items[0].votes.h0).toBeUndefined();
    const view = buildView(world, 'h1');
    expect(view.loot?.items[0].candidates.map((c) => c.id)).toEqual(['h1']);
  });

  it('a newcomer joins the vote and stops walking', () => {
    const { world, d, room } = party(2);
    applyIntent(world, 'h1', { type: 'goto', room });
    run(world, 9);
    addToPile(world, d.entrance, 0, ['tonic']);
    const beyond = neighbours(d, d.entrance).find((n) => n !== room);
    applyIntent(world, 'h1', { type: 'goto', room: beyond ?? d.entrance });
    run(world, 9);
    if (beyond !== undefined) expect(world.heroes.h1.pos).toEqual({ kind: 'room', room: d.entrance }); // stopped for loot
    expect(buildView(world, 'h1').loot?.voters.sort()).toEqual(['h0', 'h1']);
    expect(buildView(world, 'h1').loot?.items.map((f) => f.item)).toEqual(['tonic']);
  });

  it('a fight in the room pauses the vote', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['tonic']);
    step(world, 0.1);
    const id = fid(world, d.entrance, 'tonic');
    spawnGroup(world, d.entrance, ['ghoul'], 0);
    applyIntent(world, 'h0', { type: 'vote', item: id, choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', item: id, choice: 'h0' });
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual([]);
  });
});

describe('picking up alone', () => {
  it('nothing is taken until you click it; walking away leaves it', () => {
    const { world, d, room } = party(1);
    const h = world.heroes.h0;
    addToPile(world, d.entrance, 0, ['tonic', 'bandage']);
    run(world, 1);
    expect(h.items).toEqual([]);
    applyIntent(world, 'h0', { type: 'vote', item: fid(world, d.entrance, 'bandage'), choice: 'h0' });
    step(world, 0.1);
    expect(h.items).toEqual(['bandage']);
    applyIntent(world, 'h0', { type: 'goto', room });
    run(world, 9);
    expect(h.items).toEqual(['bandage']);
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['tonic']);
  });

  it('ignores what you walked past once, and what you dropped (claim brings it back)', () => {
    const { world, d, room } = party(1);
    const h = world.heroes.h0;
    h.items = ['torch'];
    applyIntent(world, 'h0', { type: 'drop', index: 0 });
    step(world, 0.1);
    expect(buildView(world, 'h0').loot?.items).toEqual([]);
    addToPile(world, d.entrance, 0, ['tonic']);
    step(world, 0.1);
    expect(buildView(world, 'h0').loot?.items.map((f) => f.item)).toEqual(['tonic']);
    applyIntent(world, 'h0', { type: 'goto', room });
    run(world, 9);
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    run(world, 9);
    expect(h.pos).toEqual({ kind: 'room', room: d.entrance });
    const loot = buildView(world, 'h0').loot!;
    expect(loot.items).toEqual([]);
    expect(loot.ignored.map((f) => f.item)).toEqual(['torch', 'tonic']);
    applyIntent(world, 'h0', { type: 'claim', item: fid(world, d.entrance, 'tonic') });
    expect(h.items).toEqual(['tonic']); // alone, claiming just takes it
  });

  it("someone else's drop is fair game", () => {
    const { world, d, room } = party(2);
    const h1 = world.heroes.h1;
    world.heroes.h0.items = ['tonic'];
    applyIntent(world, 'h1', { type: 'goto', room });
    run(world, 9);
    applyIntent(world, 'h0', { type: 'drop', index: 0 });
    applyIntent(world, 'h0', { type: 'goto', room });
    applyIntent(world, 'h1', { type: 'goto', room: d.entrance });
    run(world, 9);
    expect(h1.pos).toEqual({ kind: 'room', room: d.entrance });
    expect(buildView(world, 'h1').loot?.items.map((f) => f.item)).toEqual(['tonic']);
  });

  it('gear no better than yours is ignored', () => {
    const { world, d } = party(1);
    const h = world.heroes.h0;
    h.weapon = 'emberaxe'; // tier 3
    addToPile(world, d.entrance, 0, ['runeblade', 'hatchet']);
    step(world, 0.1);
    expect(buildView(world, 'h0').loot?.items).toEqual([]);
    h.weapon = 'hatchet';
    step(world, 0.1);
    expect(buildView(world, 'h0').loot?.items.map((f) => f.item)).toEqual(['runeblade']);
  });
});

describe('floor space', () => {
  it('a room never holds more than six finds, and you cannot drop onto a full floor', () => {
    const { world, d } = party(1);
    addToPile(world, d.entrance, 0, ['torch', 'torch', 'torch', 'torch', 'torch', 'torch', 'torch', 'torch']);
    expect(world.piles[d.entrance].items).toHaveLength(6);
    world.heroes.h0.items = ['tonic'];
    applyIntent(world, 'h0', { type: 'drop', index: 0 });
    expect(world.heroes.h0.items).toEqual(['tonic']);
  });
});

describe('items', () => {
  it('resources stack three to a slot below the consumables, and are carried out, not sold', () => {
    const { world } = party(1);
    const h = world.heroes.h0;
    for (const it of ['gem', 'effigy', 'bandage', 'gem', 'gem', 'gem', 'torch'] as const) giveItem(h, it);
    expect(h.items).toEqual(['bandage', 'torch', 'effigy', 'gem', 'gem', 'gem', 'gem']);
    expect(packSlotsUsed(h.items)).toBe(5); // 2 consumables, 1 effigy, gems 3 + 1
    h.items = [...Array(INVENTORY_SLOTS - 1).fill('torch'), 'tome'];
    expect(canTake(h, 'tome')).toBe(true); // onto the stack
    expect(canTake(h, 'gem')).toBe(false);
    h.items = ['bandage', 'effigy', 'tome', 'relic'];
    extractHero(world, h);
    expect(h.items).toEqual(['bandage', 'effigy', 'tome', 'relic']);
    expect(h.gold).toBe(0);
  });

  it('dropping a resource drops its whole stack', () => {
    const { world, d } = party(1);
    const h = world.heroes.h0;
    h.items = ['bandage', 'gem', 'gem', 'gem', 'gem'];
    applyIntent(world, 'h0', { type: 'drop', index: 2 });
    expect(h.items).toEqual(['bandage', 'gem']);
    expect(world.piles[d.entrance].items.map((f) => f.item)).toEqual(['gem', 'gem', 'gem']);
  });

  it('a Thorn Ring hurts what hits you; a Quickblood Ring makes every hit worse', () => {
    const { world } = party(1);
    const h = world.heroes.h0;
    h.ring = 'quickblood';
    h.armor = 'chainshirt';
    expect(armored(h, 5)).toBe(4); // 5 − 2 armor + 1
    h.ring = 'thorns';
    expect(wornStat(h, 'thorns')).toBe(2);
  });

  it('relics are only ever found in lairs', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = createWorld(seed);
      for (const [room, pile] of Object.entries(world.piles)) {
        if (pile.items.some((f) => f.item === 'relic')) expect(world.bounty[Number(room)]).toBeGreaterThan(0);
      }
    }
  });

  it('bandage heals and cures poison; torch restores light; tonic lowers stress', () => {
    const { world } = party(1);
    const h = world.heroes.h0;
    h.items = ['bandage', 'torch', 'tonic'];
    h.hp = 10;
    h.st.poison = [{ dmg: 2, rounds: 3 }];
    h.light = 20;
    h.stress = 40;
    use(world, 'h0', 0);
    expect(h.hp).toBe(22);
    expect(h.st.poison).toBeUndefined();
    const light = h.light;
    use(world, 'h0', 0);
    expect(h.light).toBeGreaterThan(light + 47);
    const stress = h.stress;
    use(world, 'h0', 0);
    expect(h.stress).toBeLessThan(stress - 23);
    expect(h.items).toEqual([]);
  });

  it('out of a fight an item is your turn: it waits for your timer and calls off a walk', () => {
    const { world, room } = party(1);
    const h = world.heroes.h0;
    const start = h.pos.kind === 'room' ? h.pos.room : -1;
    h.items = ['bandage'];
    h.hp = 10;
    run(world, 0.3);
    applyIntent(world, 'h0', { type: 'goto', room });
    run(world, 0.5);
    expect(h.pos.kind).toBe('corridor');
    applyIntent(world, 'h0', { type: 'useItem', index: 0 });
    // Back where you set out from at once; the bandage goes on when the timer runs out.
    expect(h.pos).toEqual({ kind: 'room', room: start });
    expect(h.hp).toBe(10);
    expect(h.queuedItem?.item).toBe('bandage');
    while (h.queuedItem) run(world, 0.1);
    expect(h.hp).toBe(22);
    expect(h.items).toEqual([]);
  });

  it('cancelling a walk puts you straight back, with time left on the timer to go another way', () => {
    const { world, room } = party(1);
    const h = world.heroes.h0;
    const start = h.pos.kind === 'room' ? h.pos.room : -1;
    run(world, 0.3);
    const turnAt = h.turnAt;
    applyIntent(world, 'h0', { type: 'goto', room });
    run(world, 0.5);
    applyIntent(world, 'h0', { type: 'turnBack' });
    expect(h.pos).toEqual({ kind: 'room', room: start });
    expect(h.turnAt).toBe(turnAt);
    // Off again: you're already as far down the tunnel as the timer has run, and arrive when it ends.
    applyIntent(world, 'h0', { type: 'goto', room });
    run(world, 0.1);
    expect(h.pos.kind === 'corridor' && h.pos.t).toBeGreaterThan(0.8);
    while (h.pos.kind === 'corridor') run(world, 0.1);
    expect(world.time).toBeCloseTo(turnAt, 0);
  });

  it('smelling salts revive a downed ally in an adjacent room', () => {
    const { world, room } = party(2);
    applyIntent(world, 'h1', { type: 'goto', room });
    run(world, 9);
    const h1 = world.heroes.h1;
    h1.hp = 0;
    h1.downedAt = world.time;
    world.heroes.h0.items = ['salts'];
    applyIntent(world, 'h0', { type: 'useItem', index: 0, target: 'h1' });
    while (world.heroes.h0.queuedItem) run(world, 0.1);
    expect(h1.downedAt).toBeNull();
    expect(h1.hp).toBe(Math.ceil(h1.maxHp / 2));
  });

  it('Iron Locket raises max HP while worn', () => {
    const { world, d } = party(1);
    const h = world.heroes.h0;
    const base = h.maxHp;
    addToPile(world, d.entrance, 0, ['locket']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', item: fid(world, d.entrance, 'locket'), choice: 'h0' });
    step(world, 0.1);
    expect(h.amulet).toBe('locket');
    expect(h.items).toEqual([]);
    expect(h.maxHp).toBe(base + 8);
    applyIntent(world, 'h0', { type: 'unequip', slot: 'amulet' });
    expect(h.amulet).toBeNull();
    expect(h.maxHp).toBe(base);
  });

  it('firebomb hits every enemy as a combat action', () => {
    const { world, room } = party(1);
    const h = world.heroes.h0;
    h.items = ['firebomb'];
    const ms = spawnGroup(world, room, ['ghoul', 'acolyte'], 0);
    applyIntent(world, 'h0', { type: 'goto', room });
    for (let i = 0; i < 200 && h.encounter === null; i++) step(world, 0.1);
    expect(h.encounter).toBe(room);
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'item', item: 0 } });
    for (let i = 0; i < 60 && h.items.length; i++) step(world, 0.1);
    for (const m of ms) if (world.monsters[m.id]) expect(m.hp).toBe(m.maxHp - 8);
    expect(h.items).toEqual([]);
  });

  it('with nobody left standing, the downed bleed out at once and the run ends', () => {
    const { world } = party(2);
    world.heroes.h0.dead = true;
    const h1 = world.heroes.h1;
    h1.hp = 0;
    h1.downedAt = world.time;
    step(world, 0.1);
    expect(h1.dead).toBe(true);
    expect(world.phase).toBe('wiped');
  });

  it('the dead drop everything where they fall', () => {
    const { world } = party(2);
    const h1 = world.heroes.h1;
    h1.items = ['torch', 'tonic'];
    h1.gold = 17;
    h1.hp = 0;
    h1.downedAt = world.time;
    run(world, BLEED_OUT + 0.2);
    expect(h1.dead).toBe(true);
    // h0 is in the same room, now alone: gets the gold, and the items are there to pick up.
    expect(world.heroes.h0.gold).toBe(17);
    expect(buildView(world, 'h0').loot?.items.map((f) => f.item)).toEqual(['torch', 'tonic']);
  });
});

describe('bot games with loot', () => {
  it('bots resolve every vote (no deadlocks) and pick things up', { timeout: 30000 }, () => {
    let gold = 0;
    let items = 0;
    let stuckVotes = 0;
    for (const seed of [5, 6, 7, 8]) {
      const game = new Game(seed, [
        { id: 'a', name: 'A', cls: 'warden', isBot: true },
        { id: 'b', name: 'B', cls: 'cutthroat', isBot: true },
        { id: 'c', name: 'C', cls: 'lampbearer', isBot: true },
        { id: 'd', name: 'D', cls: 'sorceress', isBot: true },
      ]);
      for (let t = 0; t < COLLAPSE_AT && game.world.phase === 'running'; t += 0.1) game.tick(0.1);
      for (const h of Object.values(game.world.heroes)) {
        gold += h.gold;
        items += h.items.length;
      }
      for (const room of Object.keys(game.world.piles).map(Number)) {
        if (votersIn(game.world, room).length === 0) continue;
        stuckVotes += activeItems(game.world, room).filter((f) => game.world.time - f.startedAt > 20).length;
      }
    }
    expect(stuckVotes).toBe(0);
    expect(gold).toBeGreaterThan(0);
    console.log(`bot loot: ${gold} gold held, ${items} items held across 4 games`);
  });
});

describe('gear tiers', () => {
  it('a lower-tier piece is not offered over what you wear, until you take yours off', () => {
    const { world, d } = party(1);
    const h = world.heroes.h0;
    h.weapon = 'runeblade'; // tier 3
    expect(canTake(h, 'shortsword')).toBe(false); // tier 1
    expect(canTake(h, 'emberaxe')).toBe(true); // same tier
    expect(canTake(h, 'jerkin')).toBe(true); // other slot
    addToPile(world, d.entrance, 0, ['shortsword']);
    run(world, 1);
    expect(buildView(world, 'h0').loot?.items).toEqual([]);
    h.weapon = null;
    run(world, 1);
    expect(buildView(world, 'h0').loot?.items[0].candidates.map((c) => c.id)).toEqual(['h0']);
  });
});
