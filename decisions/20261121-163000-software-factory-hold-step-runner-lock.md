---
scope: software-factory/cell
summary: Step dir lock refuses a second runner while the first is alive
why: Crash, hard kill or restart can leave an agent alive while a new Cell run reuses the worktree step
date: 2026-11-21
tags: [cell, runner, lock]
---

- `runner.json` in the step dir gains `runId`, `pid`, `pidStartedAt`, `pane`, `startedAt` next to `interactive`/`reason`.
- `RunHandle.pid`: headless = child pid; herdr = launcher pid, polled from its pid file for up to 10s after the pane runs it.
- Before start, `runOperator` reads the lock. Live when pid runs and `ps -o lstart=` matches `pidStartedAt`; a lock with no pid is always live.
- Live lock: job fails `runner still holds this step: runner=... pid=... pane=...`, no runner starts.
- Stale lock (dead pid or reused pid start time): taken over, logged as `lock takeover stale`.
- Lock written after start; released (`runId` etc. dropped) once exit is seen or abort confirmed. Unconfirmed abort or headless verb still running keeps it.
- Domain: `domain/cell/step-lock.ts` (`parseStepLock`, `lockVerdictOf`).
