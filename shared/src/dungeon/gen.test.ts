import { describe, expect, it } from 'vitest';
import {
  CORRIDOR_TIME, CROSSROADS_COUNT, dirBetween, generateDungeon, neighbours, hopDistances, isCrossroads, MIN_DEPTH, MIN_LOOPS, openSecrets, ROOM_COUNT,
  SECRET_TIERS,
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
      const plain = d.rooms.filter((r) => r.kind !== 'secret');
      expect(plain.length, ctx).toBeGreaterThanOrEqual(ROOM_COUNT.min);
      expect(plain.length, ctx).toBeLessThanOrEqual(ROOM_COUNT.max);

      // Connected (secret rooms are sealed off), the exit is where you start, and there's somewhere deep to go.
      const dist = hopDistances(d, d.entrance);
      expect(plain.every((r) => Number.isFinite(dist[r.id])), ctx).toBe(true);
      expect(d.rooms.filter((r) => r.kind === 'secret').every((r) => dist[r.id] === Infinity && r.corridors.length === 0), ctx).toBe(true);
      expect(d.exit, ctx).toBe(d.entrance);
      expect(Math.max(...plain.map((r) => dist[r.id])), ctx).toBeGreaterThanOrEqual(MIN_DEPTH);
      // Loops: well beyond a tree's rooms − 1 corridors.
      expect(d.corridors.length - (plain.length - 1), ctx).toBeGreaterThanOrEqual(MIN_LOOPS);

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

      // Secret rooms: on free grid cells, each opening off exactly one ordinary room (never the exit).
      expect(d.secrets.map((s) => s.tier), ctx).toEqual(SECRET_TIERS);
      const cells = new Set(d.rooms.map((r) => `${r.gx},${r.gy}`));
      expect(cells.size, ctx).toBe(d.rooms.length);
      for (const s of d.secrets) {
        const host = d.rooms[s.host];
        const room = d.rooms[s.room];
        expect(room.kind, ctx).toBe('secret');
        expect(host.kind, ctx).toBe('normal');
        expect(Math.abs(host.gx - room.gx) + Math.abs(host.gy - room.gy), ctx).toBe(1);
      }
      expect(openSecrets(d, 4).length, ctx).toBe(2);
      expect(openSecrets(d, 5).length, ctx).toBe(4);
      const after = hopDistances(d, d.entrance);
      expect(after.every((x) => Number.isFinite(x)), ctx).toBe(true);
      for (const s of d.secrets) {
        expect(d.rooms[s.room].corridors, ctx).toEqual([s.corridor.id]);
        expect(d.corridors[s.corridor.id], ctx).toBe(s.corridor);
        expect(s.corridor.secret, ctx).toBe(true);
      }
    }
  });

  it('places secret rooms all over the map, not just in a few spots', () => {
    const cells = new Set<string>();
    for (const seed of SEEDS.slice(0, 200)) for (const s of generateDungeon(seed).secrets) {
      const r = generateDungeon(seed).rooms[s.room];
      cells.add(`${r.gx},${r.gy}`);
    }
    // Every cell but the middle few (where the exit sits) should turn up at some point.
    expect(cells.size).toBeGreaterThan(50);
  });
});
