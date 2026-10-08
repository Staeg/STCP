import { describe, expect, it } from 'vitest';
import { COLLAPSE_AT } from '../content/constants';
import { neighbours } from '../dungeon/gen';
import { BLEED_OUT, monstersIn, REVIVE_CHANNEL, ROUND_TIME, spawnGroup } from './combat';
import { Game } from './game';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { ClassId } from '../content/classes';
import type { EnemyId } from '../content/enemies';

function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Heroes at the entrance, a monster group in the next room. */
function arena(classes: ClassId[], enemies: EnemyId[]) {
  const world = createWorld(777, { monsters: false });
  const d = world.dungeon;
  const ids = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(world, room, enemies, 0);
  return { world, d, ids, room, monsters };
}

/** Let the current round's timer run out and resolve; returns once the next round is open (or the fight is over). */
function finishRound(world: World, room: number) {
  const enc = world.encounters[room];
  if (!enc) return;
  const round = enc.round;
  while (world.encounters[room] === enc && enc.phase === 'choosing' && enc.round === round) step(world, 0.1);
  while (world.encounters[room] === enc && enc.phase === 'resolving') step(world, 0.1);
}

function walkIn(world: World, ids: string[], room: number) {
  for (const id of ids) applyIntent(world, id, { type: 'goto', room });
  run(world, 9);
}

describe('encounters', () => {
  it('starts a fight on entering a room with monsters and locks movement', () => {
    const { world, d, ids, room } = arena(['warden'], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    expect(h.pos).toEqual({ kind: 'room', room });
    expect(h.encounter).toBe(room);
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    expect(h.path).toEqual([]);
    const view = buildView(world, 'h0');
    expect(view.encounter?.monsters).toHaveLength(1);
    expect(view.encounter?.phase).toBe('choosing');
  });

  it('resolves only when the 6s timer runs out, and braces those who did not choose', () => {
    const { world, ids, room, monsters } = arena(['cutthroat'], ['ghoul']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
    step(world, 0.1);
    expect(enc.phase).toBe('choosing'); // everyone is in, but the beat isn't over
    run(world, enc.deadline - world.time + 0.1);
    expect(enc.phase).toBe('resolving');
    expect(enc.events.some((e) => e.text.includes('Backstab'))).toBe(true);

    // Next round: don't choose. When the timer runs out the hero braces.
    while (enc.phase === 'resolving') step(world, 0.1);
    expect(enc.deadline - world.time).toBeCloseTo(ROUND_TIME, 0);
    run(world, ROUND_TIME + 0.2);
    expect(enc.events.some((e) => e.text.includes('braces'))).toBe(true);
  });

  it('enforces cooldowns (Poison Blade: cooldown 2 = two rounds unusable)', () => {
    const { world, ids, room, monsters } = arena(['cutthroat'], ['brute']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    const poison = () => applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a1', target: monsters[0].id } });
    const nextRound = () => finishRound(world, room);
    poison();
    expect(enc.choices.h0?.action).toBe('a1');
    nextRound(); // round 2
    poison();
    expect(enc.choices.h0).toBeUndefined();
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'brace' } });
    nextRound(); // round 3
    poison();
    expect(enc.choices.h0).toBeUndefined();
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'brace' } });
    nextRound(); // round 4
    poison();
    expect(enc.choices.h0?.action).toBe('a1');
  });

  it('ends on victory, resets cooldowns and frees movement', () => {
    const { world, d, ids, room, monsters } = arena(['cutthroat', 'hexer'], ['crawler']);
    walkIn(world, ids, room);
    for (let i = 0; i < 10 && monstersIn(world, room).length; i++) {
      applyIntent(world, 'h0', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
      applyIntent(world, 'h1', { type: 'combat', choice: { action: 'a0', target: monsters[0].id } });
      finishRound(world, room);
    }
    expect(monstersIn(world, room)).toHaveLength(0);
    expect(world.encounters[room]).toBeUndefined();
    expect(world.heroes.h0.encounter).toBeNull();
    expect(world.heroes.h0.cooldowns).toEqual({});
    // The kill always drops something, which must be settled before anyone leaves.
    step(world, 0.1);
    expect(world.piles[room]?.vote).toBeTruthy();
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    expect(world.heroes.h0.path).toEqual([]);
    while (world.piles[room]) {
      applyIntent(world, 'h0', { type: 'vote', choice: 'leave' });
      applyIntent(world, 'h1', { type: 'vote', choice: 'leave' });
      step(world, 0.1);
      if (world.piles[room] && !world.piles[room].vote && world.piles[room].items.length === 0) break;
    }
    applyIntent(world, 'h0', { type: 'goto', room: d.entrance });
    expect(world.heroes.h0.path).toEqual([d.entrance]);
  });

  it('downed heroes bleed out unless revived; monsters ignore the downed', () => {
    const { world, ids, room } = arena(['hexer'], ['ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    h.hp = 1;
    run(world, 12); // brace by timeout; ghoul hits; hero goes down
    expect(h.downedAt).not.toBeNull();
    expect(world.encounters[room]).toBeUndefined(); // no conscious heroes left → fight ends
    run(world, BLEED_OUT);
    expect(h.dead).toBe(true);
    expect(world.phase).toBe('wiped');
  });

  it('an ally can revive in combat (costs their action) and out of combat (channel)', () => {
    const { world, ids, room } = arena(['warden', 'lampbearer'], ['ghoul']);
    walkIn(world, ids, room);
    const lamp = world.heroes.h1;
    const enc = world.encounters[room];
    lamp.hp = 0;
    lamp.downedAt = world.time;
    applyIntent(world, 'h0', { type: 'combat', choice: { action: 'revive', target: 'h1' } });
    run(world, enc.deadline - world.time + 0.1);
    expect(lamp.downedAt).toBeNull();
    expect(lamp.hp).toBeGreaterThan(0);
    expect(enc.events.some((e) => e.kind === 'heal' && e.target === 'h1')).toBe(true);

    // Kill the ghoul, then down the lampbearer outside combat and channel a revive.
    for (const m of monstersIn(world, room)) delete world.monsters[m.id];
    run(world, 4);
    expect(world.heroes.h0.encounter).toBeNull();
    lamp.hp = 0;
    lamp.downedAt = world.time;
    applyIntent(world, 'h0', { type: 'revive', target: 'h1' });
    run(world, REVIVE_CHANNEL - 0.5);
    expect(lamp.downedAt).not.toBeNull();
    run(world, 0.7);
    expect(lamp.downedAt).toBeNull();
  });

  it('Guard redirects attacks to the Warden', () => {
    const { world, ids, room } = arena(['warden', 'lampbearer'], ['acolyte']);
    walkIn(world, ids, room);
    const enc = world.encounters[room];
    let redirected = false;
    for (let i = 0; i < 12 && !redirected; i++) {
      applyIntent(world, 'h0', { type: 'combat', choice: { action: i % 2 === 0 ? 'a1' : 'brace', target: 'h1' } });
      applyIntent(world, 'h1', { type: 'combat', choice: { action: 'brace' } });
      finishRound(world, room);
      redirected = enc.events.some((e) => e.text.includes('steps in front'));
    }
    expect(redirected).toBe(true);
  });

  it('fleeing heads back toward the previous room and leaves the fight', () => {
    const { world, d, ids, room } = arena(['cutthroat'], ['ghoul', 'ghoul']);
    walkIn(world, ids, room);
    const h = world.heroes.h0;
    for (let i = 0; i < 10 && h.encounter !== null; i++) {
      applyIntent(world, 'h0', { type: 'combat', choice: { action: 'flee' } });
      finishRound(world, room);
    }
    expect(h.encounter).toBeNull();
    expect(world.encounters[room]).toBeUndefined();
    expect(monstersIn(world, room).length).toBeGreaterThan(0);
    run(world, 9);
    expect(h.pos).toEqual({ kind: 'room', room: d.entrance });
  });

  it('a hero arriving mid-round joins from the next round', () => {
    const { world, d, room } = arena(['warden'], ['brute']);
    walkIn(world, ['h0'], room);
    run(world, 1.5);
    const late = addHero(world, { id: 'late', name: 'Late', cls: 'hexer' });
    expect(late.pos).toEqual({ kind: 'room', room: d.entrance });
    applyIntent(world, 'late', { type: 'goto', room });
    run(world, 8.5);
    const enc = world.encounters[room];
    expect(enc.heroes.includes('late') || enc.joining.includes('late')).toBe(true);
    run(world, ROUND_TIME * 2 + 4);
    expect(enc.heroes).toContain('late');
  });
});

describe('full bot games with monsters', () => {
  it('play out without errors, with fights, downs and survivors', { timeout: 30000 }, () => {
    let fights = 0;
    let survivors = 0;
    let deaths = 0;
    let total = 0;
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      const game = new Game(seed, [
        { id: 'a', name: 'A', cls: 'warden', isBot: true },
        { id: 'b', name: 'B', cls: 'cutthroat', isBot: true },
        { id: 'c', name: 'C', cls: 'lampbearer', isBot: true },
        { id: 'd', name: 'D', cls: 'hexer', isBot: true },
      ]);
      for (let t = 0; t < COLLAPSE_AT + 1 && game.world.phase === 'running'; t += 0.1) game.tick(0.1);
      fights += game.world.stats.slain;
      for (const h of Object.values(game.world.heroes)) {
        total++;
        if (h.dead) deaths++;
        else survivors++;
      }
    }
    expect(fights).toBeGreaterThan(20); // monsters were actually killed
    expect(survivors).toBeGreaterThan(0);
    // Not asserting balance here — that's M8. Just log it.
    console.log(`bot games: ${fights} monsters slain, ${deaths}/${total} heroes died`);
  });
});
