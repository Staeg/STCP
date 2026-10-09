/**
 * Headless balance simulator: runs all-bot games and prints metrics against the PLAN.md M8 targets.
 *   npm run sim -- --games 100 --seed 1
 *   npm run sim -- --games 60 --set ESCALATION.capPerTier=2 --set ENEMIES.ghoul.dmg=3 --json
 *   npm run sim -- --classes warden,cutthroat,lampbearer,hexer
 * --set may repeat; it overrides any number in the tunable content tables below.
 * Parties are 4 different classes: the ones given by --classes, else a random 4 per game (from the seed).
 */
import * as shared from '@stcp/shared';
import { CLASS_IDS, COLLAPSE_AT, EXIT_OPENS_AT, Game, Rng, TIER_INTERVAL, type ClassId } from '@stcp/shared';

const args = new Map<string, string>();
const sets: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'json') {
    args.set('json', '1');
    continue;
  }
  const val = process.argv[++i];
  if (key === 'set') sets.push(val);
  else args.set(key, val);
}

// Tunables: content tables are plain mutable objects, so overrides apply to every game in this process.
const TUNABLE: Record<string, unknown> = {
  ESCALATION: shared.ESCALATION, ENEMIES: shared.ENEMIES, CLASSES: shared.CLASSES, LOOT: shared.LOOT,
  EVENT_SEEDING: shared.EVENT_SEEDING, BOTS: shared.BOTS, STRESS: shared.STRESS, FIELD_MEND: shared.FIELD_MEND, ABILITIES: shared.ABILITIES,
  CLASS_RULES: shared.CLASS_RULES,
};
for (const s of sets) {
  const [path, raw] = s.split('=');
  const keys = path.split('.');
  let obj = TUNABLE as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (!obj || typeof obj[last] !== 'number') throw new Error(`--set ${path}: not a tunable number`);
  obj[last] = Number(raw);
}
const games = Number(args.get('games') ?? 50);
const seed0 = Number(args.get('seed') ?? 1);
const worldOpts = { events: args.get('events') !== '0' };
const fixedParty = args.get('classes')?.split(',') as ClassId[] | undefined;
if (fixedParty?.some((c) => !CLASS_IDS.includes(c))) throw new Error(`--classes: pick from ${CLASS_IDS.join(', ')}`);

const deathsByTier = new Array(8).fill(0);
const deathsByClass: Record<string, number> = {};
const runsByClass: Record<string, number> = {};
const escapesByClass: Record<string, number> = {};
const causes: Record<string, number> = {};
let heroes = 0, deaths = 0, escaped = 0, wiped = 0, lateRuns = 0, goldOut = 0, dramaRuns = 0;
let fights = 0, turns = 0, fightTime = 0, downs = 0, revives = 0, slain = 0, collapses = 0, waves = 0;
let afflictions = 0, heartAttacks = 0, eventsUsed = 0, altars = 0, saved = 0;
const arrivals: number[] = [];
const t0 = performance.now();

for (let g = 0; g < games; g++) {
  const party = fixedParty ?? new Rng(seed0 + g).shuffle([...CLASS_IDS]).slice(0, 4);
  const game = new Game(seed0 + g, party.map((cls, i) => ({ id: `b${i}`, name: cls, cls, isBot: true })), worldOpts);
  const w = game.world;
  // The climax check: when the exit opens, is someone waiting there while someone else is still alive out there?
  let drama = false;
  while (w.phase === 'running' && w.time <= COLLAPSE_AT + 1) {
    game.tick(0.1);
    if (!drama && Math.abs(w.time - EXIT_OPENS_AT) < 0.05) {
      const alive = Object.values(w.heroes).filter((h) => !h.dead && !h.extracted);
      const atExit = alive.filter((h) => h.pos.kind === 'room' && h.pos.room === w.dungeon.exit);
      drama = atExit.length > 0 && atExit.length < alive.length;
    }
  }
  if (drama) dramaRuns++;
  if (w.phase === 'wiped') wiped++;
  let late = false;
  for (const h of Object.values(w.heroes)) {
    heroes++;
    runsByClass[h.cls] = (runsByClass[h.cls] ?? 0) + 1;
    if (h.arrivedAt !== null) arrivals.push(h.arrivedAt);
    if (h.arrivedAt !== null && h.arrivedAt > EXIT_OPENS_AT + 30) late = true;
    if (h.extracted) {
      escaped++;
      escapesByClass[h.cls] = (escapesByClass[h.cls] ?? 0) + 1;
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
  fights += w.stats.fights; turns += w.stats.turns; fightTime += w.stats.fightTime; downs += w.stats.downs; revives += w.stats.revives;
  slain += w.stats.slain; collapses += w.stats.collapses; waves += w.stats.waves;
  afflictions += w.stats.afflictions; heartAttacks += w.stats.heartAttacks; eventsUsed += w.stats.eventsUsed;
  altars += w.objectives.altars; saved += w.objectives.villagers;
}

const json = {
  games, sets, escaped: escaped / heroes, drama: dramaRuns / games, wipes: wiped / games, lateRuns: lateRuns / games, earlyDeathShare: (deathsByTier[0] + deathsByTier[1]) / Math.max(1, deaths),
  secondsPerFight: fightTime / Math.max(1, fights), turnsPerFight: turns / Math.max(1, fights), deathsByTier, causes, goldPerEscaped: goldOut / Math.max(1, escaped),
  perGame: { fights: fights / games, downs: downs / games, revives: revives / games, collapses: collapses / games, waves: waves / games, afflictions: afflictions / games, altars: altars / games, saved: saved / games },
};
if (args.has('json')) {
  console.log(JSON.stringify(json));
  process.exit(0);
}
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(0)}%`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const early = deathsByTier[0] + deathsByTier[1];
arrivals.sort((a, b) => a - b);
const check = (ok: boolean) => (ok ? '✓' : '✗');
console.log(`${games} games in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`${check(escaped / heroes >= 0.4 && escaped / heroes <= 0.65)} escaped: ${escaped}/${heroes} (${pct(escaped, heroes)})  [target 40–65%]`);
console.log(`${check(dramaRuns / games >= 0.5)} runs where, at 10:00, someone waits at the exit while someone else is still out: ${pct(dramaRuns, games)}  [target ≥50%]`);
console.log(`${check(lateRuns / games >= 0.3)} runs with someone reaching the exit after 10:30: ${pct(lateRuns, games)}  [target ≥30%]`);
console.log(`${check(early / Math.max(1, deaths) <= 0.1)} deaths before 4:00: ${pct(early, deaths)} of deaths  [target ≤10%]`);
const secs = fightTime / Math.max(1, fights);
console.log(`${check(secs >= 18 && secs <= 36)} seconds per fight: ${secs.toFixed(1)} (${(turns / Math.max(1, fights)).toFixed(1)} hero turns)  [target 18–36s, the old 3–6 six-second rounds]`);
console.log(`full wipes: ${pct(wiped, games)}`);
console.log(`deaths by tier: ${deathsByTier.map((n, i) => `T${i}:${n}`).join(' ')}`);
console.log(`deaths by class: ${JSON.stringify(deathsByClass)}`);
console.log(`escape rate by class: ${Object.keys(runsByClass).sort().map((c) => `${c} ${Math.round((100 * (escapesByClass[c] ?? 0)) / runsByClass[c])}% (n=${runsByClass[c]})`).join(' · ')}`);
console.log(`death causes: ${JSON.stringify(causes)}`);
console.log(`exit arrivals: median ${arrivals.length ? fmt(arrivals[Math.floor(arrivals.length / 2)]) : '-'}, n=${arrivals.length}`);
console.log(`per game: ${(fights / games).toFixed(1)} fights, ${(slain / games).toFixed(1)} slain, ${(downs / games).toFixed(1)} downs, ${(revives / games).toFixed(1)} revives, ${(collapses / games).toFixed(1)} collapses, ${(waves / games).toFixed(1)} waves`);
console.log(`per game: ${(afflictions / games).toFixed(1)} afflictions, ${(heartAttacks / games).toFixed(1)} heart attacks, ${(eventsUsed / games).toFixed(1)} events used, ${(altars / games).toFixed(1)} altars, ${(saved / games).toFixed(1)} villagers saved`);
console.log(`gold extracted per escaped hero: ${(goldOut / Math.max(1, escaped)).toFixed(0)}`);
