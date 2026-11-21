---
status: queued
priority: high
line: standard
type: fix
---

# cell-runner-confirm-exit: abort kills the agent and waits

## Objective

When a run is aborted, timed out, force-drained or the job is lost, the runner and everything it started are stopped, and the Cell continues only after that is confirmed.

## Context

`run-job.procedure.ts` calls `void ports.runner.abort(handle)` (not awaited) and returns `null`; `claimLoop` then claims the next job. Herdr `abort` only runs `herdr tab close <tab>`, so the agent behind the pane can survive. On the VPS a second `claude` runner started in a reused worktree 93 s after the first. See `docs/cell-runner-plan.md`.

## Scope

- **Target**: `apps/sf/src/adapters/runners/{herdr,headless}.ts`, `application/ports/runner.port.ts`, `application/procedures/cell/run-job.procedure.ts`
- **Classification**: `Integration`
- **Out of scope**: lock file (`cell-single-runner-lock`), SIGTERM handling, reattach after restart.

## Verify first

- Reproduce with a fake runner whose child ignores tab close, in a unit test, before changing code.
- Whether `herdr tab close` ends the pane's process. If unsure, assume not.
- How to get the pid of the agent in a pane: launcher script writes it? (`launcherOf` in `herdr.ts` runs the command in bash and writes an exit file only.)
- `headless.ts` kills the direct child only: confirm grandchildren survive.

## Implementation Plan

1. **Files**: `herdr.ts` (launcher writes pid file; `abort` signals the process group, waits for exit up to a limit, escalates to SIGKILL, then closes the tab), `headless.ts` (spawn in own group, kill the group), runner port (`abort` resolves only after exit or timeout and returns whether it died), `run-job.procedure.ts` (`await` abort on all paths).
2. **Behavior**: if the runner is still alive after the limit, do not claim another job: log it, leave the Cell, surface an incident-style failure for the job. Never start a new runner while the old one lives.
3. **Integration**: Windows keeps current behavior unless a tree kill is cheap.

## Acceptance Criteria

- [ ] Test: fake runner spawns a grandchild and ignores tab close; after abort, timeout and drain-force the whole tree is gone.
- [ ] Next claim waits for confirmed exit; if exit cannot be confirmed the Cell does not claim.
- [ ] Tests: black box with fake ports, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
