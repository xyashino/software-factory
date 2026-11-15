---
status: todo
priority: high
depends_on: [perf-01-unify-cell-workspace]
line: feature
factory: v2
---

# perf-03: Fail-fast parallel inspections, event-driven station wakeup, and leaner delivery

## Objective

Cut per-Order execution latency in `apps/cell` and `packages/factory-definitions` by parallelizing/fail-fasting `run_inspection`, removing polling delays in `runOperatorStation`, enabling headless mode for review/audit operators, and dropping redundant remote git round-trips in `deliver`.

## Read first

- `apps/cell/src/jobs/run-inspection.ts`, `run-operator-station.ts`, `deliver.ts`
- `apps/cell/src/adapters/github/github.adapter.ts`
- `packages/factory-definitions/src/line-schema.ts`, `packages/factory-definitions/starter/.factory/lines/{fast,standard,feature}.yml`, `.factory/lines/{fast,standard,feature}.yml`
- `packages/factory-core/src/contracts/job.ts`
- `packages/factory-runtime/src/job-builder.ts`

## Deliverables

1. **Inspection fail-fast & parallel Turbo execution:**
   - Add optional `failFast: boolean` (default `true` or configurable in `inspectionStationSchema`) so `runChecks` stops on the first failing/timed-out command instead of running remaining checks after failure.
   - Consolidate `quality-gate` in `packages/factory-definitions/starter/.factory/lines/{fast,standard,feature}.yml` and `.factory/lines/{fast,standard,feature}.yml` to run `pnpm turbo run check-types lint test --continue=false` (or parallelized Turbo graph) so Turbo runs independent package tasks concurrently and reuses `.turbo` cache from the shared worktree.
2. **Faster operator station lifecycle (`apps/cell`):**
   - Switch non-interactive review/audit operators (`plan-reviewer`, `doctor`) in `starter/.factory/lines/{feature,standard}.yml` and `.factory/lines/{feature,standard}.yml` to `headless: true` (eliminating `herdr` pane startup and 1s `pane.read`/`pane.tail` process polling).
   - Wake `runOperatorStation`'s loop immediately (via an internal signal/notify) when the headless child exits or `dispatch` handles a terminal command (`done`/`verdict`/`block`), instead of waiting up to `STATION_TICK_MS` (1,000 ms).
3. **Leaner delivery (`apps/cell/src/jobs/deliver.ts`):**
   - Remove the redundant remote `git push --dry-run` before `submit(..., { dryRun: true })` and the real `git push --force-with-lease` (`submit` dry-run already fences the epoch, and `--force-with-lease` atomically rejects a moved remote tip).
4. **Tests:**
   - Add/update tests in `apps/cell/src/__tests__/run-inspection.test.ts`, `deliver.test.ts`, and operator station tests covering fail-fast inspection and immediate wakeup.

## Acceptance criteria

- [ ] Failing early check in `run_inspection` stops remaining `exec` commands when `failFast` is enabled.
- [ ] `quality-gate` in shipped lines executes checks via parallel Turbo invocation with `--continue=false`.
- [ ] `deliver` performs a single remote `git push --force-with-lease` after the dry-run `ReportDelivery` fence check.
- [ ] `pnpm ci:verify` passes.
