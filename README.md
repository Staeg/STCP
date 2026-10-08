# So They Can Prosper

A multiplayer, Darkest-Dungeon-inspired crawl: up to 4 heroes, one rendezvous, a dungeon that gets worse every two minutes.

## Run it

```bash
npm install
npm run dev     # dev: client at http://localhost:5180 (LAN-exposed), game server on :3001
npm start       # host a game: builds the client and serves everything from http://localhost:3001
npm test        # unit tests
```

Friends join through your LAN IP, or a tunnel such as `cloudflared tunnel --url http://localhost:3001`.
Set `GAME_PORT` to change the server port, and `SEED` to fix the dungeon seed.

See [PLAN.md](PLAN.md) for the design and roadmap.
