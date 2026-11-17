---
status: todo
priority: high
depends_on:
  - 04-cells-claims-and-leases
  - 05-job-execution-and-worktree-lifecycle
line: feature
type: feat
---

# Todo: `06-incidents-and-sse-stream` — Incident Triage/Resolution, Mechanic Dispatch, SSE Stream & Server Entrypoint

## 🎯 Objective

Complete `@repo/factory-server` by implementing the Incident (Andon) triage and resolution state machine (`GET /api/v1/incidents`, `POST /api/v1/incidents/:id/resolve` per `PLAN.md` §4 & §9), Mechanic job creation/dispatch, real-time SSE transition streaming (`GET /api/v1/stream`), and the `Bun.serve` CLI entrypoint (`src/index.ts`).

---

## 🌐 Context & Problem Statement

When a `WorkOrder` hits an unrecoverable step failure, operator block, missing line, or parent rebase, an Incident is opened. The server must automatically route eligible incidents to a Mechanic `Job` (while `mechanic_runs < maxMechanicRuns`) or to the Supervisor, and apply the 5 resolution actions (`retry_step`, `restart_from_step`, `restart_from_scratch`, `escalate`, `cancel`). Finally, supervisors need a real-time SSE feed (`GET /api/v1/stream?projectId=&afterSeq=`) and a runnable `Bun.serve` entrypoint with bootstrap token CLI support.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/{domain/incidents,contracts/{incidents,stream}.contract.ts,application/procedures/incidents,adapters/hono/routes/{incidents,stream}.route.ts,index.ts}`
- **Boundary**: Strictly backend-only inside `apps/factory-server/` (do not connect or edit `apps/cell`, `apps/cli`, or `packages/factory-*`; simulate Cell/Supervisor HTTP calls via `app.request()` in `apps/factory-server/test/`).
- **Classification**: `Domain Core` / `Integration` / `Infrastructure`
- **Dependencies**:
  - `hono: catalog:`
  - `drizzle-orm: catalog:`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Pure Incident State Machine (`src/domain/incidents/incident-rules.ts`)**:
   - Initial `triage_owner` routing (`PLAN.md` §4.2):
     - If `reason === 'line_unavailable'` or `workOrder.mechanic_runs >= MAX_MECHANIC_RUNS`: `triage_owner = 'supervisor'`, `status = 'open'`.
     - Otherwise: `triage_owner = 'mechanic'`, `status = 'open'`, increments `workOrder.mechanic_runs`, and queues a `Job` with `kind = 'mechanic'` (`workspaceMode = 'reuse'`) pinned to `workOrder.pinned_cell_id`.
   - Resolution actions (`PLAN.md` §4.3):
     - `retry_step`: grants `+grantRetries` (default `1`, reducing `attempts_used` or increasing `max_attempts`) on failed step `x`, clears `unavailable_line_cells_json` (and optionally updates `line_name` if provided), keeps `current_step_index = x` and `pinned_cell_id`, transitions `WorkOrder.state = 'queued'` (`workspaceMode = 'reuse'`).
     - `restart_from_step`: validates `0 <= stepIndex <= x`, rewinds `current_step_index = stepIndex`, resets steps `stepIndex..N-1` (`stepIndex` -> `'ready'`, `stepIndex+1..N-1` -> `'pending'`, `attempts_used = 0`, `produced_files_json = '[]'`), keeps steps `0..stepIndex-1`, transitions `WorkOrder.state = 'queued'`.
     - `restart_from_scratch`: resets `current_step_index = 0`, `worktree_resets = 0`, `stale_base = 0`, clears `unavailable_line_cells_json`, resets all `order_steps` `0..N-1`, transitions `WorkOrder.state = 'queued'` (`workspaceMode = 'fresh'`).
     - `escalate`: transitions `Incident.triage_owner = 'supervisor'`, `Incident.status = 'escalated'` (keeps `WorkOrder.state = 'blocked'`).
     - `cancel`: transitions `Incident.status = 'cancelled'` and `WorkOrder.state = 'cancelled'`, clearing `pinned_cell_id`.
2. **Contracts & Procedures (`src/contracts/incidents.contract.ts`, `src/application/procedures/incidents/`)**:
   - `listIncidentsProcedure` (`GET /api/v1/incidents`, scope `supervisor:read`): filter by `projectId`, `orderId`, `reason`, `status`.
   - `resolveIncidentProcedure` (`POST /api/v1/incidents/:id/resolve`, scopes `supervisor:write` or `cell:worker`):
     - If caller is `cell:worker`, verifies the Cell holds the active `mechanic` `Job` lease for this `incidentId` (`epoch` checked), and marks the `mechanic` `Job` as `passed` inside the same `immediateTx`.
     - Applies the chosen resolution action (`retry_step`, `restart_from_step`, `restart_from_scratch`, `escalate`, `cancel`), records `state_transitions`, and wakes `claimWaiters` if the `WorkOrder` returned to `queued`.
3. **SSE Real-Time Stream (`src/adapters/hono/routes/stream.route.ts`)**:
   - `GET /api/v1/stream?projectId=<id>&afterSeq=<seq>` (scope `supervisor:read`):
   - Authenticates via `ctx.auth`, queries `state_transitions` with `seq > afterSeq` (filtered by `projectId` if provided), emits backlog events as SSE `event: transition` with `id: String(row.seq)` and JSON `data`, then subscribes to `ctx.transitionBus` for live transitions and sends periodic `: keepalive` comments until `c.req.raw.signal` aborts.
4. **Server CLI & `Bun.serve` Entrypoint (`src/index.ts`)**:
   - Supports starting the HTTP server (`Bun.serve({ port, hostname, fetch: app.fetch })`) with SQLite path from `FACTORY_DB_PATH` (default `./.factory-local/factory.db`) and an `admin token create` subcommand to mint the initial `sf_sup_` supervisor token on a fresh database.
5. **Tests**:
   - Unit tests (`src/domain/incidents/__tests__/incident-rules.test.ts`): all 7 incident triggers, Mechanic vs Supervisor routing, and all 5 resolution state transitions.
   - Black-box HTTP tests (`test/blackbox/incidents-and-stream.test.ts`):
     - Step failure exhausting retries -> opens Incident -> dispatches `mechanic` Job on `/cells/claims` -> Mechanic resolves with `retry_step` -> Cell claims retried step and finishes `deliver`.
     - Mechanic `escalate` -> Supervisor resolves with `restart_from_step` and `restart_from_scratch`.
     - `GET /api/v1/stream` replays `afterSeq` backlog and streams live transitions in order.
     - Route index completeness test verifying all 26 endpoints in `PLAN.md` §9 are mounted and respond with proper auth/validation codes.

---

## ✅ Acceptance Criteria

- [ ] All 7 incident triggers from `PLAN.md` §4.1 open an `Incident` with the right `triage_owner` (`mechanic` vs `supervisor`) and dispatch a `mechanic` Job when budget remains.
- [ ] `POST /api/v1/incidents/:id/resolve` supports `retry_step`, `restart_from_step`, `restart_from_scratch`, `escalate`, and `cancel` for both Mechanic (`cell:worker`) and Supervisor (`supervisor:write`).
- [ ] `GET /api/v1/stream` streams historical (`afterSeq`) and live `state_transitions` over SSE with project filtering.
- [ ] All 26 REST + SSE endpoints listed in `PLAN.md` §9 are implemented, wired in `src/app.ts`, and covered by black-box tests.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
