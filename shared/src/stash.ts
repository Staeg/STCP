import { titleFor, type CareerStats, type LeaderboardEntry } from './content/titles';

/** Where the stash is kept: a JSON file on the server, localStorage in solo play. */
export interface StashStore {
  load(): string | null;
  save(json: string): void;
}

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

  /** `null` keeps everything in memory (tests). */
  constructor(private store: StashStore | null = null) {
    const raw = store?.load();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, number | Record_>;
      for (const [key, v] of Object.entries(parsed)) {
        // M5–M10 stored just a gold number.
        this.data[key] = typeof v === 'number' ? { name: key, gold: v, runs: 0, escapes: 0, best: v } : v;
      }
    } catch {
      // Unreadable stash: start empty.
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
    this.store?.save(JSON.stringify(this.data, null, 2));
  }

  leaderboard(limit = 10): LeaderboardEntry[] {
    return Object.values(this.data)
      .filter((r) => r.gold > 0 || r.runs > 0)
      .sort((a, b) => b.gold - a.gold || b.escapes - a.escapes)
      .slice(0, limit)
      .map((r) => ({ name: r.name, gold: r.gold, runs: r.runs, escapes: r.escapes, best: r.best, title: titleFor(r.gold) }));
  }
}
