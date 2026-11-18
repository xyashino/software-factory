---
scope: factory/server
summary: Job step, retry and reset transition rules as pure domain functions
why: The server needs one tested rule set for step materialization, fail retries and worktree resets before wiring any DB or HTTP.
date: 2026-11-18
tags: [factory, jobs, transitions, domain]
---

- `materializeLineSnapshot` validates a Step 0 `lineSnapshot` with zod and returns ordered `OrderStep` rows with `attemptsUsed: 0`.
- Snapshot rules: station ids unique, `kind` one of `operator | inspection | deliver`, `onFailRetryStationId` must name an earlier station, last station must be `deliver`.
- Invalid snapshot throws `UnprocessableTransition`; zod errors are not leaked.
- `assertArtifactsProduced` throws `UnprocessableTransition` when any `requiredFiles` entry is missing from `producedFiles`.
- `planStepFailure` increments `attemptsUsed`. Below `maxAttempts`: `rewind` to `onFailRetryStationId` when set, else `retry` the current step.
- At or above `maxAttempts`: `blocked` with `delivery_failed` for a `deliver` step, else `step_retries_exhausted`.
- Rewind does not reset the target station's `attemptsUsed`.
- `planWorktreeMissing` increments `worktreeResets`. Above `MAX_WORKTREE_RESETS` (2): `blocked` with `worktree_reset_limit`. Otherwise `reset` to step 0 with `workspaceMode: 'fresh'`.
- No DB or HTTP code; the cap comes from `src/config.ts`.
- Unit tests cover materialization, invalid snapshots, required files, quality-gate rewind to build, attempts exhausted and the reset cap.
