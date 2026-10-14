import { describe, expect, it } from 'vitest';
import { neighbours } from '../dungeon/gen';
import { spawnGroup, submitChoice } from './combat';
import { fightTimeline, TIMELINE_TURNS } from './timeline';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type World } from './world';
import type { ClassId } from '../content/classes';
import type { EnemyId } from '../content/enemies';

function fight(classes: ClassId[], enemies: EnemyId[]) {
  const world = createWorld(777, { monsters: false });
  const d = world.dungeon;
  const ids = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(world, room, enemies, 0);
  for (const id of ids) applyIntent(world, id, { type: 'goto', room });
  for (let i = 0; i < 100 && ids.some((id) => world.heroes[id].encounter === null); i++) step(world, 0.1);
  return { world, ids, room, monsters, enc: world.encounters[room] };
}

/** Every turn actually taken from now on, in order, for this many seconds. */
function turnsTaken(world: World, room: number, seconds: number): string[] {
  const enc = world.encounters[room];
  const out: string[] = [];
  for (let i = 0; i < seconds * 10 && world.encounters[room] === enc; i++) {
    const was = { ...(enc.turns ?? {}) };
    step(world, 0.1);
    for (const [id, n] of Object.entries(enc.turns ?? {})) for (let k = was[id] ?? 0; k < n; k++) out.push(`${id}#${k}`);
  }
  return out;
}

describe('fight timeline', () => {
  it('lists the next turns in the order they then come, and leaves the world untouched', () => {
    const { world, room, monsters, enc } = fight(['warden', 'cutthroat'], ['ghoul', 'ghoul']);
    for (const m of monsters) m.hp = m.maxHp = 999;
    world.heroes.h0.hp = world.heroes.h0.maxHp = 999;
    world.heroes.h1.hp = world.heroes.h1.maxHp = 999;
    const rngState = world.rng.state;
    const snapshot = JSON.stringify(enc);
    const tl = fightTimeline(world, enc);
    expect(tl).toHaveLength(TIMELINE_TURNS);
    expect(world.rng.state).toBe(rngState);
    expect(JSON.stringify(enc)).toBe(snapshot);
    for (let i = 1; i < tl.length; i++) expect(tl[i].at).toBeGreaterThanOrEqual(tl[i - 1].at);
    // Nobody picks, so every hero turn is their default.
    expect(tl.filter((t) => t.id.startsWith('h')).every((t) => t.auto && t.choice)).toBe(true);
    const span = tl.at(-1)!.at - world.time + 0.05;
    const taken = turnsTaken(world, room, span);
    expect(taken.slice(0, tl.length)).toEqual(tl.map((t) => `${t.id}#${t.n}`));
  });

  it("shows a pick's knock-on effects: Clang pushes the struck monster's turn back", () => {
    const { world, monsters, enc } = fight(['bellwright'], ['ghoul']);
    monsters[0].hp = monsters[0].maxHp = 999;
    const ghoulTurns = () => fightTimeline(world, enc).filter((t) => t.id === monsters[0].id).map((t) => t.at);
    expect(submitChoice(world, world.heroes.h0, { action: 'a1' })).toBeNull(); // Knell: no delay
    const plain = ghoulTurns();
    expect(submitChoice(world, world.heroes.h0, { action: 'a0', target: monsters[0].id })).toBeNull(); // Clang: +6s
    const clanged = ghoulTurns();
    const first = fightTimeline(world, enc).find((t) => t.id === 'h0')!;
    expect(first.choice?.action).toBe('a0');
    expect(first.auto).toBeUndefined();
    // The ghoul's turn after the Bellwright's comes later (or out of sight).
    expect(plain.length).toBeGreaterThan(1);
    expect(clanged[1] ?? Infinity).toBeGreaterThan(plain[1] + 1);
  });

  it('marks the turns that hang on a roll: a Flee only some dice let through', () => {
    const { world, monsters, enc } = fight(['warden'], ['ghoul']);
    monsters[0].hp = monsters[0].maxHp = 999;
    submitChoice(world, world.heroes.h0, { action: 'flee' });
    const tl = fightTimeline(world, enc);
    const mine = tl.filter((t) => t.id === 'h0');
    expect(mine[0].maybe).toBeUndefined();
    expect(mine.slice(1).every((t) => t.maybe)).toBe(true);
    expect(mine.length).toBeGreaterThan(1);
  });

  it("goes in a player's view of the fight, but not a bot's", () => {
    const { world } = fight(['warden'], ['ghoul']);
    world.heroes.h0.isBot = false;
    expect(buildView(world, 'h0').encounter?.timeline.length).toBeGreaterThan(0);
    world.heroes.h0.isBot = true;
    expect(buildView(world, 'h0').encounter?.timeline).toEqual([]);
  });
});
