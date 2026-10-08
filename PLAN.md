# So They Can Prosper — Build Plan

> **For future Claude sessions:** This file is the source of truth. At the start of every session:
> 1. Read this whole file, especially **Decisions** and the **Progress Log** at the bottom.
> 2. Pick the first unchecked milestone. Don't skip ahead unless a milestone is explicitly blocked.
> 3. Before ending the session, tick off what's done, add a Progress Log entry (date, what changed, what's next, known bugs), and commit.
> 4. If you hit a real design ambiguity, ask the user (they like being asked). Otherwise use your judgment and record the decision in **Decisions**.

---

## 1. Vision (one paragraph)

Darkest Dungeon, but multiplayer. Up to 4 players each control one hero in a shared dungeon, with bots filling empty slots. Exploration is real-time; combat is turn-based with a 5-second timer per round. Everyone agrees to meet at the **rendezvous** (the exit). Over 10 minutes things get worse: monsters respawn stronger, light runs out, tunnels collapse, and minds fray. The climax is the moment at the exit when only two of four heroes have shown up. Do you wait, leave, or go back for them?

**Design pillars.** Use these to decide anything not covered below.
1. **The clock is the antagonist.** Every system should give players a reason to spend time and something to lose by doing so.
2. **Uncertainty about allies.** Individual fog means you often *don't know* what happened to your friends.
3. **Greed vs. loyalty.** Loot is tempting, and it has to be negotiated.
4. **Readable in 5 seconds.** Combat choices must be quick to understand. Use 3 abilities, clear cooldowns, and obvious targets.

---

## 2. Decisions (agreed with the user)

| Topic | Decision |
|---|---|
| Platform | Browser client (TypeScript + Vite) + Node WebSocket server. The server is authoritative. |
| Hosting | The host runs `npm start` locally. Friends join via LAN IP or a tunnel URL (ngrok/cloudflared). Lobby code, no accounts. |
| Turn model | **Real-time exploration**, **turn-based combat**. A combat round ends when every hero in that fight has locked in, or after 5s. The world clock keeps running during combat. |
| Map | **Room graph**: rooms joined by corridors. Crossroads are rooms with 3+ exits. Walking a corridor takes real time. |
| Run shape | **One expedition, one rendezvous.** The rendezvous room is the exit, and its location is known to everyone from the start. |
| Extraction | At **10:00** the exit opens. During a fight at the open exit, Flee = escape (same 70%/Smoke rules). Each player decides for themselves when to leave. Waves spawn at the exit while it's open. At **13:00** the dungeon collapses and everyone still inside dies. |
| 0 HP | **Downed** → bleeds out over 30s (combat rounds count as their real time). An ally in the room can revive. Otherwise the hero dies and drops their items in the room. |
| Loot | **Co-op.** Every *item* goes to exactly one player. All living heroes in the room must agree on the recipient (or unanimously agree to leave it), and **nobody present can leave the room until they agree**. **Gold** is split equally among all heroes present (downed but alive heroes count). |
| Information | **Individual fog.** You see only rooms you've explored. Allies show up live when they're in your room or an adjacent one; otherwise they're a greyed-out ghost at their *last known position*. At crossroads you see **chalk marks** for which exits allies have taken (this satisfies the requirement to "see which way others chose"). |
| Comms | None in-game. Assume voice chat. Bots can't hear voice, so they act on what they can observe. |
| Stress | Simple stress in v1 (0–100). At 100 the hero gains an **affliction**. |
| Visuals | **Pixel art sprites.** Use a CC0 pack (candidates: 0x72 *16x16 DungeonTileset II*, Kenney *Tiny Dungeon*). **Ask the user for permission before downloading**, or ask them to drop it into `client/public/assets/`. Use colored-rectangle placeholders until then. |
| Players | 1–4 humans. Empty slots are filled by bots of *mediocre* ability. |
| Escalation | Every **2:00** the dungeon tier goes up by 1 (T0 to T6). |
| Ports | Vite dev client on **5180** (5173 is used by something else on this machine). Game server on **3001**, configured with `GAME_PORT` (not `PORT`, which the preview tool sets). |
| Identity | Each tab holds a secret token in sessionStorage, so refreshing resumes the same hero and separate tabs act as separate players. Other clients only ever see a public id. Leaving mid-run hands your hero to a bot. |
| Visibility | You see an ally if you're in the same room or corridor, they're in a corridor touching your room, or (while not Dim) they're in an adjacent room. Chalk marks are physical: you only learn a crossroads' marks by standing in it, and you see them as they were on your last visit. |
| Debug | `npm run dev` starts the server with `--debug`, which enables `{t:'debugSkip', seconds}` (fast-forward) and `{t:'debugSpawn', enemies:['ghoul',…]}` (spawns monsters in your room, starts a fight, and fully heals/resurrects you). Use `__net.send(...)` from the browser console. |
| Loot rules (v1) | Gold is auto-split among everyone present (downed included) as soon as nobody's fighting there. Each item opens a vote among the conscious, non-fighting heroes in the room; arriving heroes stop and join. "Leave it" abandons an item, and anyone can **claim** it later, which starts a new vote. Dropping an item puts it to a vote. Wasting a Bandage at full HP or a Tonic at 0 stress is refused. Bots defer to the humans' majority after 2s; all-bot rooms converge on the lowest-id bot. |
| Combat rules (v1) | Monsters never attack downed heroes; the fight ends when no conscious hero remains, but the monsters stay in the room. Anyone arriving later starts a new fight that includes the downed heroes, so a rescue is always possible until bleed-out. Cooldown N = N rounds unusable. Guard, Smoke and Brace apply before anyone acts. Heroes' cooldowns and statuses (except Bleed) reset after each fight. Stress (0–100) exists now: Acolyte Whisper, allies falling (+15) or dying (+25), Rally/Vigil to reduce it. Afflictions come in M6. |
| Collapses (changed in M5) | **Any** tunnel can collapse from T3, every 45s, and becomes **rubble** that anyone at either end can dig through (15s, Warden 9s). Nobody is ever permanently trapped, but being walled in costs real time ("Stuck?" from the pitch). The original "never cut the path" rule left almost nothing collapsible, because the dungeon is tree-like. You only learn about rubble when you reach it, and seeing it cleared works the same way. |
| Dungeon size (changed in M5) | 10×7 grid, **38–50 rooms**, exit 6–9 hops from the entrance, 5–10 crossroads. With 25–35 rooms, bots had explored everything and were sitting at the exit by about 5:40. |
| Knowing who left | You only learn an ally escaped if you saw them go (same room). Otherwise they're a ghost at their last known spot, which is often the exit. The results screen reveals everything. |
| Stash | Extracted gold is added to `server/data/stash.json`, keyed by lower-cased player name, and shown in the lobby and results. |
| Events (v1) | 28% of normal rooms (not the entrance, the exit, or rooms next to the entrance) get an event. Events work once the room is quiet (no monsters). Altar and Vault are channels whose **progress is kept** if interrupted, and several heroes channelling stack their progress. The Altar summons guardians at 50% (one tier weaker than the dungeon). Each altar cleansed is worth +15 gold to every hero who escapes, plus −20 stress for everyone still inside. **Villagers are saved on reaching the rendezvous room** (they slip out alone), worth +25 gold to every escaper; this was changed so escorts don't camp at the exit for 5 minutes. Escorting slows you to 70% speed, monsters sometimes hit the villager (15%), and if the escort falls the villager waits in that room for anyone to pick up. The Crawlspace moves you up to 3 rooms along the real route to the exit (4 damage, Dim light). The Idol caves in the corridor you arrived by. |
| Stress (v1) | Dim +0.15/s, total darkness +0.5/s (Cat's-Eye negates Dim). The first 100 gives a random affliction and resets to 60; the next 100 is a heart attack (downed, reset to 80). Selfish: forced to vote for themselves, and dropped from the vote after 10s. Fearful: 25% to panic-flee. Paranoid: refuses others' Mend/Guard/Vigil/Bandage/Pact healing (Salts still work). Hopeless: −30% damage. |
| Lampbearer field Mend (added in M7) | Outside combat the Lampbearer can heal anyone in the same room for 8 (and cure Bleed), with a 20s cooldown (button/M). Before this, HP never recovered between fights except via Bandages, so almost every down became a death. It also gives the party a reason to stay near the Lampbearer. |
| Movement UX | Click any known room to auto-path to it over known corridors. Space turns back mid-corridor, Esc cancels the queued path. |

---

## 3. Game Design Spec (v1 numbers are starting points; tune in M8)

### 3.1 Timeline
| Time | Tier | What happens |
|---|---|---|
| 0:00 | T0 | All heroes spawn at the Entrance. Rendezvous is marked on every map. |
| 2:00 | T1 | Cleared rooms can respawn monsters. Monsters get +15% HP and damage per tier. |
| 4:00 | T2 | Wandering monster packs start roaming the corridors. |
| 6:00 | T3 | Tunnels start collapsing: 1 random corridor per 30s becomes impassable, never cutting the last path to the exit. Elites can spawn. |
| 8:00 | T4 | Light drains 1.5× faster. Respawn rate goes up. |
| 10:00 | T5 | **Exit opens.** Waves spawn at the exit every ~45s. |
| 12:00 | T6 | Waves every ~25s. "The ceiling groans" warning. |
| 13:00 | — | Collapse. Anyone left inside dies. Results screen. |

### 3.2 Exploration
- Dungeon: ~25–35 rooms, generated from a seed. Entrance and Exit are 5–7 rooms apart on the shortest path, with loops and dead ends. 3–6 crossroads.
- A corridor takes 3–8s to walk. Heroes can turn back mid-corridor.
- Entering a room reveals it, its exits, and what you can see in neighbouring rooms (unless it's dark).
- Room contents: nothing, monsters, loot pile, chest, event, altar, captive villager, or a combination.
- **Light:** each hero has a torch from 100 down to 0, draining 0.2/sec (a full torch lasts ~8 min). Torch items restore 50. Below 25 is *Dim* (more stress, can't see neighbouring rooms). At 0 it's *Dark* (heavy stress gain, monsters deal +25% damage).

### 3.3 Combat
- Starts when a hero enters a room with monsters, or when monsters enter a hero's room. Heroes who enter a room mid-fight join at the next round.
- Two ranks per side: **Front** and **Back**. Some abilities only work from or against a particular rank.
- Each round, every hero picks one of: Ability 1/2/3, Use Item, Revive (if an ally is downed), or Flee. When all heroes have locked in or 5s pass, the round resolves. Heroes who didn't pick in time **Brace** (take 30% less damage).
- Resolution order: by speed, with heroes and monsters interleaved. Show a short (~1.5s) resolution animation, then start the next round.
- **Flee:** 70% success (100% with Smoke Bomb). The hero retreats to the previous room and gains stress.
- Cooldowns are counted in rounds.

### 3.4 Classes (HP / Speed / Perk / 3 abilities)

**Warden** (tank). 45 HP, Speed 2. *Perk: Stalwart. Takes 20% less damage while in the Front rank.*
- **Shield Bash** (CD 2): 6 damage to a Front enemy, 50% chance to Stun (it skips its next action).
- **Guard** (CD 1): Choose an ally. Damage aimed at them goes to you this round.
- **Rally** (CD 4): All allies lose 10 stress and gain 4 Block.

**Cutthroat** (burst damage, utility). 30 HP, Speed 5. *Perk: Light Fingers. Opens locks and chests 3× faster, and sees loot in neighbouring rooms.*
- **Backstab** (CD 0): 8 damage to any enemy. Crits (×2) against Stunned or Marked targets.
- **Poison Blade** (CD 2): 4 damage + Bleed (3 per round for 3 rounds).
- **Smoke Bomb** (CD 5): Everyone on your side can flee this round with a 100% success chance, or else gains 50% dodge.

**Lampbearer** (healer, light). 32 HP, Speed 3. *Perk: Beacon. Allies in the same room drain light 50% slower.*
- **Mend** (CD 1): Heal an ally for 10 and cure Bleed.
- **Flare** (CD 3): 4 damage to all enemies and +15 light to everyone present. Undead are Marked.
- **Vigil** (CD 3): One ally gets −15 stress and becomes immune to stress damage for 2 rounds.

**Hexer** (control, objectives). 30 HP, Speed 4. *Perk: Ritualist. Cleanses altars 2× faster, and is immune to the Whispering Well's curse.*
- **Hex** (CD 0): 5 damage, and the target is Marked.
- **Wither** (CD 3): Target enemy deals −50% damage for 2 rounds.
- **Blood Pact** (CD 4): Lose 6 HP, deal 12 damage split across all enemies, and heal the ally with the lowest HP by 6.

### 3.5 Enemies
| Enemy | HP | Rank | Behaviour |
|---|---|---|---|
| **Ghoul** (undead) | 18 | Front | Claw: 5 damage. Bruiser. |
| **Crawler** | 10 | Front | Fast. Bite: 3 damage + Bleed. Arrives in pairs. |
| **Acolyte** (cultist) | 14 | Back | Whisper: 6 stress to one hero, or Curse: 4 damage to a back-rank hero. |
| **Bone Brute** (undead, elite, T3+) | 40 | Front | Slam: 9 damage, hits all Front heroes. Acts every other round. |

Scaling: HP and damage go up ×(1 + 0.15·tier). Group size goes up at T2 and T4.

### 3.6 Loot, Items, Gold
- **Inventory:** 4 slots per hero. Items are used out of combat or as the "Use Item" combat action.
- **Consumables:** Bandage (heal 12, cure Bleed), Torch (+50 light), Tonic (−25 stress), Firebomb (8 damage to all enemies), Smelling Salts (instant revive at 50% HP, can be used from an adjacent room as well).
- **Trinkets** (passive, also take a slot): Lucky Coin (+10% gold share), Iron Locket (+8 max HP), Cat's-Eye (Dim penalties don't apply to you), Ward Charm (−25% stress taken).
- **Assignment flow:** loot appears as a pile. Each living hero present votes on a recipient for each item, or votes "Leave it". When the vote is unanimous, the item is assigned. Until then, those heroes' exits are locked (and the UI makes the lock obvious). Combat breaking out pauses the vote. A hero who enters the room joins the vote. Bots vote for whichever hero their heuristic prefers, then switch to the human majority after ~2s. Bots never deadlock.
- **Gold:** chests, piles and events. It's split equally among heroes present when picked up. Only extracted gold counts. It's saved per player name to `server/data/stash.json` for future out-of-dungeon use (see M11).

### 3.7 Stress & Afflictions
- Sources: darkness (per second), crits taken, an ally going down (+15) or dying (+25), Acolyte Whisper, and some events.
- Relief: Rally, Vigil, Tonic, rest events, and successfully extracting.
- At 100 stress the hero gets a random affliction for the rest of the run, and stress resets to 60:
  - **Selfish:** always votes for themselves in loot votes. The vote resolves without them after 10s.
  - **Fearful:** 25% chance to auto-Flee instead of acting.
  - **Paranoid:** can't be Guarded or healed by allies.
  - **Hopeless:** −30% damage dealt.
  - A second 100 means a heart attack: the hero is immediately Downed.

### 3.8 Events & Objectives (each needs a clear choice and a time cost)
- **Altar** (objective): Cleansing takes a 15s channel (7s for Hexer) and spawns a wave partway through. Reward: every living hero gets −20 stress, plus a gold bonus at extraction.
- **Captive Villager** (objective): Guarded by monsters. Once freed, they follow one hero at 70% speed. If they reach the exit, everyone who extracts gets +gold. They can be killed in fights.
- **Glittering Idol:** Take it for a lot of gold, but the corridor you came through collapses, *or* leave it.
- **Wounded Stranger:** Spend a Bandage for a reward later (60%) or an ambush (40%), *or* walk past.
- **Whispering Well:** Drink for a random outcome (−40 stress / heal 15 / random affliction), *or* don't.
- **Locked Vault:** A 20s pick (Cutthroat 7s). Interrupting resets it. Good loot.
- **Cursed Chest:** Loot plus +20 stress to whoever opens it.
- **Shortcut Crawlspace:** Takes you straight toward the exit, but you take 6 damage and drop to Dim light.
- When several heroes are present at an event, **any present hero can make the choice**. It's first come, first served on purpose, so players end up arguing on voice.

### 3.9 Bots ("mediocre")
- **Exploration:** a utility score over unexplored rooms, visible loot, objectives and the distance to the exit. Each bot gets a random "greed" value (0.2–0.8) that sets how late it heads to the exit. Some bots will be late, which is intended.
- **Combat:** a sensible heuristic (heal the lowest HP below 50%, focus Marked targets, use AoE when there are 3+ enemies), but with **25% suboptimal picks** and a 1–3s "think" delay.
- **Votes:** see 3.6. **Rescue:** will revive in the same room. A bot only goes back for an absent ally if that ally's last known position is ≤2 rooms away and the time is before 11:30.

---

## 4. Architecture

```
/shared      Pure TS game logic + types (no I/O). Deterministic given a seed + inputs.
  rng.ts, dungeon/gen.ts, sim/world.ts (tick), sim/combat.ts, content/{classes,enemies,items,events}.ts,
  views.ts (per-player fog-filtered snapshot), bots/*.ts
/server      Node + ws. Lobby mgmt, game loop at 10 Hz, input validation, broadcasts filtered views.
  index.ts, lobby.ts, game.ts, persistence.ts, sim-cli.ts (headless bot-only runs)
/client      Vite + TS. Canvas for map/combat scenes, HTML/CSS overlay for UI.
  net.ts, scenes/{lobby,map,combat,results}.ts, ui/*, render/*, assets/
```
- **Authoritative server.** Clients send *intents* (`move(corridorId)`, `combatAction`, `vote`, `eventChoice`, `useItem`). The server sends a **per-player filtered view** every tick (or diffs if bandwidth becomes an issue), so fog is enforced on the server. No cheating by reading the socket.
- **Shared logic** is reused by the headless simulator (`npm run sim`), which is essential for balancing and automated playtesting.
- **Time** is driven by server ticks (100ms). Combat rounds are sub-state machines that run alongside the world.
- **Tooling:** npm workspaces, TypeScript strict, Vitest for unit tests, `tsx` to run the server in dev, `concurrently` for `npm run dev`. Keep dependencies minimal (no game framework unless the canvas gets painful; Phaser would be the fallback).
- **Debug hooks:** a `?debug=1` query param shows the full map, a time-skip, `spawn` commands, and a "give item" cheat (disabled in production builds).

---

## 5. Milestones

Each milestone ends with: tests passing, a **mini-playtest** (as described in that milestone), a Progress Log entry, and a git commit.

### M0. Scaffolding
- [x] `git init`, `.gitignore`, npm workspaces (`shared`, `server`, `client`), tsconfig, Vitest.
- [x] `npm run dev` starts the server and the Vite client. The client connects over WS and shows a ping/pong round trip.
- [x] Seeded RNG utility + test.
- **Done when:** the browser shows "connected" and `npm test` passes.

### M1. Dungeon & real-time movement (single player, no combat)
- [x] Room-graph generator: seeded, connectivity guaranteed, entrance–exit distance constraint, crossroads. Unit tests for invariants over 500 seeds.
- [x] World tick: hero position = room or (corridor, progress). Move/turn-back intents.
- [x] Fog-filtered view, visited rooms, adjacent visibility.
- [x] Map scene: rooms, corridors, own hero token, rendezvous marker, game clock, light bar draining.
- **Mini-playtest:** walk from entrance to exit in the browser. Does a corridor take a satisfying amount of time? Is the map legible?

### M2. Lobby, multiplayer & bot slots
- [x] Create/join a lobby by 4-letter code, set a name, pick a class (no duplicate classes in v1), ready up, host starts. Empty slots become bots.
- [x] Multiple heroes in the world. Live allies when in the same or an adjacent room, greyed **last-known ghosts** otherwise.
- [x] **Chalk marks** at crossroads showing which exits allies have taken (colour-coded by hero).
- [x] Basic bot exploration (wander + head to the exit at a time chosen by its greed value).
- [x] Reconnect: refreshing the tab resumes control of your hero (per-tab token in sessionStorage, not the name).
- **Mini-playtest:** open 2–3 browser tabs as different players and confirm fog, ghosts and chalk marks behave correctly for each.

### M3. Combat core
- [x] Encounter state machine: start, join mid-fight, 5s rounds with early resolve, speed order, Brace on timeout, Flee.
- [x] All 4 classes × 3 abilities, cooldowns, statuses (Stun, Bleed, Mark, Block, Guard, Weakened).
- [x] Ghoul, Crawler and Acolyte (the Bone Brute is implemented too; M5 only has to start spawning it).
- [x] Downed → bleed-out → death, Revive action (in combat, plus a 3s channel out of combat). Items dropped on death moves to M4, since items don't exist yet.
- [x] Combat scene: two ranks, sprites/placeholders, HP bars, a cooldown display on the ability buttons, a visible 5s timer ring, target selection, and a resolution animation with a combat log.
- [x] Bot combat AI (mediocre).
- **Mini-playtest:** fight 5 encounters with each class. Can you decide in 5 seconds? Does each class feel distinct?

### M4. Loot, items & gold
- [x] Loot piles, gold split among those present (chests come with the M6 events, as Locked Vault and Cursed Chest).
- [x] Item voting UI plus room-exit lock, combat pausing the vote, late joiners, bot voting.
- [x] Inventory (4 slots), using items in and out of combat, all consumables + trinkets. The dead drop items and gold where they fall.
- **Mini-playtest:** with 2 tabs + bots, deliberately disagree on an item. Is the lock clear? Does the pressure feel fun, not annoying?

### M5. Escalation & the climax
- [x] Tier system on the 2:00 cadence: scaling, respawns, wandering packs, Bone Brute, corridor collapses (path to the exit preserved), faster light drain.
- [x] Exit opens at 10:00, individual Extract action, exit waves, collapse at 13:00.
- [x] Results screen: who extracted, died or was left behind, gold, a timeline of key moments ("Mara went down in the Ossuary at 9:42").
- [x] Tier-change announcements (audio cue placeholder + banner).
- **Mini-playtest = FIRST PLAYABLE.** Play a full 13-minute run with 3 bots. Note the moment-to-moment feel of every 2-minute block.

### M6. Stress, events & objectives
- [x] Stress sources and relief, affliction roll at 100, heart attack, all 4 afflictions (including the Selfish/vote interaction).
- [x] Event framework (room event, choice UI, first-come resolution) + all events in 3.8.
- [x] Altar channel + interruption, Villager follower + escort + bonus.
- [x] Bots handle events (random-ish but sensible) and objectives (only if they're nearby).

### M7. Bot polish
- [x] Bot rescue logic, greed variance, objective pursuit, "think" delays, 25% suboptimality.
- [x] Bots should be noticeably worse than a focused human but not useless. Check this with the sim in M8. (Still too weak in the late game; that's M8.)

### M8. Headless simulation & balance pass
- [ ] `npm run sim -- --games 300 --seed X` runs 4-bot games at accelerated time and outputs JSON/CSV metrics.
- [ ] Metrics: extraction rate per hero, death time distribution, downs per tier, average arrival time at the exit, gold per extracted hero, fights per run, average rounds per fight, items left unassigned, stress afflictions per run, events taken.
- [ ] **Target bands for all-bot games:** about 40–65% of heroes extract. ≥30% of runs have at least one hero arriving at the exit after 10:30 (the drama window). Median fight lasts 3–6 rounds. ≤10% of deaths happen before 4:00.
- [ ] Tune numbers in `shared/content` until the targets are hit. Record the before/after table in the Progress Log.

### M9. Pixel art & juice
- [ ] **Ask the user** about downloading a CC0 pack (or have them supply one). Wire up the sprite atlas loader.
- [ ] Map tiles/room icons, hero and enemy sprites, hit flashes, damage numbers, screen shake on crits, light vignette tied to torch level, a pulsing exit beacon.
- [ ] Optional: simple sound effects (ask the user before adding audio assets).

### M10. Structured playtest (the main verification step)
Run all of the following, then write `PLAYTEST.md` with findings, ranked issues and fixes made.
1. **Automated:** `npm run sim` stays inside the M8 target bands after all changes. All unit tests pass.
2. **Solo browser playtest (Claude, using the built-in browser):** play at least 2 full runs with 3 bots, as different classes. Keep a timestamped log and check it against the **Intended Experience Checklist** below. Take screenshots of the key moments.
3. **Multi-client playtest:** run 4 tabs as 4 humans. Confirm fog isolation (tab A never receives tab B's hidden info; inspect the WS payloads), loot vote edge cases, a revive across tabs, disconnect/reconnect mid-combat, and all extraction-timing edge cases (extract during a wave, die while the exit is open, collapse while in combat).
4. **User playtest:** ask the user to play with friends. Give them a short feedback prompt (the checklist questions). Turn their answers into tasks.

**Intended Experience Checklist** (each must be a clear "yes" or get a task):
- [ ] In the first 2 minutes the group splits up voluntarily because the crossroads offer meaningfully different temptations.
- [ ] Each 2-minute tier change is *noticeable* without reading the banner.
- [ ] Combat decisions are usually made in under 5s, and the timer feels tense rather than unfair.
- [ ] The 4 classes play differently, and each has a moment where it's clearly the hero.
- [ ] At least once per run, an item vote causes a real (if brief) negotiation.
- [ ] Between 9:30 and 11:30 a player at the exit is genuinely uncertain about a missing ally. The ghost/last-known information is ambiguous enough to make that a hard choice.
- [ ] Going back for a rescue is *possible but costly*. It sometimes works and sometimes doesn't.
- [ ] Greed for "one more room" has caused at least one late arrival or death.
- [ ] Light and stress create pressure without becoming the main thing you manage.
- [ ] Bots are helpful-but-flawed. Nobody feels the bots won or lost the game for them.
- [ ] The results screen tells a story people want to talk about.

### M11 (stretch). Out-of-dungeon gold
- [ ] Ask the user what gold should buy. Candidate: a camp screen between runs where you spend stashed gold on starting consumables, trinkets, or a class unlock. Persistence is keyed by player name.

### Later / parking lot
Deploying to a public host, more classes and enemies, multiple floors, in-game pings, controller support, a real art pass, music.

---

## 6. Open questions to raise when relevant
- Is the game title "So They Can Prosper" (from the folder name)? Ask at M9.
- What should gold buy (M11)?
- Sprite pack choice and download permission (M9).
- Should class duplicates be allowed? Disallowed in v1 so the 4 classes stay distinct.

---

## 7. Progress Log
_(Newest first. Each entry: date · milestone · what changed · what's next · known bugs.)_

- 2026-10-08 · **M7 done.** Bots:
  - **Threat-aware routing:** `planRoutes` is a Dijkstra where entering a room with known monsters costs 8 + 40×hurt per monster. Bots walk the route hop by hop and skip the think pause while the next room is known to be clear.
  - **Rescue:** a bot goes to an ally it saw go down in the last 25s, if they're within about 20s of walking and it's not nearly collapse time.
  - **Retreat:** a bot flees at <35% HP when the enemies have more HP than it does and there's no healer or downed ally.
  - Lampbearer bots field-mend the most hurt person in the room below 75% HP.

  Also: Lampbearer field Mend for players (button/M), `bots/bots.test.ts` (routing avoids threat, rescue, retreat), the sim reports death causes, and long simulation tests now have 30s timeouts. 77 tests.
  - Sim (80 games): escape 27% → **31%**, full wipes 35% → **26%**, fights 4.5–4.6 rounds. Deaths are mostly "bled out" away from the exit in T3–T6. Rescues are still rare: about 0.8 revives against 3.4 downs per game, because allies are usually out of sight. Late arrivals are ~9%.
  - **For M8 (balance), in priority order:** (1) late-game monster pressure (cap 8+3×tier, respawn 45/30s, wanderers every 60s, T3+ Brutes): try a lower capPerTier or slower late respawns first. (2) Late arrivals: the climax needs about 30% of runs to have someone arrive after 10:30; consider a later bot return window once survival improves. (3) Gold economy: ~120 gold per escaped hero, mostly from objectives.
  - Next: M8.
- 2026-10-08 · **M6 done.** `content/events.ts` (afflictions, 8 event types, seeding, channel times), `sim/events.ts` (seeding, choices, channels, villagers, darkness stress and breaking), `bots/eventer.ts` (each bot decides once per room; risky events only above 60% HP; escorts go home and then resume their plan). Afflictions are wired into combat and loot. View: `event`, `leading`, `objectives`, per-room event icons, ally afflictions. Client: `client/src/events.ts` panel; HUD affliction badge, escort line and objectives line; map glyphs (⛧☺✧¿◯▣☐↘). Loot and event panels moved to the bottom centre and toasts to the top centre, so they no longer cover the map. New dev command `debugEvent`. Fixed: a fight whose monsters disappear mid-round now ends at once. `npm run sim -- --events 0` compares runs without events. 74 tests.
  - Sim (80 games): **escape 24–27%** (33% with events off), wipes 35–40%, 0.3 afflictions and ~0 heart attacks per game, 6.8 events used, 0.6 altars, 0.9 villagers saved, 123 gold per escaped hero (objective bonuses are big). An ablation showed the Altar and Crawlspace as the costliest for bots, so I added the bot HP gates and weaker guardians. Bot return window moved to 6:30–10:30. **Bots are now clearly too weak for the late game.** M7/M8 should fix rescues, avoidance and late-game pacing before any number tuning.
  - Mini-playtest: Hexer altar cleanse took 7s, guardians came at 50%, the fight was won at 4/36 HP, and progress resumed from 50% to completion (objective +1, −20 stress). Villager freed, the HUD escort line showed. One bug found and fixed: the bottom progress strip said "Reviving… 0.0s" during an event channel.
  - Next: M7 (bot polish: rescue logic, avoiding danger late, think delays).
- 2026-10-08 · **M5 done: FIRST PLAYABLE.** `sim/escalation.ts`:
  - Tier changes are written to the chronicle.
  - Respawns run every 45s, or 30s from T4.
  - Wandering packs start at T2. They travel corridors at ×1.5 hero time, burst into rooms ("Monsters burst in!"), and drift toward the exit late in the run.
  - Brute groups appear from T3/T4. Rubble collapses start at T3, every 45s, and can be dug through.
  - Light drains ×1.5 from T4.
  - Waves spawn next to the exit (a moment's warning) every 45s, then every 25s at T6, and hold it.
  - The monster cap is 8 + 3×tier.

  Also: extraction (intent, plus Flee at the open exit), collapse burial at 13:00, phases `collapsed`/`wiped`/`ended`, `world.chronicle`, `world.stats`, `hero.arrivedAt`/`fate`. Client: Escape button (E), Dig button (D) with channel progress, rubble ✕ on the map, the exit pulses green once open, tier banners with descriptions plus a generated square-wave cue (`client/src/sound.ts`, no assets), an "escaped, the others are still inside" banner, and the results screen (`client/src/results.ts`: fates table, "What really happened" chronicle, stash, map peek). Server: `persistence.ts` (Stash), and gold is banked once per run. 60 tests.
  - **Bugs found by playtesting:** (1) a walk command that found no route still cancelled your dig or revive; `goto` now returns success and only a real move interrupts. (2) A hero thrown out of a collapsing tunnel didn't learn it had collapsed. (3) "the The Rendezvous"; added `theRoom()`.
  - **Balance (sim, 60–80 games):** Hero HP is +6 each (Warden 50, Cutthroat 36, Lampbearer 38, Hexer 36). Ability numbers are now data (`power`), and hero damage is up about 25% (Bash 8, Backstab 10, Poison 5, Flare 5, Hex 7, Pact 15, Rally Block 5). Room monster chance is 0.3. Tier scaling is +10% per tier. Bandage loot weight is 7. Bots avoid known monsters more when hurt, head home at <30% HP, wait 0–75s at the exit and dig when walled in. Latest: **35–40% of bot heroes escape** (target 40–65%), wipes 18–23%, deaths before 4:00 under 10% ✓, fights 5.0 rounds ✓, **late arrivals (after 10:30) only 8–14% of runs** (target 30%) ✗, ~6.7 collapses/game. M8 should look at late arrivals first: bots that would be late tend to die on the way.
  - **First-playable sample** (autopilot plus manual takeover, fast-forwarding between 2-minute blocks): tier banners read well. At 9:43 the hero was Dim, walled in by rubble with "Dig toward …" and "exit opens in 0:16", which is a strong moment. Two bots died in the same room (the Silent Cistern), and their dropped loot lured the next hero into the same deathtrap. My Warden went down at 9:36, 12/50 HP, against 2 Ghouls and an Acolyte while Ilse (bot) waited at the exit. Ilse left at 10:00 without waiting. The results chronicle told the whole story. **This is the intended experience emerging.** Gaps: bots never go back for anyone (M7), and solo fights in late tiers are very lethal.
  - Playtest helper: `client/public/autopilot.js`. Run `await import('/autopilot.js'); startAutopilot({homeAt: 540, waitUntil: 690})` from the console of a dev build, then check `__ap.log` and stop it with `__ap.on = false`. It needs `window.__net`, which only exists in dev, so it's inert in production. Known limitation: it doesn't check cooldowns.
  - Next: M6 (stress afflictions, events and objectives).
- 2026-10-08 · **M4 done.** `content/items.ts` (5 consumables, 4 trinkets, loot table), `sim/loot.ts` (piles, gold split, votes, lock, claim/drop, item effects), `bots/looter.ts` (votes + field item use), items in the bot fighter, combat `item` action (keys 4–7), `client/src/loot.ts` (vote panel, inventory, gold, notification toasts via `hero.messages`), ✦ loot markers on the map (the Cutthroat also sees loot in neighbouring rooms). New dev command `debugLoot`. **New tool:** `npm run sim -- --games N --seed S` (headless all-bot games; the start of M8). 50 tests.
  - **Early balance pass (sim-driven):** before it, 64% of bot heroes died and 53% of games were full wipes, almost all in T0–T2 with no escalation yet. Monster damage moved into `ENEMIES[].dmg`. Ghoul is now 14 HP / 4 dmg, Crawler 8 HP / 2 dmg + Bleed 1×3, Acolyte 11 HP / 3 dmg, Brute 34 HP / 7 dmg. Now 20–25% die and wipes are ~0–3%, but nearly all deaths are still in T0–T2 and survivors pocket ~90% of the gold. **The tension is missing until M5's escalation.** Re-tune in M8.
  - Mini-playtest (2 tabs + bots): gold split 11/10. Disagreeing on the Iron Locket kept both players locked, and the panel says "You disagree" plus who's still pending. A bot that wandered in joined the vote and then deferred to the humans in under 1s. Locket +8 max HP worked, and Bandage/Firebomb worked in combat via key 4.
  - Dev gotcha: editing anything in `shared/` restarts the tsx-watch server, which wipes in-memory lobbies. Set up a test lobby after you finish editing.
  - Next: M5 (escalation, extraction, results screen). This is the FIRST PLAYABLE milestone.
- 2026-10-08 · **M3 done.** `shared/src/sim/combat.ts` (encounters, resolution, statuses, downed/bleed-out/death, flee, out-of-combat revive channel), content files for abilities and enemies, `bots/fighter.ts` (heuristic + 25% blunders, 1–3s think delay), encounter/threat/ally-HP in views, DOM combat panel (`client/src/combat.ts`) with a replay of each round's events, floating numbers, HP bars that move in step with the replay, targeting mode, hotkeys 1/2/3/R/F/B. HUD gained HP/stress bars, downed/dead banners, a Revive button, ☠N threat markers on rooms and X marks on downed/dead allies. 37 tests.
  - Mini-playtest: the UI flow works end to end (key → target highlight → click → locked in → replay). Cooldowns behave. In an unplanned moment, three bots wandered into my fight while I was down, revived me, mended, guarded, and won. That's exactly the intended rescue drama.
  - **Balance flags for M8:** all-bot games currently lose about 50% of heroes even without escalation (no healing items yet). Solo heroes are fragile: two Crawlers' stacked Bleed killed a bracing Hexer in ~5 rounds. Revisit once items (M4) exist.
  - **Testing note:** the browser pane is usually hidden, which pauses `requestAnimationFrame`. `main.ts` now also renders every 250ms while `document.hidden`. Screenshots take 2–5s while rounds last 5s, so drive combat from a single JS call (dispatch `keydown` with `code: 'Digit1'`, then `pointerdown` on `#combat [data-unit=…]`) and use screenshots only for visuals.
  - Known/minor: ghost labels still stack at shared spots. HUD HP updates before the combat replay finishes.
  - Next: M4 (loot, items, gold, item voting).
- 2026-10-08 · **M2 done.** Lobbies (4-letter codes, `?lobby=CODE` links, class picker with no duplicates, ready/start, host handover), `Game` wrapper in shared (world + bots, reused by the future headless sim), bot explorer brain (fog-fair: it plans only from its own PlayerView, with a greed-based return time from 7:00 to 11:00 and a preference for exits not already chalked), sightings/ghosts, chalk marks, roster panel ("last seen 1:41 ago · Collapsed Pit"), collapse → host "Return to lobby". 27 tests, including server lobby tests with fake sockets (flow, token secrecy, reconnect, kick duplicate, full lobby, leave → bot).
  - Mini-playtest (2 tabs + 2 bots): lobby flow works end to end. Bots split up immediately. Ghosts and chalk read correctly for each player. Reload resumes the same hero. Fast-forwarding to 13:00 showed the collapse; returning to the lobby works.
  - Perf: bots only build a view when idle in a room. A 4-bot 13-minute game simulates in ~0.1s, which is good for M8.
  - Known/minor: ghost labels can still stack when 2+ ghosts share a spot. Lobby buttons shift when Ready↔Not ready changes width. Bots with nothing left to explore just wait at the exit (fine until M5 adds extraction).
  - Next: M3 (combat core).
- 2026-10-08 · **M0 + M1 done.** Monorepo (shared/server/client), WS server at 10 Hz with a fog-filtered `buildView`, Vite canvas client with a map, HUD (clock, tier, exit countdown, light bar), click-to-path and turn-back. The generator is tested over 500 seeds; there are 17 unit tests. For now the server runs a single shared dev world with one hero per connection; this gets replaced by lobbies in M2.
  - Mini-playtest: walking works and reads clearly. Fog/glimpse/crossroads markers render. An exploring walk reached the rendezvous at ~1:00 having explored 10 rooms (light 88). **Watch in M8:** the direct entrance→exit route is ~45–60s, so the "late to rendezvous" tension must come from content (fights, loot, events) and from the exit being far from the loot. If it doesn't, lengthen corridors or raise EXIT_DISTANCE.
  - Playtest tooling: in dev builds `window.__net` exposes the client connection (`__net.cur` = latest view, `__net.intent(...)`). Use it from the browser tool to script walks. Long-running scripts must be fire-and-forget (store results on `window`), because a hidden browser pane throttles timers.
  - Visual notes for M9: the map uses a fixed full-dungeon frame, so small dungeons leave empty space. Rooms are ~29px at 1280×720. Consider fitting the frame to explored rooms + exit.
  - Next: M2 (lobby, multiplayer, bots, chalk marks, reconnect).
- 2026-10-08 · Planning · Created PLAN.md after a design Q&A with the user. Next: M0.
