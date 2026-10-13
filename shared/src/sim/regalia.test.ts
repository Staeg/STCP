import { describe, expect, it } from 'vitest';
import { REGALIA_RULES, specsUnlocked, talentsOf, type ShardId } from '../content/regalia';
import { Stash } from '../stash';
import { chooseSpec, heroCr, loadoutOf, newCharacter, type Character } from '../village';
import { Rng } from '../rng';
import { downHero, onHeroInRoom, spawnGroup } from './combat';
import { dropEverything, dropRegalia, risenAllyEscapes, shardHome } from './loot';
import { addHero, createWorld, step, type World } from './world';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

const quiet = () => createWorld(31, { monsters: false, loot: false, escalates: false, events: false });

/** A player's hero whose Village has these Shards (bots: `null`). */
function player(world: World, id: string, shards: ShardId[] | null = []) {
  const h = addHero(world, { id, name: id.toUpperCase(), cls: 'warden', isBot: shards === null });
  h.villageShards = shards;
  h.maxHp = h.hp = 500;
  return h;
}

describe('Boss regalia', () => {
  it('breaks into one Shard per player still inside whose Village lacks it', () => {
    const world = quiet();
    const room = world.dungeon.entrance;
    player(world, 'a');
    player(world, 'b');
    player(world, 'c', ['crown']); // already has it
    player(world, 'bot', null); // bots have no Village
    const gone = player(world, 'd');
    gone.extracted = true; // already out
    const down = player(world, 'e');
    down.downedAt = world.time; // downed still counts
    expect(dropRegalia(world, room, 'crown')).toBe(3);
    expect(world.piles[room].shards).toEqual(['crown', 'crown', 'crown']);
    // Slain again (raised by a Lich, say): what's already about counts against it.
    expect(dropRegalia(world, room, 'crown')).toBe(0);
  });

  it('never drops more than 4', () => {
    const world = quiet();
    for (const id of ['a', 'b', 'c', 'd', 'e']) player(world, id);
    expect(dropRegalia(world, world.dungeon.entrance, 'crown')).toBe(REGALIA_RULES.maxShards);
  });

  it('drops when the Dead King is slain, and each Shard goes by itself to someone who may carry it', () => {
    const world = quiet();
    const room = world.dungeon.entrance;
    const a = addHero(world, { id: 'a', name: 'A', cls: 'zealot' });
    a.maxHp = a.hp = 500;
    const bot = player(world, 'bot', null);
    const [king] = spawnGroup(world, room, ['king'], 0);
    king.hp = 1;
    onHeroInRoom(world, a, room);
    run(world, 12);
    expect(world.monsters[king.id]).toBeUndefined();
    expect(a.shard).toBe('crown');
    expect(bot.shard).toBeNull();
    // One was dropped for A alone: nothing left on the floor.
    expect(world.piles[room]?.shards ?? []).toEqual([]);
  });

  it('one Shard to a hand; the rest wait on the floor for whoever may carry one', () => {
    const world = quiet();
    const room = world.dungeon.entrance;
    const a = player(world, 'a');
    player(world, 'b');
    const c = player(world, 'c', ['crown']);
    dropRegalia(world, room, 'crown');
    world.piles[room].shards!.push('crown'); // a spare
    run(world, 0.2);
    expect(world.heroes.a.shard).toBe('crown');
    expect(world.heroes.b.shard).toBe('crown');
    expect(c.shard).toBeNull();
    expect(world.piles[room].shards).toEqual(['crown']);
    expect(a.messages.some((m) => m.text.includes('Shard of the Crown'))).toBe(true);
  });

  it('falls where its carrier dies, for another to take up', () => {
    const world = quiet();
    const room = world.dungeon.entrance;
    const a = player(world, 'a');
    a.shard = 'crown';
    a.dead = true;
    dropEverything(world, a);
    expect(a.shard).toBeNull();
    expect(world.piles[room].shards).toEqual(['crown']);
    const b = player(world, 'b');
    run(world, 0.2);
    expect(b.shard).toBe('crown');
  });

  it('goes home with whoever carries it out, or walks it out Risen', () => {
    const world = quiet();
    const a = player(world, 'a');
    a.shard = 'crown';
    expect(shardHome(a)).toBeNull();
    a.extracted = true;
    expect(shardHome(a)).toBe('crown');
    const dead = player(world, 'b');
    const u = addHero(world, { id: 'u', name: 'U', cls: 'undertaker' });
    dead.shard = 'crown';
    dead.dead = true;
    risenAllyEscapes(world, u, dead);
    expect(shardHome(dead)).toBe('crown');
  });

  it('a downed hero takes up nothing', () => {
    const world = quiet();
    const room = world.dungeon.entrance;
    const a = player(world, 'a');
    downHero(world, a, null);
    dropRegalia(world, room, 'crown');
    run(world, 0.2);
    expect(a.shard).toBeNull();
    expect(world.piles[room].shards).toEqual(['crown']);
  });
});

describe('Specializations', () => {
  const char = (talent: Character['talent']): Character => ({ ...newCharacter('c1', 'warden', new Rng(1), []), talent });

  it('Seasoned gives the class’s other Talent too, and counts for CR', () => {
    const c = char('shieldwall');
    expect(talentsOf(c)).toEqual(['shieldwall']);
    expect(chooseSpec(c, 'seasoned', ['crown'], 300)).toBeNull();
    expect(talentsOf(c)).toEqual(['shieldwall', 'unbrokenLine']);
    expect(loadoutOf('Ann', c).talents).toEqual(['shieldwall', 'unbrokenLine']);
    expect(heroCr(talentsOf(c), undefined)).toBe(2);
  });

  it('needs the Shard, a Talent and the gold; one Spec for good', () => {
    expect(chooseSpec(char('shieldwall'), 'seasoned', [], 300)).toMatch(/Shard/);
    expect(chooseSpec(char(null), 'seasoned', ['crown'], 300)).toMatch(/Talent first/);
    expect(chooseSpec(char('shieldwall'), 'seasoned', ['crown'], 249)).toMatch(/250 gold/);
    const c = char('shieldwall');
    chooseSpec(c, 'seasoned', ['crown'], 300);
    expect(chooseSpec(c, 'seasoned', ['crown'], 300)).toMatch(/already/);
  });

  it('the Stash keeps the Shard, unlocks Specs, and charges 250 gold', () => {
    const stash = new Stash();
    expect(stash.village('Ann').specs).toEqual([]);
    const lines = stash.storeShard('Ann', 'crown');
    expect(lines.join(' ')).toMatch(/Specializations are unlocked/);
    expect(stash.storeShard('Ann', 'crown')).toEqual([]);
    expect(stash.village('Ann').shards).toEqual(['crown']);
    expect(specsUnlocked(stash.shardsOf('Ann'))).toEqual(['seasoned']);
    const warden = stash.characterFor('Ann', 'warden');
    stash.recordRun('Ann', true, 300);
    expect(stash.chooseSpec('Ann', warden.id, 'seasoned')).toMatch(/Talent first/);
    // Fast-track a Talent.
    stash.recordCharacter('Ann', warden.id, { escaped: true, lowestHp: 1, downedMajor: false, insane: false });
    stash.recordCharacter('Ann', warden.id, { escaped: true, lowestHp: 1, downedMajor: false, insane: false });
    expect(stash.chooseTalent('Ann', warden.id, 'shieldwall')).toBeNull();
    expect(stash.chooseSpec('Ann', warden.id, 'seasoned')).toBeNull();
    expect(stash.purse('Ann')).toBe(50);
    expect(stash.characterFor('Ann', 'warden').spec).toBe('seasoned');
  });
});
