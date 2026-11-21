---
status: queued
priority: medium
line: standard
type: fix
depends_on: cell-single-runner-lock
---

# cell-sigterm-during-job: stopping the Cell stops its job

## Objective

SIGINT or SIGTERM on `sf cell start` during a job aborts the runner (confirmed exit), hands the job back, and exits.

## Context

`cell.command.ts:108-110` installs `process.once` handlers that only call `controller.abort()`. `runtime.signal` is read only in `claimLoop`'s loop condition, never in `runJob`, and the handlers replace the default exit. A Cell mid-job keeps running its agent; `local-stop` then fails with "did not exit after SIGTERM". See `docs/cell-runner-plan.md`.

## Scope

- **Target**: `apps/sf/src/adapters/cli/cell.command.ts`, `application/procedures/cell/{run-job,claim-loop,leave}.procedure.ts`
- **Classification**: `Integration`
- **Out of scope**: graceful "finish the station" stop (that stays `sf cell stop` without `--force`).

## Verify first

- What `leaveCell(runtime, job)` sends for a held job (hand-over semantics) and that it works with an aborted run.
- Exit code and message for a signalled stop.

## Implementation Plan

1. **Files**: `run-job.procedure.ts` (listen to `runtime.signal`, resolve `end` as `drain-force`-like outcome), `cell.command.ts`.
2. **Behavior**: first signal: abort runner with confirmed exit, `leaveCell`, exit. Second signal: exit at once with a warning that an agent may still run.
3. **Integration**: reuse `abort_then_leave` path from drain-force.

## Acceptance Criteria

- [ ] Test: abort signal during a job aborts the runner, hands the job back, and `startCell` resolves.
- [ ] Second signal exits promptly.
- [ ] Tests: black box with fake ports, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
