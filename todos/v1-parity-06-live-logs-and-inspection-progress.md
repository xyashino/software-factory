---
status: todo
priority: medium
depends_on:
  - v1-parity-05-named-branches-and-tree-snapshots
line: feature
factory: v2
plan: v1-ux-parity
type: feat
---

# v1-parity-06-live-logs-and-inspection-progress: Stream live inspection progress and enrich Traveler summaries in the `logs` tab

## 🎯 Objective

Make the Herdr `logs` tab (`factory log <orderId> -f`) as informative as v1 (`console-lines.ts` + `gate.ts`): emit live per-command inspection progress (`▶ cmd (1/3)` → `✓/✗ cmd (1/3) exit 0 (12s)`) while `run_inspection` executes, surface Operator heartbeat/reminder milestones, and enrich `describeEvent` in `apps/cli/src/render/log-view.ts` so every Traveler event shows actionable details instead of blank lines.

---

## 🌐 Context & Problem Statement

Currently in v2:
- The `logs` tab runs `factory log <orderId> -f` (`apps/cell/src/jobs/pane-commands.ts`).
- In `apps/cell/src/jobs/run-inspection.ts`, `runChecks` executes all commands in `station.exec` sequentially (`pnpm check-types`, `pnpm lint`, `pnpm test`, ...) and only submits `ReportInspection` after every command completes. During a 10-minute gate run, nothing appears in the `logs` tab.
- In `apps/cli/src/render/log-view.ts`, `describeEvent` falls through to `return ''` for `inspection_finished`, `verdict_recorded`, `workspace_failed`, `delivery_finished`, `delivery_failed`, `usage_recorded`, `job_claimed`, `job_lost`, `resumed`, and `reopened`, and omits `reason` / `detail` on `cycle_failed` and `cycle_blocked`.

In v1 (`packages/software-factory/src/supervisor/gate.ts` & `console-lines.ts`), `runGate` invoked `onCommand` before and after each command, printing `▶ <stepId>: <command> (i/N)` and `✓/✗ <stepId>: <command> (i/N) exit <code>` immediately to the `logs` tab, alongside idle/heartbeat reminders.

---

## 📦 Specification / Scope

- **Target**:
  - `packages/factory-core/src/order/` (`events.ts`, `commands.ts`, `decide-cycle.ts`, `evolve-cycle.ts`, `decide-guards.ts`)
  - `packages/factory-runtime/src/command-handler.ts` (if command routing/projection needs awareness)
  - `apps/cell/src/jobs/run-inspection.ts`
  - `apps/cell/src/jobs/run-operator-station.ts` (optional: emit reminder/progress visibility)
  - `apps/cli/src/render/log-view.ts`
- **Classification**: `Domain Core` / `Integration` / `CLI`
- **Dependencies**:
  - No new external dependencies.

---

## 🛠️ Implementation Plan

1. **Inspection Progress Command & Event (`packages/factory-core`)**:
   - Add a lightweight progress command (`ReportInspectionCheck` or `ReportInspectionProgress`) and corresponding event(s) (`inspection_check_started` and `inspection_check_finished`, or `inspection_progress` with `phase: 'started' | 'finished'`) carrying:
     - `cycleId`, `index` (1-based), `total`, `command`
     - when finished: `exitCode`, `timedOut`, `durationMs`
   - In `decide-cycle.ts`: allow only `actor.kind === 'cell'`, check `fenced(state, ctx)` and `requireLive(state, command.cycleId)`, verify `station.kind === 'inspection'`.
   - In `evolve-cycle.ts`: leave cycle status `'running'` (purely informational Traveler events; no state transition side-effects).
   - Ensure `evolve` / `projection` / `renderOrder` ignore or display these cleanly without breaking `cyclesOf` or `nextJob`.
2. **Emit Live Progress from Cell (`apps/cell/src/jobs/run-inspection.ts`)**:
   - Before each command in `runChecks`, send `ReportInspectionProgress` (`phase: 'started'`, `commandId: \`${job.jobId}:check:${index}:start\``).
   - Immediately after each command completes (and its log blob is uploaded), send `ReportInspectionProgress` (`phase: 'finished'`, `commandId: \`${job.jobId}:check:${index}:end\``).
   - Keep `WireFailure` (`stale_epoch`) handling intact so fencing stops the inspection cleanly; treat transient/non-fencing progress errors carefully so progress reporting never masks actual check execution unless fenced.
3. **Optional Operator Reminder / Progress Visibility (`apps/cell/src/jobs/run-operator-station.ts`)**:
   - When `watch` triggers `remind_idle` or `remind_silent` (or periodic long-cycle heartbeats), optionally record an informational event (or reuse a lightweight `cycle_progress` / `cycle_reminded` event) so long-running Operator stations also show signs of life in `factory log -f`.
4. **Enrich Traveler Rendering (`apps/cli/src/render/log-view.ts`)**:
   - Update `FAMILY` and `describeEvent` to render clear, scannable lines in `factory log` and the Herdr `logs` tab:
     - `inspection_check_started` / `inspection_progress (started)`: `▶ <command> (<index>/<total>)`
     - `inspection_check_finished` / `inspection_progress (finished)`: `✓/✗ <command> (<index>/<total>) exit <N> (<duration>)` (or `timed out`)
     - `inspection_finished`: `cycle <id> passed|failed (<passedCount>/<total> checks)`
     - `verdict_recorded`: `cycle <id> verdict pass|fail`
     - `cycle_failed`: `cycle <id> failed (<reason>): <detail>`
     - `cycle_blocked`: `cycle <id> blocked (<source>/<reason>): <detail>`
     - `workspace_failed`: `<stage>: <detail>`
     - `delivery_finished`: `<prUrl>`
     - `delivery_failed`: `<detail>`
     - `usage_recorded`: `<model> <in>+<out> tok ($<cost>)`
     - `job_claimed`: `job <id> <kind> on <cellId>`
     - `job_lost`: `<reason>`
     - `resumed` / `reopened`: `<mode/station> by <by>`
   - Keep `--json` output in `apps/cli/src/commands/log.ts` lossless (`StoredEvent` JSON lines).

---

## 🧪 Verification & Acceptance Criteria

- [ ] **Domain Core Tests**: `decide-cycle.ts` & `evolve-cycle.ts` unit tests verifying `inspection_progress` / `inspection_check_*` fencing, station-kind guard, and no interference with cycle completion or retry counts.
- [ ] **Cell Tests**: `run-inspection` unit/integration test verifying start and finish progress events are sent in order per command before `ReportInspection`, and `stale_epoch` stops execution.
- [ ] **CLI Tests**: `log-view.test.ts` verifying formatted output for `inspection_progress`, `inspection_finished`, `verdict_recorded`, `cycle_failed`, `cycle_blocked`, `workspace_failed`, `delivery_finished`, `delivery_failed`, and `usage_recorded`.
- [ ] **Checks**: `pnpm check-types`, `pnpm lint`, `pnpm test`, `pnpm nitpick:check` pass.
