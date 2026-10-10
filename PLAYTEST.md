# Playtest Report: M10

_Date: 2026-10-08 · Build: after M9 (commit efdde6a) · Tester: Claude, using the in-app browser, a scripted autopilot, the network harness and the simulator._

## Method

1. **Automated:** unit tests, plus `npm run sim` against the M8 target bands.
2. **Real-time browser runs:** full 13-minute runs at real speed against 3 bots. My hero is driven by `client/public/autopilot.js`, a "reasonable human" script that runs on each server snapshot so it keeps working in a background tab. I sampled about every 45s (state + log) and took screenshots at key moments.
3. **Multi-client network harness** (`tools/playtest-harness.ts`): 4 real WebSocket clients play a full real-time game as "humans", driven by the bot brains. **Every snapshot each client receives** is checked for fog/identity leaks, and the run includes scripted disconnects (one plain, one mid-fight).
4. **User playtest:** pending (see the end of this report).

## Run 1: Warden + 3 bots (real time)

| Time | What happened |
|---|---|
| 0:12–0:32 | Took a Tonic; cracked a **Locked Vault** (+33 gold, Torch, Bandage). |
| 0:36–1:56 | Two fights vs Acolyte + Crawlers. **Round 10** of a solo fight. HP 50 → 11, **stress 78** by 1:50 (Acolyte Whispers over long fights). Survived on 3 Bandages. |
| 2:00–6:00 | Cautious exploration (autopilot avoids known monsters when hurt): 31 rooms, 93 gold, drank from a well (+15 HP). Light Dim by about 6:30. |
| 6:00–6:39 | Another long Acolyte fight (HP 14 → 9), then a **Bone Giant** at 7 HP. **Downed at 6:39** with stress 94, bleeding out with no ally in sight. Ilse (bot) had become **Selfish**. |

**Findings**
- 🔴 **The Warden and Lampbearer can't fight alone.** Neither has an attack usable every round (Warden: Bash every 3rd round, Guard needs an ally, Rally deals no damage; Lampbearer: only Flare deals damage, every 4th round). Solo fights run 8–10 rounds, which bleeds HP *and* stress. In a game built around splitting up, every class needs a basic attack.
- 🟠 **Stress spikes in long fights with Acolytes** (78 by 1:50). Mostly a consequence of the fight length above; re-measure after fixing it.
- 🟡 **Toast replay:** in a backgrounded tab, catching up shows a burst of stale toasts ("bandages themself" ×3). Only show messages from the last few seconds.
- ✅ The UI held up: inventory, event panel (vault, well), tier banners, Dim vignette, **YOU ARE DOWN** countdown, and the Selfish badge on the roster.

**How it ended (from the results chronicle).** Mara bled out at 7:09. **Dagny** and **Jory** (bots) escaped at 10:01, the moment the exit opened, without waiting. **Ilse** (bot) is the story of the run: she freed a villager (1:32) and delivered them (4:20), became Selfish at the well (4:06), took the **Glittering Idol** at 6:04 (its trap caved in a tunnel), dug through rubble at 9:19 and 9:40… and at 9:45 **the tunnel she had just dug out collapsed again**. She was buried in the tunnel to the Rendezvous at 13:00.

- ✅ **This is the pitch working:** a greedy hero who almost made it, a team that didn't wait, and a hero who died alone. The chronicle reads like a story.
- 🟠 **Re-collapse right after digging feels unfair.** Don't collapse a corridor within ~60s of it being cleared.
- 🟡 Bots that are already at the exit leave at exactly 10:00 surprisingly often. Fine for "mediocre", but a short minimum wait (5–15s) would read better.

## Multi-client network harness

`npx tsx tools/playtest-harness.ts --players 4 [--speed 10]` runs 4 real WebSocket clients as "humans" (driven by the bot brains), with scripted chaos: one disconnect/reconnect at about 2:00 and one reconnect mid-fight. Every received snapshot is checked:
- explored/seen flags match the hero's own knowledge
- unknown rooms leak no name or kind
- every known corridor touches an explored room
- an encounter view only appears for participants
- a **live** ally is genuinely in sight (same room or corridor, a corridor touching your room, or an adjacent room while not Dim)
- no global state in the view
- **no other player's secret token anywhere in the payload**

It also flags any hero idle for 45s outside a fight, channel or the exit.

| Run | Speed | Snapshots checked | Result |
|---|---|---|---|
| 1 | real time (13 min) | 31,177 | ✅ 0 leaks. Mid-fight reconnect → back in the same fight. Plain reconnect → same hero. |
| 2 | ×10 | 2,584 | ✅ 0 leaks, nobody stuck |
| 3 (3 humans + 1 bot) | ×10 | 2,335 | ✅ 0 leaks |
| 4 | ×10 | 3,121 | ❌ **23 "live ally out of sight" flags, and 3 heroes idle for 9 minutes** (see below) |
| 5, 6 (after the fix) | ×10 | 2,741 + 3,114 | ✅ 0 leaks, nobody stuck |

**🔴 Bug found by the harness (fixed):** a hero caught in a cave-in is thrown to the nearer end of the tunnel, which can be the room they were walking *towards*. They landed there **without exploring it**: they didn't know its exits, so they couldn't plan a route, and the room's neighbours weren't on their map, even though they could still "see" allies there (the flagged leak). The bot brain froze, and three heroes sat in two rooms until the collapse buried them. **Fix:** being thrown out of a cave-in now explores the landing room (regression test added). Bots with no frontier and no route also dig out through known rubble instead of idling.

## Fixes made from Run 1 + harness

1. **Every class can fight alone:** Shield Bash now has no cooldown (7 dmg, 35% Stun; was cooldown 2, 8 dmg, 50%). Flare has a 1-round cooldown (5 dmg to all, +10 light; was cooldown 3, +15).
2. **No re-collapse within 60s** of a tunnel being dug out (`world.clearedAt`).
3. **Bots wait at least 8s at the exit** before leaving (they used to bolt at 10:00).
4. **Stale toasts are skipped** (only messages from the last 4s pop up).
5. **Cave-in landing room is explored** (above).
6. Dev: `debugSpeed` lets the harness fast-forward a lobby (×1–×50).

Sim after fixes 1–4 (100 fresh seeds): **escape 51%**, wipes 5%, **drama at 10:00 50%** ✓, late arrivals 23%, early deaths 5%, **rounds/fight 3.6** (was 4.6), afflictions 0.6/game.

## Run 2: Lampbearer + 3 bots (real time, after the class fixes)

(A first attempt as a Hexer went down at 0:45. The cause was **click-to-walk routing straight through a room with known monsters** while escorting a villager. **Fixed:** auto-paths now detour around rooms with known monsters (15s of "virtual walking" per monster), but never refuse the room you actually clicked. Test added. The run was restarted as a Lampbearer.)

| Time | What happened |
|---|---|
| 0:20–0:40 | 6-round fight vs Ghoul + Acolyte, alternating Flare/Mend; won at 19/38. **Field Mend** back to 35/38 by 1:27. Stress 24 → 4. |
| 2:28–3:01 | Flare cleared two Crawlers in 3 rounds. Light stayed at 90–100 thanks to Flares. Cracked a vault. |
| 4:51–5:44 | Ghoul ×2 + Acolyte: dropped to **10/38**, then sustained by alternating Mend and Flare to win at 31/38. **The healer can now hold its own alone.** |
| 6:06–9:32 | **Walled in by rubble** (3 rooms reachable). Dug out at 9:32. |
| 10:00 | Exit opens. **Corvin and Hob (bots) escape immediately; Aldric at 10:19.** Mara hasn't seen any of them for 10 minutes. |
| 10:18–11:18 | Dug through a **second** rubble pile, fought through, then **walled in a third time**, with no known route left. |
| 13:00 | **Buried** on the way to the last rubble pile. 10 tunnels collapsed this run. |

**Findings**
- ✅ Lampbearer: Flare every other round + field Mend gives a real solo loop, and keeps the light up (that's its identity).
- 🔴 **Collapses happen too often for a mostly tree-shaped map:** 10 per run, and most cut something off. Walled in 3× in one run reads as a chore, not drama. **Fixed:** collapses every 60s (was 45s), and 75% of the time they pick a tunnel that leaves another way round (`ESCALATION.collapsePreferLoops`). Being cut off is still possible, but now it's an event.
- 🟠 The bots escaped the instant the exit opened again. None of them had seen Mara, so from their view she might be dead. That's consistent with their fog-fair knowledge, but it reads as cold.
- 🟡 The dev autopilot can't walk to distant rubble (a human would follow the red ✕ marks), so I took over by hand. That's a tooling gap, not a game bug.

## Final balance (120 fresh seeds, after all fixes)

| Metric | Target | Result |
|---|---|---|
| Bot heroes escaping | 40–65% | **57%** ✓ |
| Drama at 10:00 (someone waiting, someone still out) | ≥50% | **58%** ✓ |
| Deaths before 4:00 | ≤10% | **7%** ✓ |
| Rounds per fight | 3–6 | **3.6** ✓ |
| Someone arrives after 10:30 | ≥30% | 16% ✗ (secondary; bots that would be late usually die) |
| Full wipes | — | 6% |
| Afflictions / heart attacks per game | — | 0.4 / 0.0 |
| Gold per escaped hero | — | 144 |

## Intended Experience Checklist

| # | Item | Verdict |
|---|---|---|
| 1 | The group splits up in the first 2 minutes because the crossroads tempt differently | ✅ for bots (chalk-aware spreading). **Needs humans.** |
| 2 | Each 2-minute tier change is noticeable without the banner | 🟡 Banner, flash and sound are clear. Mechanically, T1–T2 changes are subtle until packs burst in; T3 rubble and T5 waves are unmistakable. |
| 3 | Combat decisions usually made in <5s; the timer feels tense, not unfair | ✅ hotkeys 1–7/R/F/B, auto-target with a single target, 3.6 rounds per fight. **Feel needs humans.** |
| 4 | The 4 classes play differently, and each has a hero moment | ✅ after the fixes: Warden tanks and bashes every round, Lampbearer sustains and lights, Hexer runs altars and AoE, Cutthroat cracks vaults and crits. |
| 5 | An item vote causes a real (silent) standoff at least once per run | ✅ mechanism verified with 2 tabs (M4). **Needs humans.** |
| 6 | 9:30–11:30: genuine uncertainty about a missing ally | ✅ in both runs allies had been ghosts for 5–10 minutes at the exit; drama metric 58%. |
| 7 | Going back for a rescue is possible but costly | 🟡 Possible (revive, salts from the next room, rescue bots), but rare: 0.5 revives per game in bot games. **Needs humans.** |
| 8 | Greed has caused at least one late arrival or death | ✅ Run 1: Ilse (idol, rubble, buried). Run 2: Mara buried. |
| 9 | Light and stress pressure without dominating | ✅ after shorter fights: 0.4 afflictions per game. Run 1 (before the fix) showed stress dominating in 10-round fights. |
| 10 | Bots helpful-but-flawed | 🟡 Flawed, yes. Helpful only when they happen to be near; they rarely come back for anyone. |
| 11 | The results screen tells a story people want to talk about | ✅ both runs read as stories (see above). |

## Issues, ranked

1. **(Blocker for sign-off) Human playtest.** Items 1, 3, 5 and 7 need real players. See the prompt below.
2. **(Medium) Rescues are rare.** Bots only rescue what they happen to see. ~~Option: a "Help!" button~~ (dropped 2026-10-09: the game now has no communication between players, so any fix must come from visible actions, e.g. making a down more noticeable to those nearby).
3. **(Medium) Bots leave at 10:00 without waiting** when they haven't seen you. Option: bots wait longer if they *saw* an ally alive recently.
4. **(Low) Late arrivals (16%)** are below the secondary target.
5. **(Low) Tier 1–2 changes are subtle.** Option: a distant roar or sound cue when a pack spawns nearby.

## User playtest: please try this with friends

Run `npm run dev` (or `npm start` and share `http://<your-LAN-IP>:3001` or a tunnel URL). Play 2–3 runs with 2–4 people **without talking** (no voice, no chat, ideally not in the same room). Afterwards, a sentence or two on each:

1. Did you split up early? Why, or why not?
2. Could you decide your combat moves in 5 seconds? Too tense, or not tense enough?
3. Did a loot vote ever turn into a standoff? Could you tell what the others wanted from their votes alone?
3b. Could you tell what your allies were about to do without being told? When couldn't you?
4. Around 10:00, were you unsure whether to wait, leave or go back? Did anyone go back?
5. Which class was most and least fun?
6. What was the best story from the results screen?
7. Anything confusing on the screen?
