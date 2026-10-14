import { describe, expect, it } from 'vitest';
import { submitChoice } from './combat';
import { arena, setHand, walkIn } from './testkit';
import { fightTimeline, TIMELINE_TURNS } from './timeline';
import { buildView } from './views';
import { step, type World } from './world';
import type { ClassId } from '../content/classes';
import type { EnemyId } from '../content/enemies';

function fight(classes: ClassId[], enemies: EnemyId[]) {
  const a = arena(classes, enemies);
  walkIn(a.world, a.ids, a.room);
  for (const m of a.monsters) m.hp = m.maxHp = 999;
  for (const id of a.ids) a.world.heroes[id].hp = a.world.heroes[id].maxHp = 999;
  return { ...a, enc: a.world.encounters[a.room] };
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
    const { world, room, enc } = fight(['warden', 'cutthroat'], ['ghoul', 'ghoul']);
    const rngState = world.rng.state;
    const snapshot = JSON.stringify([enc, world.heroes]);
    const tl = fightTimeline(world, enc);
    expect(tl).toHaveLength(TIMELINE_TURNS);
    expect(world.rng.state).toBe(rngState);
    expect(JSON.stringify([enc, world.heroes])).toBe(snapshot);
    for (let i = 1; i < tl.length; i++) expect(tl[i].at).toBeGreaterThanOrEqual(tl[i - 1].at);
    // Draws come off the top of the deck, so only a reshuffle (if any) could make the real run differ: check up to it.
    const span = tl.at(-1)!.at - world.time + 0.05;
    const taken = turnsTaken(world, room, span);
    expect(taken.slice(0, 6)).toEqual(tl.slice(0, 6).map((t) => `${t.id}#${t.n}`));
  });

  it("shows a pick's time and knock-on effects: a slower card puts your next turn later, a Stun skips theirs", () => {
    const { world, monsters, enc } = fight(['cutthroat'], ['ghoul']);
    const h = world.heroes.h0;
    setHand(h, ['envenom', 'cheap']);
    const mine = () => fightTimeline(world, enc).filter((t) => t.id === 'h0').map((t) => t.at);
    expect(submitChoice(world, h, { action: 'card', card: 'envenom', target: monsters[0].id })).toBeNull();
    const quick = mine();
    expect(submitChoice(world, h, { action: 'card', card: 'cheap', target: monsters[0].id })).toBeNull();
    const slow = mine();
    expect(slow[1]).toBeGreaterThan(quick[1]);
    const tl = fightTimeline(world, enc);
    const after = tl.findIndex((t) => t.id === 'h0');
    expect(tl.slice(after).find((t) => t.id === monsters[0].id)?.stunned).toBe(true);
  });

  it('draws someone a pick brings in: a summoned familiar gets its turns, described', () => {
    const { world, enc } = fight(['sorceress'], ['ghoul']);
    const h = world.heroes.h0;
    setHand(h, ['familiar']);
    expect(submitChoice(world, h, { action: 'card', card: 'familiar' })).toBeNull();
    const fresh = fightTimeline(world, enc).filter((t) => t.unit);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh[0].unit).toMatchObject({ side: 'risen' });
    expect(fresh[0].unit!.name).toBeTruthy();
  });

  it('marks the turns that hang on a roll: a Flee only some dice let through', () => {
    const { world, enc } = fight(['warden'], ['ghoul']);
    submitChoice(world, world.heroes.h0, { action: 'flee' });
    const mine = fightTimeline(world, enc).filter((t) => t.id === 'h0');
    expect(mine[0].maybe).toBeUndefined();
    expect(mine.length).toBeGreaterThan(1);
    expect(mine.slice(1).every((t) => t.maybe)).toBe(true);
  });

  it("shows a hero's move only where it's theirs to show, and nothing to bots", () => {
    const { world } = fight(['warden', 'cutthroat'], ['ghoul']);
    world.heroes.h0.isBot = false;
    const tl = buildView(world, 'h0').encounter!.timeline;
    const mine = tl.filter((t) => t.id === 'h0');
    // Your own default shows on your next turn; after that it hangs on what you draw.
    expect(mine[0].label).toBeDefined();
    expect(mine.slice(1).every((t) => t.label === undefined)).toBe(true);
    // An ally who hasn't picked: their hand is theirs.
    expect(tl.filter((t) => t.id === 'h1').every((t) => t.label === undefined)).toBe(true);
    world.heroes.h0.isBot = true;
    expect(buildView(world, 'h0').encounter?.timeline).toEqual([]);
  });
});
