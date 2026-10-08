/**
 * Headless balance simulator: runs all-bot games and prints metrics against the PLAN.md M8 targets.
 *   npm run sim -- --games 100 --seed 1
 */
import { CLASS_IDS, COLLAPSE_AT, EXIT_OPENS_AT, Game, TIER_INTERVAL } from '@stcp/shared';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const games = Number(args.get('games') ?? 50);
const seed0 = Number(args.get('seed') ?? 1);
const worldOpts = { events: args.get('events') !== '0' };

const deathsByTier = new Array(8).fill(0);
const deathsByClass: Record<string, number> = {};
const causes: Record<string, number> = {};
let heroes = 0, deaths = 0, escaped = 0, wiped = 0, lateRuns = 0, goldOut = 0;
let fights = 0, rounds = 0, downs = 0, revives = 0, slain = 0, collapses = 0, waves = 0;
let afflictions = 0, heartAttacks = 0, eventsUsed = 0, altars = 0, saved = 0;
const arrivals: number[] = [];
const t0 = performance.now();

for (let g = 0; g < games; g++) {
  const game = new Game(seed0 + g, CLASS_IDS.map((cls, i) => ({ id: `b${i}`, name: cls, cls, isBot: true })), worldOpts);
  const w = game.world;
  while (w.phase === 'running' && w.time <= COLLAPSE_AT + 1) game.tick(0.1);
  if (w.phase === 'wiped') wiped++;
  let late = false;
  for (const h of Object.values(w.heroes)) {
    heroes++;
    if (h.arrivedAt !== null) arrivals.push(h.arrivedAt);
    if (h.arrivedAt !== null && h.arrivedAt > EXIT_OPENS_AT + 30) late = true;
    if (h.extracted) {
      escaped++;
      goldOut += h.gold;
    } else {
      deaths++;
      deathsByTier[Math.min(7, Math.floor((h.diedAt ?? COLLAPSE_AT) / TIER_INTERVAL))]++;
      deathsByClass[h.cls] = (deathsByClass[h.cls] ?? 0) + 1;
      const cause = (h.fate ?? '').startsWith('was buried') ? 'buried' : 'bled out';
      const where = (h.diedAt ?? 0) >= EXIT_OPENS_AT && h.pos.kind === 'room' && h.pos.room === w.dungeon.exit ? ' at exit' : '';
      causes[cause + where] = (causes[cause + where] ?? 0) + 1;
    }
  }
  if (late) lateRuns++;
  fights += w.stats.fights; rounds += w.stats.rounds; downs += w.stats.downs; revives += w.stats.revives;
  slain += w.stats.slain; collapses += w.stats.collapses; waves += w.stats.waves;
  afflictions += w.stats.afflictions; heartAttacks += w.stats.heartAttacks; eventsUsed += w.stats.eventsUsed;
  altars += w.objectives.altars; saved += w.objectives.villagers;
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const early = deathsByTier[0] + deathsByTier[1];
arrivals.sort((a, b) => a - b);
const check = (ok: boolean) => (ok ? '✓' : '✗');
console.log(`${games} games in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`${check(escaped / heroes >= 0.4 && escaped / heroes <= 0.65)} escaped: ${escaped}/${heroes} (${pct(escaped, heroes)})  [target 40–65%]`);
console.log(`${check(lateRuns / games >= 0.3)} runs with someone reaching the exit after 10:30: ${pct(lateRuns, games)}  [target ≥30%]`);
console.log(`${check(early / Math.max(1, deaths) <= 0.1)} deaths before 4:00: ${pct(early, deaths)} of deaths  [target ≤10%]`);
console.log(`${check(rounds / fights >= 3 && rounds / fights <= 6)} rounds per fight: ${(rounds / Math.max(1, fights)).toFixed(1)}  [target 3–6 (mean)]`);
console.log(`full wipes: ${pct(wiped, games)}`);
console.log(`deaths by tier: ${deathsByTier.map((n, i) => `T${i}:${n}`).join(' ')}`);
console.log(`deaths by class: ${JSON.stringify(deathsByClass)}`);
console.log(`death causes: ${JSON.stringify(causes)}`);
console.log(`exit arrivals: median ${arrivals.length ? fmt(arrivals[Math.floor(arrivals.length / 2)]) : '-'}, n=${arrivals.length}`);
console.log(`per game: ${(fights / games).toFixed(1)} fights, ${(slain / games).toFixed(1)} slain, ${(downs / games).toFixed(1)} downs, ${(revives / games).toFixed(1)} revives, ${(collapses / games).toFixed(1)} collapses, ${(waves / games).toFixed(1)} waves`);
console.log(`per game: ${(afflictions / games).toFixed(1)} afflictions, ${(heartAttacks / games).toFixed(1)} heart attacks, ${(eventsUsed / games).toFixed(1)} events used, ${(altars / games).toFixed(1)} altars, ${(saved / games).toFixed(1)} villagers saved`);
console.log(`gold extracted per escaped hero: ${(goldOut / Math.max(1, escaped)).toFixed(0)}`);
