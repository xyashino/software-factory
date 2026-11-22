---
status: queued
priority: high
line: standard
type: fix
---

# mechanic-tab-open-keep: mechanic opens its herdr tab and keeps it open

## Background (read first)

Cells run each job in a herdr tab when the station sets `headless: false`. The mechanic job is no exception. Two bugs seen on `factory-vps`:

1. The mechanic never opens its tab. Log shows `start runner=antigravity model=gemini-3.8-flash-medium headless=false` and no `pane` or `headless` line after it.
2. Its tab closes. The user wants it to stay open after the mechanic ends.

The `step-files-atomic` todo is a separate, unrelated fix in the same runner path. Do not mix the two.

## Current state (verified in code)

- `apps/sf/src/application/procedures/cell/run-job.procedure.ts` `planLaunch` (around line 340-380): if `headless` is false and `runtime.ports.runner.interactiveAvailable()` is true, it plans a TUI launch. Otherwise, or if the TUI start throws, it falls back to headless. The fallback writes a `headless` log line with `fallback=<reason>`.
- The `pane` log line is written only after `startRun` returns. A missing `pane` and `headless` line means `startRun` has not returned or the log was cut.
- `apps/sf/src/adapters/runners/herdr.ts`:
  - `interactiveAvailable` runs `herdr status server`.
  - `start` (around line 296-385) closes the previous run's tab before creating a new one (`tab close previous.tabId`, around line 341-346). Its comment says a TUI step never writes its exit file, so closing its tab is how its wait ends.
  - `abort` closes the tab (line 392).
  - `wait` (around line 400-415) only reads the exit file. It never closes the tab.
- Mechanic launch: `run-job.procedure.ts` around line 1404-1455 reads `mechanic.headless` from the line and passes it to the same plan path.

## Objective

1. When the line sets `headless: false` for the mechanic, the mechanic opens a herdr tab and logs a `pane` line with `ws=`, `tab=` and `pane=`.
2. When the mechanic ends normally, its tab stays open for the operator to read. An abort or timeout may still close it.
3. If herdr cannot open a tab, the fallback reason is logged so the cause is visible.

## Open decision (ask the user before building)

- Keep the mechanic tab open even when the next run in the same cell starts? Today the next `start` closes it. Keeping it means tabs accumulate per incident, or the tab is closed later by a different path.
- Default if not answered: keep the tab on normal exit, still close it on abort or timeout, and leave the next-run close for non-mechanic runs.

## Verify first

- On `factory-vps`, `herdr status server` exit code and output. If it fails, the mechanic silently falls back to headless. That is the likely cause of bug 1, and it may not be a code bug.
- Whether the mechanic log is complete when the run stops. The `start` line appears before the PID wait (`PID_WAIT_MS`). A slow start looks like a missing tab.
- Whether `herdr tab create` returns a `tab_id` and `pane_id` for the mechanic's workspace.

## Scope

- **Target**: `apps/sf/src/adapters/runners/herdr.ts`, `apps/sf/src/application/procedures/cell/run-job.procedure.ts`
- **Classification**: `Reliability`
- **Out of scope**: the TUI wait design itself, the headless runner, the logs tab, herdr install or setup, `step-files-atomic`.

## Implementation plan

1. Reproduce on `factory-vps`: run an incident through the mechanic with `headless: false` and capture the `pane` or `headless fallback=` line plus `herdr status server` output.
2. Fix the cause found in step 1. If herdr is not running, report it and make the fallback reason visible. Do not change code for an environment problem.
3. Change the tab lifecycle so a finished mechanic keeps its tab, per the open decision above.
4. Tests: black box through the Cell run with fake ports (existing fakes in `apps/sf/test`). Cover: mechanic with a working herdr shows a pane line; mechanic keeps its tab after normal exit; abort still closes the tab; herdr down logs a headless fallback with its reason.

## Acceptance criteria

- [ ] Mechanic run with herdr up logs a `pane` line and opens a tab.
- [ ] Mechanic tab is still open after a normal exit.
- [ ] Abort or timeout still closes the tab.
- [ ] Herdr-unavailable fallback logs `fallback=<reason>`.
- [ ] Tests as described, Arrange/Act/Assert, public behavior only.
- [ ] One new ADR in `decisions/` when the code changes.
- [ ] `bun run ci:verify` passes.
