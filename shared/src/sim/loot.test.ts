import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { BLEED_OUT, spawnGroup } from './combat';
import { Game } from './game';
import { addToPile, LEAVE } from './loot';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

function party(n: number) {
  const world = createWorld(4242, { monsters: false, loot: false });
  const classes = ['warden', 'cutthroat', 'lampbearer', 'witch'] as const;
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
    world.heroes.h0.items.push('coin');
    addToPile(world, d.entrance, 20, []);
    step(world, 0.1);
    expect(world.heroes.h0.gold).toBe(22);
  });
});

describe('item votes', () => {
  it('needs unanimous agreement', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['bandage']);
    step(world, 0.1);
    expect(world.piles[d.entrance].vote?.item).toBe('bandage');

    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', choice: 'h1' });
    step(world, 0.1);
    expect(world.piles[d.entrance].vote).not.toBeNull(); // disagreement

    applyIntent(world, 'h1', { type: 'vote', choice: 'h0' });
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual(['bandage']);
  });

  it("doesn't stop you leaving; whoever stays decides", () => {
    const { world, d, room } = party(2);
    addToPile(world, d.entrance, 0, ['bandage']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', choice: 'h1' });
    applyIntent(world, 'h0', { type: 'goto', room });
    expect(world.heroes.h0.path).toEqual([room]);
    for (let i = 0; i < 100 && world.heroes.h0.pos.kind === 'room'; i++) step(world, 0.1);
    expect(world.heroes.h0.pos.kind).toBe('corridor');
    step(world, 0.1);
    expect(world.heroes.h1.items).toEqual(['bandage']);
  });

  it('"leave it" abandons the item; it can be claimed later', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['torch']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', choice: LEAVE });
    applyIntent(world, 'h1', { type: 'vote', choice: LEAVE });
    step(world, 0.1);
    expect(world.piles[d.entrance].abandoned).toEqual(['torch']);
    applyIntent(world, 'h0', { type: 'claim', index: 0 });
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', choice: 'h0' });
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual(['torch']);
  });

  it('a full pack is not a valid recipient', () => {
    const { world, d } = party(2);
    world.heroes.h0.items = ['torch', 'torch', 'torch', 'torch'];
    addToPile(world, d.entrance, 0, ['tonic']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    expect(world.piles[d.entrance].vote!.votes.h0).toBeUndefined();
    const view = buildView(world, 'h1');
    expect(view.loot?.vote?.candidates.map((c) => c.id)).toEqual(['h1']);
  });

  it('a newcomer joins the vote and stops walking', () => {
    const { world, d, room } = party(2);
    applyIntent(world, 'h1', { type: 'goto', room });
    run(world, 9);
    addToPile(world, d.entrance, 0, ['tonic']);
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual(['tonic']); // alone → taken
    world.heroes.h0.items.push('bandage');
    applyIntent(world, 'h0', { type: 'drop', index: 1 }); // dropped by h0: it stays put
    const beyond = neighbours(d, d.entrance).find((n) => n !== room);
    applyIntent(world, 'h1', { type: 'goto', room: beyond ?? d.entrance });
    run(world, 9);
    if (beyond !== undefined) expect(world.heroes.h1.pos).toEqual({ kind: 'room', room: d.entrance }); // stopped for loot
    expect(buildView(world, 'h1').loot?.vote?.voters.sort()).toEqual(['h0', 'h1']);
  });

  it('a fight in the room pauses the vote', () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['tonic']);
    step(world, 0.1);
    spawnGroup(world, d.entrance, ['ghoul'], 0);
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    applyIntent(world, 'h1', { type: 'vote', choice: 'h0' });
    step(world, 0.1);
    expect(world.heroes.h0.items).toEqual([]);
  });
});

describe('picking up alone', () => {
  it('takes everything it can, but not what you dropped yourself', () => {
    const { world, d } = party(1);
    const h = world.heroes.h0;
    h.items = ['torch'];
    applyIntent(world, 'h0', { type: 'drop', index: 0 });
    addToPile(world, d.entrance, 0, ['tonic', 'bandage']);
    run(world, 1);
    expect(h.items).toEqual(['tonic', 'bandage']);
    expect(world.piles[d.entrance].vote?.item).toBe('torch');
  });

  it("someone else's drop is fair game, and the mark moves with whoever dropped it last", () => {
    const { world, d, room } = party(2);
    const [h0, h1] = [world.heroes.h0, world.heroes.h1];
    h0.items = ['tonic'];
    applyIntent(world, 'h1', { type: 'goto', room });
    run(world, 9);
    applyIntent(world, 'h0', { type: 'drop', index: 0 });
    run(world, 1);
    expect(h0.items).toEqual([]); // h0's own drop
    // h0 leaves; h1 comes back alone and takes it.
    applyIntent(world, 'h0', { type: 'goto', room });
    applyIntent(world, 'h1', { type: 'goto', room: d.entrance });
    run(world, 9);
    expect(h1.pos).toEqual({ kind: 'room', room: d.entrance });
    expect(h1.items).toEqual(['tonic']);
    // h1 drops it and leaves; h0 returns alone and takes it back.
    applyIntent(world, 'h1', { type: 'drop', index: 0 });
    applyIntent(world, 'h1', { type: 'goto', room });
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    run(world, 9);
    expect(h0.items).toEqual(['tonic']);
  });

  it("doesn't happen with someone else in the room", () => {
    const { world, d } = party(2);
    addToPile(world, d.entrance, 0, ['tonic']);
    run(world, 1);
    expect(world.heroes.h0.items).toEqual([]);
    expect(world.piles[d.entrance].vote?.item).toBe('tonic');
  });
});

describe('items', () => {
  it('bandage heals and cures bleed; torch restores light; tonic lowers stress', () => {
    const { world } = party(1);
    const h = world.heroes.h0;
    h.items = ['bandage', 'torch', 'tonic'];
    h.hp = 10;
    h.st.bleed = [{ dmg: 2, rounds: 3 }];
    h.light = 20;
    h.stress = 40;
    applyIntent(world, 'h0', { type: 'useItem', index: 0 });
    expect(h.hp).toBe(22);
    expect(h.st.bleed).toBeUndefined();
    applyIntent(world, 'h0', { type: 'useItem', index: 0 });
    expect(h.light).toBe(70);
    applyIntent(world, 'h0', { type: 'useItem', index: 0 });
    expect(h.stress).toBe(15);
    expect(h.items).toEqual([]);
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
    expect(h1.downedAt).toBeNull();
    expect(h1.hp).toBe(Math.ceil(h1.maxHp / 2));
  });

  it('Iron Locket raises max HP while carried', () => {
    const { world, d } = party(1);
    const h = world.heroes.h0;
    const base = h.maxHp;
    addToPile(world, d.entrance, 0, ['locket']);
    step(world, 0.1);
    applyIntent(world, 'h0', { type: 'vote', choice: 'h0' });
    step(world, 0.1);
    expect(h.maxHp).toBe(base + 8);
    applyIntent(world, 'h0', { type: 'drop', index: 0 });
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

  it('the dead drop everything where they fall', () => {
    const { world } = party(2);
    const h1 = world.heroes.h1;
    h1.items = ['torch', 'tonic'];
    h1.gold = 17;
    h1.hp = 0;
    h1.downedAt = world.time;
    run(world, BLEED_OUT + 0.2);
    expect(h1.dead).toBe(true);
    // h0 is in the same room, now alone: takes the gold and the items.
    expect(world.heroes.h0.gold).toBe(17);
    expect(world.heroes.h0.items).toEqual(['torch', 'tonic']);
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
        { id: 'd', name: 'D', cls: 'witch', isBot: true },
      ]);
      for (let t = 0; t < COLLAPSE_AT && game.world.phase === 'running'; t += 0.1) game.tick(0.1);
      for (const h of Object.values(game.world.heroes)) {
        gold += h.gold;
        items += h.items.length;
      }
      for (const p of Object.values(game.world.piles)) if (p.vote && game.world.time - p.vote.startedAt > 20) stuckVotes++;
    }
    expect(stuckVotes).toBe(0);
    expect(gold).toBeGreaterThan(0);
    console.log(`bot loot: ${gold} gold held, ${items} items held across 4 games`);
  });
});
