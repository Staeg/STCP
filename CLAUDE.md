# CLAUDE.md

## Workflow
- PLAN.md is the source of truth. At the start of every session, read all of it, especially **Decisions** and the **Progress Log**.
- Work on the first unchecked milestone. Skip ahead only when that milestone is explicitly blocked.
- Ask the user about real design ambiguities; they like being asked and often give custom answers. Decide minor things yourself and record them in PLAN.md's **Decisions** table.
- Once a feature is done (tests pass, PLAN.md updated), commit it right away without asking. The message says what changed and why.
- Before ending a session, tick off finished milestones and add a Progress Log entry (date, what changed, what's next, known bugs). Then commit.
- Once a task is done, stop every dev server your session started: `preview_stop` each server from `preview_list`, and kill any leftover game-server (tsx `src/index.ts`, ports 30xx) or Vite (51xx–52xx) processes you spawned.

## Parallel sessions
Other Claude sessions often edit this checkout at the same time and touch the same files.
- Before editing shared files, check `git status` and ListAgents. If a peer is working in the same files, wait until it goes idle.
- Make small anchored edits. Never rewrite a whole file from content that may be stale.
- Stage only the files you changed (`git add <paths>`, never `git add -A`). If a file mixes your edits with a peer's uncommitted edits, say so in the commit message or wait for the peer.
- Kill only dev servers your own session started.

## Design constraints
- Class designs must not add time-consuming mechanisms such as a second controlled token or haggling/trading flows. Prefer passives and one-click actions.
- Class base Speed stays within 3–7s.
