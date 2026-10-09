/**
 * Balance sweeps: run several sim variants in parallel (same seeds) and print a comparison table.
 *   npx tsx src/sweep.ts --games 60 --parallel 4 \
 *     "base" \
 *     "cap2: ESCALATION.capPerTier=2" \
 *     "cap2+scale: ESCALATION.capPerTier=2 ESCALATION.tierScaling=0.07"
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
let games = 60;
let parallel = 4;
let seed = 1;
const variants: { name: string; sets: string[] }[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--games') games = Number(argv[++i]);
  else if (argv[i] === '--parallel') parallel = Number(argv[++i]);
  else if (argv[i] === '--seed') seed = Number(argv[++i]);
  else {
    const [name, rest] = argv[i].includes(':') ? argv[i].split(/:\s*/, 2) : [argv[i], ''];
    variants.push({ name, sets: rest ? rest.trim().split(/\s+/) : [] });
  }
}
// Run from the server folder with a relative path: the project path may contain spaces.
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function runOne(v: { name: string; sets: string[] }): Promise<Record<string, any>> {
  const args = ['tsx', 'src/sim-cli.ts', '--games', String(games), '--seed', String(seed), '--json', ...v.sets.flatMap((s) => ['--set', s])];
  return new Promise((resolve, reject) => {
    const p = spawn('npx', args, { shell: true, cwd: serverDir });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? '';
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`${v.name} failed (${code}): ${err || out}`));
      }
    });
  });
}

const results = new Array(variants.length);
let next = 0;
async function worker() {
  while (next < variants.length) {
    const i = next++;
    results[i] = await runOne(variants[i]);
    process.stderr.write(`done: ${variants[i].name}\n`);
  }
}
await Promise.all(Array.from({ length: Math.min(parallel, variants.length) }, worker));

const pct = (x: number) => `${(100 * x).toFixed(0)}%`.padStart(5);
console.log(`${games} games/variant, seed ${seed}.  targets: esc 40–65%, drama ≥50%, late ≥30%, early ≤10%, fight 18–36s`);
console.log('variant'.padEnd(22) + '  esc  wipe drama  late early  spf  gold  downs revives');
variants.forEach((v, i) => {
  const r = results[i];
  console.log(
    v.name.padEnd(22) + pct(r.escaped) + pct(r.wipes) + pct(r.drama) + pct(r.lateRuns) + pct(r.earlyDeathShare) +
      r.secondsPerFight.toFixed(0).padStart(5) + r.goldPerEscaped.toFixed(0).padStart(6) +
      r.perGame.downs.toFixed(1).padStart(7) + r.perGame.revives.toFixed(1).padStart(8),
  );
});
