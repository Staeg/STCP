import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleFor, type CareerStats, type LeaderboardEntry } from '@stcp/shared';

export const DEFAULT_STASH_PATH = resolve(fileURLToPath(import.meta.url), '../../data/stash.json');

interface Record_ extends CareerStats {
  /** Display name as last used (keys are lower-cased). */
  name: string;
}

/**
 * Career stats per player name (case-insensitive). No accounts in the prototype, so a name is an
 * identity. Gold is for bragging only (titles + the Hall of Fortune), by the user's choice in M11.
 */
export class Stash {
  private data: Record<string, Record_> = {};

  constructor(private path: string | null = DEFAULT_STASH_PATH) {
    if (path && existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number | Record_>;
        for (const [key, v] of Object.entries(raw)) {
          // M5–M10 stored just a gold number.
          this.data[key] = typeof v === 'number' ? { name: key, gold: v, runs: 0, escapes: 0, best: v } : v;
        }
      } catch (e) {
        console.warn(`Could not read stash at ${path}; starting empty.`, e);
      }
    }
  }

  get(name: string): number {
    return this.data[name.toLowerCase()]?.gold ?? 0;
  }

  stats(name: string): CareerStats {
    const r = this.data[name.toLowerCase()];
    return r ? { gold: r.gold, runs: r.runs, escapes: r.escapes, best: r.best } : { gold: 0, runs: 0, escapes: 0, best: 0 };
  }

  /** Record one finished run for a player. */
  recordRun(name: string, escaped: boolean, gold: number) {
    const key = name.toLowerCase();
    const r = (this.data[key] ??= { name, gold: 0, runs: 0, escapes: 0, best: 0 });
    r.name = name;
    r.runs++;
    if (escaped) {
      r.escapes++;
      r.gold += gold;
      r.best = Math.max(r.best, gold);
    }
    this.save();
  }

  leaderboard(limit = 10): LeaderboardEntry[] {
    return Object.values(this.data)
      .filter((r) => r.gold > 0 || r.runs > 0)
      .sort((a, b) => b.gold - a.gold || b.escapes - a.escapes)
      .slice(0, limit)
      .map((r) => ({ name: r.name, gold: r.gold, runs: r.runs, escapes: r.escapes, best: r.best, title: titleFor(r.gold) }));
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
