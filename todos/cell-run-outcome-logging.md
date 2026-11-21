---
status: queued
priority: low
line: fast
type: fix
---

# cell-run-outcome-logging: the Cell log says why a run ended

## Objective

Every run end (abort, drain-force, timeout, exit, operator verb) and every abort of a runner is a line in the Cell log.

## Context

In the VPS incident the Cell log had claim, start, worktree and pane lines but nothing for how the first run ended, so the cause of the second claim could not be read from the log. See `docs/cell-runner-plan.md`.

## Scope

- **Target**: `apps/sf/src/application/procedures/cell/run-job.procedure.ts` (`logLine`)
- **Classification**: `Integration`
- **Out of scope**: log format changes, log rotation.

## Verify first

- Which outcomes already log (`finishRun` passes `exit=... duration=...`) and which `return null` paths do not (`aborted`, `drain-force`).

## Implementation Plan

1. **Files**: `run-job.procedure.ts`, tests with the fake log port.
2. **Behavior**: log `end kind=<aborted|drain-force|timeout|exited|operator> exit=<code> duration=<s>` and `abort reason=<...> confirmed=<yes|no>`; heartbeat failure count when it triggers abort. Never log tokens.
3. **Integration**: same line format as existing entries.

## Acceptance Criteria

- [ ] Test per outcome asserts its log line.
- [ ] No token or credential in any line.
- [ ] Tests: black box, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
