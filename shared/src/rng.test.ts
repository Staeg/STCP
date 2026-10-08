import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from './rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs across seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('int stays within inclusive bounds and hits both ends', () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('can resume from a saved state', () => {
    const a = new Rng(99);
    a.next();
    const b = new Rng(a.state);
    expect(a.next()).toBe(b.next());
  });

  it('shuffle keeps all elements', () => {
    const out = new Rng(3).shuffle([1, 2, 3, 4, 5]);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('hashSeed is stable', () => {
    expect(hashSeed('ABCD')).toBe(hashSeed('ABCD'));
    expect(hashSeed('ABCD')).not.toBe(hashSeed('ABCE'));
  });
});
