---
status: queued
priority: high
line: standard
type: fix
depends_on: cell-runner-confirm-exit
---

# cell-single-runner-lock: never two runners on one step

## Objective

A lock in the step directory makes `runner.start` refuse when a live runner already exists for that worktree step, whatever the cause.

## Context

Even with confirmed aborts, other paths (Cell crash, hard kill, restart) can leave an agent alive while a new Cell run reuses the worktree. A lock is the last guard. See `docs/cell-runner-plan.md`.

## Scope

- **Target**: `apps/sf/src/application/procedures/cell/run-job.procedure.ts`, `adapters/runners/`, step dir (`runner.json` already exists)
- **Classification**: `Integration`
- **Out of scope**: reattaching to a live pane.

## Verify first

- Content of `runner.json` today (`mode` only) and where the step dir is built (`dirOf`).
- Stale detection: pid alive check plus start time, to survive pid reuse.

## Implementation Plan

1. **Files**: new lock module under `domain/cell/`, used by `run-job.procedure.ts` before `startRun`; extend `runner.json` with `runId`, `pid`, `startedAt`.
2. **Behavior**: before start, read lock. Live owner: refuse with a clear error naming pid and pane. Stale owner: take over and log it. Release in `finally`.
3. **Integration**: error becomes a job failure the existing flow handles (no new job states).

## Acceptance Criteria

- [ ] Test: second `start` for a step with a live lock fails and starts nothing.
- [ ] Test: stale lock (dead pid) is replaced and logged.
- [ ] Lock released after normal exit, abort and failure.
- [ ] Tests: black box, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
