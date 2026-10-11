import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Branch and short commit of the checkout being built, shown in the corner of the menu. */
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
// CI checkouts can be detached; GITHUB_REF_NAME names the branch there.
const branch = process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD') || 'unknown';
const commit = git('rev-parse --short HEAD');
const dirty = git('status --porcelain') ? '*' : '';

/**
 * One deploy of the playable build: what it shipped since the previous successful deploy. `at` is null for local commits not pushed yet.
 * Commits list their changes as `Headline:` / `Major:` / `Minor:` lines (see CLAUDE.md); untagged commits land in `other` by subject.
 */
interface PatchGroup { at: string | null; sha: string; headlines: string[]; major: string[]; minor: string[]; other: string[] }

/** Commits between two revisions, newest first. Commits that only touch Markdown (plans, notes) don't change the game, so they're left out. */
function commitsBetween(from: string | null, to: string) {
  const range = from ? `${from}..${to}` : to;
  const out = git(`log --no-merges --format=%s%x1f%b%x1e ${range} -- ":/" ":(top,exclude)*.md"`);
  return out.split('\x1e').map((c) => c.trim()).filter(Boolean).map((c) => {
    const [msg, body = ''] = c.split('\x1f');
    return { msg, body };
  });
}

/** Sort a push's commits into its patch notes. `Patch: none` hides a commit that doesn't change play (tests, tooling). */
function patchGroup(at: string | null, sha: string, commits: { msg: string; body: string }[]): PatchGroup {
  const g: PatchGroup = { at, sha: sha.slice(0, 7), headlines: [], major: [], minor: [], other: [] };
  for (const { msg, body } of commits) {
    let tagged = false;
    for (const line of body.split('\n')) {
      const m = /^(Headline|Major|Minor|Patch):\s*(.+?)\s*$/i.exec(line.trim());
      if (!m) continue;
      tagged = true;
      const kind = m[1].toLowerCase();
      if (kind === 'headline') g.headlines.push(m[2]);
      else if (kind === 'major' || kind === 'minor') g[kind].push(m[2]);
    }
    if (!tagged) g.other.push(msg);
  }
  return g;
}

const isAncestor = (sha: string) => {
  try {
    execSync(`git merge-base --is-ancestor ${sha} HEAD`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Patch notes for the menu: one group per push that deployed (the Pages workflow's runs give the push times;
 * git doesn't record them). Pushes whose deploy failed or was cancelled fold into the next one that went out.
 */
async function patchNotes(): Promise<PatchGroup[]> {
  const head = git('rev-parse HEAD');
  if (!head) return [];
  let runs: { head_sha: string; created_at: string; status: string; conclusion: string | null }[] = [];
  let complete = false;
  try {
    const token = process.env.GITHUB_TOKEN;
    const res = await fetch('https://api.github.com/repos/Staeg/STCP/actions/workflows/pages.yml/runs?branch=main&event=push&per_page=100', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json() as { total_count: number; workflow_runs: typeof runs };
    runs = body.workflow_runs ?? [];
    complete = runs.length >= (body.total_count ?? 0);
  } catch { /* offline: everything shows as unreleased below */ }
  // The run building this very push is still in progress, so count unfinished runs too.
  const pushes = runs
    .filter((r) => (r.conclusion === 'success' || r.status !== 'completed') && isAncestor(r.head_sha))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const groups: PatchGroup[] = [];
  // Without the full run history the oldest push only serves as the base for the next one.
  let prev: string | null = complete ? null : pushes.shift()?.head_sha ?? null;
  for (const p of pushes) {
    if (prev === p.head_sha) continue;
    groups.push(patchGroup(p.created_at, p.head_sha, commitsBetween(prev, p.head_sha)));
    prev = p.head_sha;
  }
  groups.push(patchGroup(null, head, commitsBetween(prev, 'HEAD')));
  return groups.filter((g) => g.headlines.length + g.major.length + g.minor.length + g.other.length).reverse().slice(0, 40);
}

// CLIENT_PORT / GAME_PORT let a second dev server run alongside the usual 5180/3001.
const clientPort = Number(process.env.CLIENT_PORT ?? 5180);
const gamePort = Number(process.env.GAME_PORT ?? 3001);

export default defineConfig(async () => ({
  // Relative asset paths, so the static build works from a subpath (GitHub Pages serves it at /STCP/).
  base: './',
  define: {
    __BUILD__: JSON.stringify(commit ? `${branch} @ ${commit}${dirty}` : branch),
    __PATCH_NOTES__: JSON.stringify(await patchNotes()),
  },
  server: {
    host: true, // expose on LAN so friends can join the dev build
    port: clientPort,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${gamePort}`, ws: true },
    },
  },
}));
