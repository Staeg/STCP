import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StashStore } from '@stcp/shared';

export const DEFAULT_STASH_PATH = resolve(fileURLToPath(import.meta.url), '../../data/stash.json');

/** The server keeps the stash in a JSON file. */
export function fileStore(path = DEFAULT_STASH_PATH): StashStore {
  return {
    load: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    save: (json) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, json);
    },
  };
}
