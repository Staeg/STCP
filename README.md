# So They Can Prosper

A multiplayer, Darkest-Dungeon-inspired crawl. Up to 4 heroes (bots fill empty slots) split up in a dungeon that gets worse every two minutes. The exit opens at **10:00**. At **13:00** the dungeon collapses on anyone still inside.

## Run it

```bash
npm install
npm run dev     # dev: client at http://localhost:5180 (LAN-exposed), game server on :3001
npm start       # host a game: builds the client and serves everything from http://localhost:3001
npm test        # unit tests
```

Friends join through your LAN IP (`http://<your-ip>:3001` with `npm start`), or through a tunnel such as `cloudflared tunnel --url http://localhost:3001`. Create an expedition, share the 4-letter code or the link, pick classes, ready up, and the host presses **Descend**. Voice chat is assumed; there's no in-game chat.

Set `GAME_PORT` to change the server port, and `SEED` to fix the dungeon seed. In dev, `CLIENT_PORT` moves the Vite client too (the `dev-alt` launch config uses 5190/3011, so two dev servers can run side by side).

### Solo playtest build

**https://staeg.github.io/STCP/** is a no-server build for quick playtests: you and three bots, with the whole game running in the browser tab. Every push to `main` rebuilds it (`.github/workflows/pages.yml`). Career stats live in that browser's localStorage. Add `?solo` to any build (for example `http://localhost:5180/?solo` in dev) to get the same mode locally. The run slows down while its tab is in the background, because browsers throttle timers in hidden tabs.

## How to play

- **Explore:** the map follows your hero. Click a known room to walk there; every tunnel takes 6 seconds, and routes avoid rooms you know hold monsters. You start at the ⚑ exit in the middle of the dungeon, and the paths loop and cross back on each other. You only see what you've explored. Allies show live when they're in sight (with a ring in their colour on the room they've chosen to walk to), otherwise as a grey ghost where you last saw them. Coloured chalk marks at crossroads show which way each ally went.
- **Fight:** every round lasts 6 seconds, and you can change your mind until it's up. You see each ally's pick on their card as soon as they make it, with a pip in their colour on their target. Use abilities **1 2 3**, items **4–7**, **R** revive, **F** flee, **B** brace. If you don't pick, you brace. The action bar stays on screen while you explore (greyed out) so you always know what you have.
- **Loot:** clearing a room of monsters always drops at least one item, and bigger or tougher groups drop more and better ones. Gold is split between everyone in the room. Each item needs a **unanimous vote**, and nobody can leave until you agree (or agree to leave it).
- **Between fights:** **R** revive a downed ally (6s), **D** dig through rubble (18s, Warden 12s), **M** mend (Lampbearer), **4–7** use items.
- **Events:** altars, captives, idols, wells, vaults… Each takes time in 6-second steps (altar 18s, vault 24s, most others 6s). Whoever chooses first does it, and everyone in the room sees who's doing what; walking away stops it but keeps the progress.
- **Get out:** return to the ⚑ exit where you started and press **E** once it opens. Escaped gold counts toward your career title and the **Hall of Fortune**.

## Developer notes

- Design, decisions and the roadmap are in [PLAN.md](PLAN.md). The latest playtest report is in [PLAYTEST.md](PLAYTEST.md).
- Balance: `npm run sim -- --games 100 [--set ESCALATION.capPerTier=2 …]` and `cd server && npx tsx src/sweep.ts …`.
- Network/fog check: `npx tsx tools/playtest-harness.ts --players 4 --speed 10` (with `npm run dev` running).
- Sprites: edit `tools/sprites.py`, then run `python tools/sprites.py client/src/render/sprite-data.ts`.
- Dev-only commands (server started with `--debug`, which `npm run dev` does), from the browser console: `__net.send({t:'debugSkip', seconds: 300})`, `debugSpawn`, `debugLoot`, `debugEvent`, `debugSpeed`.
