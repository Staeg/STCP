import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextTitle, titleFor } from '@stcp/shared';
import { Stash } from './persistence';

describe('Stash (career stats)', () => {
  it('records runs, escapes, total and best haul, case-insensitively', () => {
    const s = new Stash(null);
    s.recordRun('Mara', true, 80);
    s.recordRun('mara', false, 200); // died: gold doesn't count
    s.recordRun('MARA', true, 120);
    expect(s.stats('Mara')).toEqual({ gold: 200, runs: 3, escapes: 2, best: 120 });
    expect(s.get('mara')).toBe(200);
  });

  it('ranks the Hall of Fortune by total gold, with titles', () => {
    const s = new Stash(null);
    s.recordRun('Low', true, 50);
    s.recordRun('High', true, 900);
    s.recordRun('Dead', false, 999);
    const board = s.leaderboard();
    expect(board.map((e) => e.name)).toEqual(['High', 'Low', 'Dead']);
    expect(board[0].title).toBe('Treasure-Seeker');
    expect(board[2].gold).toBe(0);
  });

  it('migrates the old gold-only format and persists to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stcp-'));
    const file = join(dir, 'stash.json');
    writeFileSync(file, JSON.stringify({ tobin: 340 }));
    const s = new Stash(file);
    expect(s.stats('Tobin')).toEqual({ gold: 340, runs: 0, escapes: 0, best: 340 });
    s.recordRun('Tobin', true, 10);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.tobin.gold).toBe(350);
  });
});

describe('titles', () => {
  it('climb with total gold', () => {
    expect(titleFor(0)).toBe('Nobody');
    expect(titleFor(100)).toBe('Scavenger');
    expect(titleFor(2999)).toBe('Gilded');
    expect(titleFor(10000)).toBe('Legend of the Deep');
    expect(nextTitle(250)).toEqual({ title: 'Delver', at: 300 });
    expect(nextTitle(5000)).toBeNull();
  });
});
