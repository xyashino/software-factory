---
scope: factory
summary: Factory stops a Cell whose worktree is deleted
why: Deleted worktree leaves a Cell writing into nothing and holds the order. Factory sees it within one check, kills first, then HQ restarts the order from scratch.
date: 2026-11-22
tags: [factory, cell, worktree, daemon, relay, reliability]
---

- Daemon checks every `HEARTBEAT_INTERVAL_MS` (10 s) that each `running` Cell with a known `orderId` still has its worktree dir. Idle Cells are never checked.
- Worktree path: one shared helper `worktreeRelOf(orderId)` = `.worktrees/<slug>`. Cell and daemon both use it.
- Only a worktree seen present for that order counts as lost. Guards the window where a fresh order reports `running` before `git worktree add`.
- Missing: kill Cell and wait for exit. Then append `worktree deleted, cell stopped` to the Cell log. Log file is kept.
- Then `worktree_missing` to HQ as that Cell: `missingStepId` = job step, `missingFiles` = `['.worktrees/<slug>']`, `epoch` = job epoch, `commandId` = same hash the Cell uses. Repeat sends reuse the id.
- Relay tracks each Cell's job from `hello`, `claims` and transition replies. Report works after the process is dead.
- HQ unreachable or rejected: no retry, Cell stays killed; lease reaper requeues the job.
- Then `gone` for the Cell. Scale respawns the count fresh.
- Worktree cleanup for delivered or cancelled orders: not in scope.
