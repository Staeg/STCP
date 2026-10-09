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

// CLIENT_PORT / GAME_PORT let a second dev server run alongside the usual 5180/3001.
const clientPort = Number(process.env.CLIENT_PORT ?? 5180);
const gamePort = Number(process.env.GAME_PORT ?? 3001);

export default defineConfig({
  // Relative asset paths, so the static build works from a subpath (GitHub Pages serves it at /STCP/).
  base: './',
  define: {
    __BUILD__: JSON.stringify(commit ? `${branch} @ ${commit}${dirty}` : branch),
  },
  server: {
    host: true, // expose on LAN so friends can join the dev build
    port: clientPort,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${gamePort}`, ws: true },
    },
  },
});
