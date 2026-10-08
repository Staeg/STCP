/**
 * Headless balance simulator: runs all-bot games and prints aggregate metrics.
 *   npx tsx server/src/sim-cli.ts --games 100 --seed 1
 * (Grows into the full M8 tool.)
 */
import { CLASS_IDS, COLLAPSE_AT, Game, TIER_INTERVAL } from '@stcp/shared';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const games = Number(args.get('games') ?? 50);
const seed0 = Number(args.get('seed') ?? 1);

const deathsByTier = new Array(8).fill(0);
const deathsByClass: Record<string, number> = {};
let heroes = 0;
let deaths = 0;
let survivorsHp = 0;
let survivors = 0;
let monsters = 0;
let goldHeld = 0;
let goldPossible = 0;
let atExit = 0;
let wiped = 0;
const t0 = performance.now();

for (let g = 0; g < games; g++) {
  const game = new Game(seed0 + g, CLASS_IDS.map((cls, i) => ({ id: `b${i}`, name: cls, cls, isBot: true })));
  const w = game.world;
  monsters += Object.keys(w.monsters).length;
  goldPossible += Object.values(w.piles).reduce((s, p) => s + p.gold, 0);
  while (w.phase === 'running' && w.time < COLLAPSE_AT) game.tick(0.1);
  if (w.phase === 'wiped') wiped++;
  for (const h of Object.values(w.heroes)) {
    heroes++;
    if (h.dead) {
      deaths++;
      deathsByTier[Math.floor((h.diedAt ?? 0) / TIER_INTERVAL)]++;
      deathsByClass[h.cls] = (deathsByClass[h.cls] ?? 0) + 1;
    } else {
      survivors++;
      survivorsHp += h.hp / h.maxHp;
      goldHeld += h.gold;
      if (h.pos.kind === 'room' && h.pos.room === w.dungeon.exit) atExit++;
    }
  }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;
console.log(`${games} games in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`heroes died: ${deaths}/${heroes} (${pct(deaths, heroes)}), full wipes: ${pct(wiped, games)}`);
console.log(`deaths by tier: ${deathsByTier.map((n, i) => `T${i}:${n}`).join(' ')}`);
console.log(`deaths by class: ${JSON.stringify(deathsByClass)}`);
console.log(`survivors at exit when time ran out: ${atExit}/${survivors}, avg HP ${pct(survivorsHp, survivors)}`);
console.log(`gold held by survivors: ${goldHeld} of ${goldPossible} seeded (${pct(goldHeld, goldPossible)})`);
