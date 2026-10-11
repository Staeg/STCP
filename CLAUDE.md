# CLAUDE.md

## Workflow
- PLAN.md is the source of truth. At the start of every session, read all of it, especially **Decisions** and the **Progress Log**.
- Work on the first unchecked milestone. Skip ahead only when that milestone is explicitly blocked.
- Ask the user about real design ambiguities; they like being asked and often give custom answers. Decide minor things yourself and record them in PLAN.md's **Decisions** table.
- Once a feature is done (tests pass, PLAN.md updated), commit it right away without asking. The message says what changed and why.
- Commit messages feed the in-game patch notes. Before the Co-Authored-By line, add one line per player-facing change, in player terms, judged individually: `Major:` for new mechanics, content or rule changes players will notice; `Minor:` for number tweaks, renames, UI polish and bug fixes. Add one `Headline:` line, a short player-facing hook for the commit's biggest change (it only shows if the commit has a `Major:` line). A commit that doesn't change play (tests, tooling, refactors) gets `Patch: none` instead. Example:
  ```
  Headline: Undertakers raise the dead
  Major: Undertakers Raise fallen allies, who fight beside them and can walk out with them
  Minor: Bone Brute renamed to Bone Giant
  ```
- Code names and player-facing names must match. When you rename or change one (identifiers, types, ids, comments on one side; on-screen text, tooltips, docs and PLAN.md on the other), change the other to match in the same commit.
- Before ending a session, tick off finished milestones and add a Progress Log entry (date, what changed, what's next, known bugs). Then commit.
- Once a task is done, stop every dev server your session started: `preview_stop` each server from `preview_list`, and kill any leftover game-server (tsx `src/index.ts`, ports 30xx) or Vite (51xx–52xx) processes you spawned.

## Parallel sessions
Other Claude sessions often edit this checkout at the same time and touch the same files.
- Before editing shared files, check `git status` and ListAgents. If a peer is working in the same files, wait until it goes idle.
- Make small anchored edits. Never rewrite a whole file from content that may be stale.
- Stage only the files you changed (`git add <paths>`, never `git add -A`). If a file mixes your edits with a peer's uncommitted edits, say so in the commit message or wait for the peer.
- Kill only dev servers your own session started.

## Design constraints
- Global or wide-ranging effects (anything heard or felt across the dungeon, or hitting every hero or monster at once) get a sound effect: pass a `SoundCue` to `notify` and add the cue to `client/src/sound.ts`.
- Class designs must not add time-consuming mechanisms such as a second controlled token or haggling/trading flows. Prefer passives and one-click actions.
- Class base Speed stays within 3–7s.
