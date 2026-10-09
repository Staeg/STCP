import { describe, expect, it } from 'vitest';
import {
  CORRIDOR_TIME, CROSSROADS_COUNT, dirBetween, generateDungeon, neighbours, hopDistances, isCrossroads, MIN_DEPTH, MIN_LOOPS, ROOM_COUNT,
} from './gen';

const SEEDS = Array.from({ length: 500 }, (_, i) => i * 7919 + 1);

describe('generateDungeon', () => {
  it('is deterministic', () => {
    expect(generateDungeon(123)).toEqual(generateDungeon(123));
  });

  it('satisfies layout invariants over 500 seeds', { timeout: 30000 }, () => {
    for (const seed of SEEDS) {
      const d = generateDungeon(seed);
      const ctx = `seed ${seed}`;
      expect(d.rooms.length, ctx).toBeGreaterThanOrEqual(ROOM_COUNT.min);
      expect(d.rooms.length, ctx).toBeLessThanOrEqual(ROOM_COUNT.max);

      // Connected, the exit is where you start, and there's somewhere deep to go.
      const dist = hopDistances(d, d.entrance);
      expect(dist.every((x) => Number.isFinite(x)), ctx).toBe(true);
      expect(d.exit, ctx).toBe(d.entrance);
      expect(Math.max(...dist), ctx).toBeGreaterThanOrEqual(MIN_DEPTH);
      // Loops: well beyond a tree's rooms − 1 corridors.
      expect(d.corridors.length - (d.rooms.length - 1), ctx).toBeGreaterThanOrEqual(MIN_LOOPS);

      const cross = d.rooms.filter((r) => isCrossroads(d, r.id)).length;
      expect(cross, ctx).toBeGreaterThanOrEqual(CROSSROADS_COUNT.min);
      expect(cross, ctx).toBeLessThanOrEqual(CROSSROADS_COUNT.max);

      // No duplicate corridors or self-loops, sane lengths, back-references consistent.
      const keys = new Set<string>();
      for (const c of d.corridors) {
        expect(c.a, ctx).not.toBe(c.b);
        const k = `${Math.min(c.a, c.b)}-${Math.max(c.a, c.b)}`;
        expect(keys.has(k), ctx).toBe(false);
        keys.add(k);
        expect(c.length, ctx).toBe(CORRIDOR_TIME);
        expect(d.rooms[c.a].corridors).toContain(c.id);
        expect(d.rooms[c.b].corridors).toContain(c.id);
      }

      // At most one neighbour in each compass direction, and the direction is unambiguous on screen.
      for (const r of d.rooms) {
        const dirs = neighbours(d, r.id).map((n) => d.rooms[n]);
        for (const n of dirs) expect(Math.abs(n.gx - r.gx) + Math.abs(n.gy - r.gy), ctx).toBe(1);
        expect(new Set(dirs.map((n) => dirBetween(r, n))).size, ctx).toBe(dirs.length);
        for (const n of dirs) {
          const byGrid = n.gx > r.gx ? 'east' : n.gx < r.gx ? 'west' : n.gy > r.gy ? 'south' : 'north';
          expect(dirBetween(r, n), ctx).toBe(byGrid);
        }
      }

      // Unique names, one exit.
      expect(new Set(d.rooms.map((r) => r.name)).size, ctx).toBe(d.rooms.length);
      expect(d.rooms.filter((r) => r.kind === 'exit').length).toBe(1);
    }
  });
});
