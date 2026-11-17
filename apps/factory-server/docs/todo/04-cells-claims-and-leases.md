---
status: todo
priority: high
depends_on:
  - 02-safe-tokens-and-projects
  - 03-plans-orders-and-queue
line: feature
type: feat
---

# Todo: `04-cells-claims-and-leases` — Cell Enrollment, Fast Reconnect, Long-Poll Claims & Lease Heartbeats

## 🎯 Objective

Implement the Cell lifecycle and exclusive claim dispatcher (`POST /api/v1/cells/enroll`, `POST /api/v1/cells/hello`, `GET /api/v1/cells`, `DELETE /api/v1/cells/:id`, `POST /api/v1/cells/claims`, `POST /api/v1/cells/heartbeats` per `PLAN.md` §3.1, §3.6, §3.7 & §9).

---

## 🌐 Context & Problem Statement

A `WorkOrder` must be executed by at most 1 `Cell` from start to finish (`0..deliver`), matched by `projectId` and `allowedLines`. Idle Cells long-poll `/api/v1/cells/claims` (`waitMs: 25000`) with zero SQLite polling while idle. If a Cell disconnects, its 60s lease expires so the same Cell (with a warm worktree) or another eligible Cell can take over with a bumped `epoch` fencing token. If a Cell restarts and calls `/hello` before its 60s lease expires, it immediately resumes its `active_job_id`.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/{domain/cells,contracts/cells.contract.ts,application/procedures/cells,adapters/hono/routes/cells.route.ts}`
- **Boundary**: Strictly backend-only inside `apps/factory-server/` (do not connect or edit `apps/cell`, `apps/cli`, or `packages/factory-*`; simulate Cell/Supervisor HTTP calls via `app.request()` in `apps/factory-server/test/`).
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - `hono: catalog:`
  - `drizzle-orm: catalog:`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Pure Cell & Claim Selection Domain (`src/domain/cells/claim-eligibility.ts`)**:
   - Eligibility rules (`PLAN.md` §3.1):
     - `work_order.state === 'queued'` and `active_cell_id === null` and `active_job_id === null`.
     - `work_order.project_id === cell.projectId`.
     - `work_order.line_name` in `cell.allowedLines` (or `cell.allowedLines.includes('*')`).
     - `cell.cellId` not in `work_order.unavailable_line_cells_json`.
     - `pinned_cell_id === null` OR `pinned_cell_id === cell.cellId` OR the previously pinned Cell is offline/lease-expired.
     - Respects `projects.max_running` concurrency limit and orders candidates by: (1) warm worktree match (`pinned_cell_id === cell.cellId` or `localWorktrees` contains `orderId`), (2) priority (`high > medium > low`), (3) `created_at ASC`.
   - Also supports claiming ready `plan_branch` Jobs (initializing `OrderPlan` root branch `feat/<slug>`) and `mechanic` Jobs for matching `projectId`.
2. **Lazy Lease Reaper (`src/application/procedures/cells/reap-expired-leases.ts`)**:
   - Invoked inside `immediateTx` before `claims`, `hello`, and `cellsList`:
   - Finds `jobs` where `status IN ('claimed', 'running') AND lease_expires_at <= now`.
   - Marks each expired `Job` as `status = 'lost'`, `finished_at = now`.
   - For the owning `WorkOrder`: clears `active_cell_id = null`, `active_job_id = null`, increments `epoch += 1`, and transitions `state = 'queued'` (keeping `pinned_cell_id` so the same Cell is preferred if it reconnects first, while allowing another Cell to take over since the pinned Cell's lease is now expired).
   - Marks Cells whose `last_heartbeat_at + LEASE_TTL_MS <= now` as `status = 'offline'`.
3. **Contracts & Procedures (`src/contracts/cells.contract.ts`, `src/application/procedures/cells/`)**:
   - `enrollCellProcedure` (`POST /api/v1/cells/enroll`, scope `cell:enroll`): validates `sf_join_` token, creates/updates `cells` row with `projectId`, `allowedLines`, `runners`, mints `sf_cell_` session token, returns `{ code: 201, cellId, sessionToken, expiresAt }`.
   - `helloCellProcedure` (`POST /api/v1/cells/hello`, scope `cell:worker`): updates `projectId`, `allowedLines`, `runners`, `localWorktrees`, `last_heartbeat_at = now`. If `cell` already holds an unexpired `active_job_id` (`PLAN.md` §3.6), bumps `epoch += 1`, extends `lease_expires_at = now + LEASE_TTL_MS`, and returns `resumedJob` inline.
   - `claimJobProcedure` (`POST /api/v1/cells/claims`, scope `cell:worker`):
     - Runs `immediateTx`: reaps expired leases, selects next eligible `OrderPlan` (`plan_branch`), `Incident` (`mechanic`), or `WorkOrder` step.
     - On `WorkOrder` claim: sets `state = 'running'`, `active_cell_id = cellId`, `pinned_cell_id = cellId`, `epoch += 1`, creates/binds `Job` with `workspaceMode = current_step_index === 0 && worktree_resets === 0 ? 'fresh' : 'reuse'` and `expected_prior_steps_json`, sets `active_job_id = job.job_id`, `lease_expires_at = now + LEASE_TTL_MS`.
     - If no job is available and `body.waitMs > 0`, awaits `ctx.claimWaiters.waitForWake(Math.min(body.waitMs, CLAIM_WAIT_MS), ctx.signal)` and retries once before returning `{ code: 200, job: null }`.
   - `heartbeatCellProcedure` (`POST /api/v1/cells/heartbeats`, scope `cell:worker`): verifies `job.cell_id === cellId` and `job.epoch === body.epoch` (else `409 StaleLeaseEpoch`), extends `lease_expires_at = now + LEASE_TTL_MS`, returns `{ code: 200, leaseExpiresAt, signals: ['abort'] | [] }` (emits `'abort'` if order/job was cancelled or paused).
   - `listCellsProcedure` (`GET /api/v1/cells`, scope `supervisor:read`) & `revokeCellProcedure` (`DELETE /api/v1/cells/:id`, scope `supervisor:write`): revokes Cell + session tokens, marks active job `lost`, unpins orders, returns running order to `queued`.
4. **Tests**:
   - Unit tests for `claim-eligibility.ts` (project match, `allowedLines`, `unavailable_line_cells`, warm worktree affinity, priority ordering).
   - DB + Black-box tests (`test/blackbox/cells-claims-leases.test.ts`): enroll -> hello -> long-poll claim woken on queue import -> heartbeat lease extension -> fast reconnect via `/hello` returning `resumedJob` -> lease expiry after `+60_001ms` allowing Cell B to take over while Cell A's late heartbeat gets `409 StaleLeaseEpoch`.

---

## ✅ Acceptance Criteria

- [ ] A `WorkOrder` is claimed exclusively by 1 Cell matching `projectId` and `allowedLines` inside `immediateTx`.
- [ ] Idle `POST /api/v1/cells/claims` with `waitMs` parks in `ClaimWaitersPort` with 0 SQLite queries and wakes within `< 5ms` when a task is imported.
- [ ] `POST /api/v1/cells/hello` before lease expiry bumps `epoch`, refreshes `lease_expires_at`, and returns `resumedJob`.
- [ ] Lease expiry (`> 60_000ms`) reaps the abandoned `Job` (`lost`), re-queues the `WorkOrder`, allows another Cell to claim it, and rejects stale-epoch requests with `409 StaleLeaseEpoch`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
