---
status: todo
priority: high
depends_on: [04-cells-claims-and-leases]
line: feature
type: feat
---

# Todo: `05-job-execution-and-worktree-lifecycle` — Job Transitions, Dynamic Step Materialization, Inline `nextJob`, `line_unavailable` & `worktree_missing`

## 🎯 Objective

Implement `POST /api/v1/jobs/:id/transitions` covering all Cell job transitions from `PLAN.md` §3.2–§3.5 & §6.2: `start` (dynamic `lineSnapshot` step materialization), `complete` (inline `nextJob` handoff, `deliver` completion, child order unlocking, and parent rebase `stale_base` detection), `fail` (step retry / `onFailRetryStationId` rewind / incident trigger), `block`, `line_unavailable`, and `worktree_missing` (automatic reset to Step 0 scratch).

---

## 🌐 Context & Problem Statement

Once a Cell claims a `Job`, the entire step-to-step execution lifecycle happens through `POST /api/v1/jobs/:id/transitions` without releasing `active_cell_id` or returning to `/claims` between steps. The server must materialize `order_steps[0..N-1]` from the Cell's local `.factory/lines/<line>.yml` `lineSnapshot` on Step 0 `start`, hand off `nextJob` inline on `complete` or retry, re-dispatch a different task on `line_unavailable`, and atomically rewind to Step 0 (`workspaceMode: 'fresh'`) on `worktree_missing`.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/{domain/orders,contracts/jobs.contract.ts,application/procedures/jobs,adapters/hono/routes/jobs.route.ts}`
- **Boundary**: Strictly backend-only inside `apps/factory-server/` (do not connect or edit `apps/cell`, `apps/cli`, or `packages/factory-*`; simulate Cell/Supervisor HTTP calls via `app.request()` in `apps/factory-server/test/`).
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - `hono: catalog:`
  - `drizzle-orm: catalog:`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Pure Step & Transition Domain (`src/domain/orders/job-transitions.ts`)**:
   - **Step 0 `lineSnapshot` validation**: validates ordered stations (`kind: 'operator' | 'inspection' | 'deliver'`, `requiredFiles`, `maxAttempts`, optional `onFailRetryStationId` referencing an earlier station id) and verifies the final station has `kind === 'deliver'`.
   - **Artifact verification (`complete`)**: verifies every file in `step.required_files_json` is present in `body.producedFiles` (else throws `UnprocessableEntity(422)`).
   - **Retry & Rewind calculation (`fail`)**:
     - Increments `step.attempts_used`.
     - If `attempts_used < max_attempts`: if `on_fail_retry_station_id` is set (e.g. `quality-gate` -> `build`), rewinds `current_step_index` to target station, resets steps from target..current to `ready`/`pending`, and issues a retry `Job` (`workspaceMode: 'reuse'`) inline as `nextJob`. Otherwise retries the current step inline as `nextJob`.
     - If `attempts_used >= max_attempts`: transitions `WorkOrder.state = 'blocked'`, clears `active_cell_id` and `active_job_id`, and returns Incident trigger `{ reason: 'step_retries_exhausted' }` (or `'delivery_failed'` if `step.kind === 'deliver'`).
   - **Scratch reset calculation (`worktree_missing`, `PLAN.md` §3.4)**:
     - Increments `worktree_resets`. If `worktree_resets > MAX_WORKTREE_RESETS` (`2`), transitions `WorkOrder` to `'blocked'` and opens an Incident (`reason = 'worktree_reset_limit'`).
     - Otherwise resets `current_step_index = 0`, `head_commit_sha = null`, resets all `order_steps` (`Step 0 = 'claimed'`, `Steps 1..N-1 = 'pending'`, `attempts_used = 0`, `produced_files_json = '[]'`), keeps `pinned_cell_id = cellId` and `active_cell_id = cellId`, and issues a new Step 0 `Job` (`workspaceMode: 'fresh'`, `epoch + 1`) as `nextJob`.
2. **Contract (`src/contracts/jobs.contract.ts`)**:
   - Discriminated union body on `action`:
     - `start`: `{ action: 'start', commandId, epoch, lineSnapshot? }`
     - `complete`: `{ action: 'complete', commandId, epoch, producedFiles: string[], commitSha?, output? }`
     - `fail`: `{ action: 'fail', commandId, epoch, detail, output?, workspaceFailed?: boolean }`
     - `block`: `{ action: 'block', commandId, epoch, detail, handoverFile? }`
     - `line_unavailable`: `{ action: 'line_unavailable', commandId, epoch, lineName, detail }`
     - `worktree_missing`: `{ action: 'worktree_missing', commandId, epoch, missingStepId, missingFiles: string[] }`
3. **Procedure (`src/application/procedures/jobs/transition-job.procedure.ts`)**:
   - Runs inside `immediateTx(ctx.db, ...)`:
   - Checks `commandId` idempotency in `state_transitions`; verifies `job.cell_id === principal.cellId` and `job.epoch === body.epoch` (else `409 StaleLeaseEpoch`).
   - **`action: 'start'`**: on Step 0, materializes `order_steps[0..N-1]` from `lineSnapshot`, binds `job.step_id`, sets `job.status = 'running'` and `step.state = 'running'`.
   - **`action: 'complete'`**:
     - For `plan_branch` Jobs: marks `OrderPlan.state = 'active'`, `branch_commit_sha = commitSha`, unlocks root `WorkOrder`s (`waiting_parent -> queued`), wakes `claimWaiters`.
     - For intermediate `OrderStep` (`stepIndex < N - 1`): marks step `passed`, updates `head_commit_sha`, creates `nextJob` for `stepIndex + 1` (`workspaceMode: 'reuse'`, `expectedPriorSteps` populated from steps `0..stepIndex`), keeps `active_cell_id` and `pinned_cell_id` locked, sets `active_job_id = nextJob.jobId`, and returns `{ completed: true, nextJob }`.
     - For final `deliver` step (`PLAN.md` §3.5 & §6.2): marks step `passed`, transitions `WorkOrder.state = 'delivered'`, records `head_commit_sha = commitSha`, clears `active_cell_id = null`, `active_job_id = null`, `pinned_cell_id = null`. Unlocks child `WorkOrder`s in `waiting_parent` (`state = 'queued'`, `base_commit_sha = commitSha`). If any child `WorkOrder` had already started or delivered on a different `base_commit_sha !== commitSha`, marks child `stale_base = 1`, `state = 'blocked'`, and opens an Incident (`reason = 'parent_rebased'`). Returns `{ completed: true, nextJob: null }`.
   - **`action: 'line_unavailable'` (`PLAN.md` §3.2)**: marks `Job.status = 'line_unavailable'`, appends `cellId` to `unavailable_line_cells_json`, clears `active_cell_id`, `active_job_id`, `pinned_cell_id`. If no other online Cell for `projectId` supports `lineName`, sets `WorkOrder.state = 'line_unavailable'` and opens an Incident (`reason = 'line_unavailable'`). Immediately claims a different eligible `Job` for `cellId` and returns `{ markedLineUnavailable: true, nextJob }`.
   - **`action: 'worktree_missing'` (`PLAN.md` §3.3–§3.4)**: rewinds `WorkOrder` and `order_steps` to Step 0 (`workspaceMode: 'fresh'`) and returns `{ resetToScratch: true, nextJob }` (or opens `worktree_reset_limit` Incident if `worktree_resets > 2`).
   - **`action: 'fail'` & `'block'`**: handles step retries/rewinds or opens the corresponding Incident (`step_retries_exhausted`, `operator_blocked`, `workspace_failed`, `delivery_failed`).
4. **Tests**:
   - Unit tests (`src/domain/orders/__tests__/job-transitions.test.ts`): `lineSnapshot` materialization, required file check, `onFailRetryStationId` rewind (`quality-gate` -> `build`), `worktree_missing` reset cap (`> 2` -> `worktree_reset_limit`).
   - Black-box HTTP tests (`test/blackbox/job-transitions-and-worktree.test.ts`): full `Step 0 (plan) -> Step 1 (build) -> Step 2 (quality-gate fail -> rewind to build) -> Step 2 (pass) -> Step 3 (deliver)` on a single Cell without re-calling `/claims`; `line_unavailable` re-dispatching a second queued task; `worktree_missing` resetting to Step 0 `fresh`; child order unlocking on `deliver`; parent re-delivery triggering child `stale_base = 1` + `parent_rebased` Incident.

---

## ✅ Acceptance Criteria

- [ ] Step 0 `start` with `lineSnapshot` dynamically populates `order_steps[0..N-1]` in SQLite.
- [ ] Completing Step `k < N-1` returns `nextJob` inline (`workspaceMode: 'reuse'`, with `expectedPriorSteps`) while keeping `active_cell_id` and `pinned_cell_id` locked to the same Cell.
- [ ] `line_unavailable` records the Cell in `unavailable_line_cells_json`, transitions the `WorkOrder` (or leaves it queued if another online Cell supports the line), and returns a different eligible `nextJob` inline.
- [ ] `worktree_missing` atomically resets the `WorkOrder` to Step 0 (`workspaceMode: 'fresh'`) and blocks with `worktree_reset_limit` after `> 2` resets.
- [ ] Completing `deliver` clears locks, unlocks `waiting_parent` children with `base_commit_sha`, and flags already-started children with `stale_base = 1` + `parent_rebased` Incident when a parent re-delivers a new commit.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
