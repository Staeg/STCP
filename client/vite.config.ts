import { defineConfig } from 'vite';

// CLIENT_PORT / GAME_PORT let a second dev server run alongside the usual 5180/3001.
const clientPort = Number(process.env.CLIENT_PORT ?? 5180);
const gamePort = Number(process.env.GAME_PORT ?? 3001);

export default defineConfig({
  // Relative asset paths, so the static build works from a subpath (GitHub Pages serves it at /STCP/).
  base: './',
  server: {
    host: true, // expose on LAN so friends can join the dev build
    port: clientPort,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${gamePort}`, ws: true },
    },
  },
});
