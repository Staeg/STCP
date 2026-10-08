import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // expose on LAN so friends can join the dev build
    port: 5180,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
