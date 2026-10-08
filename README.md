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

Set `GAME_PORT` to change the server port, and `SEED` to fix the dungeon seed.

## How to play

- **Explore:** click a known room to walk there; routes avoid rooms you know hold monsters. You only see what you've explored. Allies show live when they're in sight, otherwise as a grey ghost where you last saw them. Coloured chalk marks at crossroads show which way each ally went.
- **Fight:** rounds last 5 seconds. Use abilities **1 2 3**, items **4–7**, **R** revive, **F** flee, **B** brace. If time runs out, you brace.
- **Loot:** gold is split between everyone in the room. Each item needs a **unanimous vote**, and nobody can leave until you agree (or agree to leave it).
- **Between fights:** **R** revive a downed ally (3s), **D** dig through rubble, **M** mend (Lampbearer), **4–7** use items.
- **Events:** altars, captives, idols, wells, vaults… Whoever clicks first decides.
- **Get out:** reach the ⚑ Rendezvous and press **E** once the exit opens. Escaped gold counts toward your career title and the **Hall of Fortune**.

## Developer notes

- Design, decisions and the roadmap are in [PLAN.md](PLAN.md). The latest playtest report is in [PLAYTEST.md](PLAYTEST.md).
- Balance: `npm run sim -- --games 100 [--set ESCALATION.capPerTier=2 …]` and `cd server && npx tsx src/sweep.ts …`.
- Network/fog check: `npx tsx tools/playtest-harness.ts --players 4 --speed 10` (with `npm run dev` running).
- Sprites: edit `tools/sprites.py`, then run `python tools/sprites.py client/src/render/sprite-data.ts`.
- Dev-only commands (server started with `--debug`, which `npm run dev` does), from the browser console: `__net.send({t:'debugSkip', seconds: 300})`, `debugSpawn`, `debugLoot`, `debugEvent`, `debugSpeed`.
