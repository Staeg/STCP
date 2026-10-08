import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STASH_PATH = resolve(fileURLToPath(import.meta.url), '../../data/stash.json');

/**
 * Gold banked across runs, keyed by player name (case-insensitive). No accounts in the prototype,
 * so a name is an identity. Spending it comes in M11.
 */
export class Stash {
  private data: Record<string, number> = {};

  constructor(private path: string | null = DEFAULT_STASH_PATH) {
    if (path && existsSync(path)) {
      try {
        this.data = JSON.parse(readFileSync(path, 'utf8'));
      } catch (e) {
        console.warn(`Could not read stash at ${path}; starting empty.`, e);
      }
    }
  }

  get(name: string): number {
    return this.data[name.toLowerCase()] ?? 0;
  }

  add(name: string, gold: number) {
    if (gold <= 0) return;
    const key = name.toLowerCase();
    this.data[key] = (this.data[key] ?? 0) + gold;
    this.save();
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}
