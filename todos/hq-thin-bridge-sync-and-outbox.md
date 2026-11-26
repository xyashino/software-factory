---
status: queued
priority: high
line: feature
type: feat
plan: standalone-factory
depends_on: sf-local-mode-cli
---

# hq-thin-bridge-sync-and-outbox: connect local Factory projections and UI command outbox through thin HQ

## Objective

Turn `apps/hq` into a thin Web UI bridge for Smart Factories: connected Factories push compact order, incident (`issueUrl`, `draftPrUrl`), cell, and metric projections outbound to HQ, and poll/drain a per-Factory command outbox so Web UI actions (`pause`, `cancel`, `retry`, `resolve_incident`, `scale`) execute locally on the owning Factory.

## Context

With `factory-local-engine` and `sf-local-mode-cli`, `apps/factory` always owns local execution and SQLite state around the repo. HQ connects NAT/localhost Factories to `apps/web` so supervisors see live fleet status, Andon issues, and metrics in the browser and send actions back without HQ micro-managing `order_steps`, retries, or Mechanic steps.

Verified paths:

- `apps/hq/src/db/schema/factories.ts` stores enrolled Factories and heartbeats.
- `apps/hq/src/adapters/hono/routes/` exposes `/api/v1/*` consumed by `apps/web`.
- `packages/hq-contracts/src/` defines wire contracts shared by `apps/hq`, `apps/factory`, `apps/sf`, and `apps/web`.

## Scope

- **Target**: `packages/hq-contracts`, `apps/hq`, `apps/factory`
- **Classification**: `Architecture`, `Integration`
- **Dependencies**: `@repo/hq-contracts: workspace:*`, `@repo/factory-contracts: workspace:*`
- **Out of scope**: Deleting legacy HQ execution tables before migration soak period, `apps/web` layout redesign.

## Implementation Plan

1. **Sync & Outbox Contracts (`packages/hq-contracts`)**:
   - Add `POST /api/v1/factories/sync`: Factory pushes delta/snapshot of `{ projects, orders, incidents (with issueUrl, draftPrUrl), cells, metricRollups }` using `factory_session` token; response returns pending `commands[]` (`{ commandId, kind: 'pause_order' | 'unpause_order' | 'cancel_order' | 'retry_order' | 'resolve_incident' | 'scale_cells', payload }`).
   - Add `POST /api/v1/factories/commands/:id/ack`: Factory acknowledges applied/failed command with status and detail.
2. **Thin HQ Bridge Endpoints (`apps/hq`)**:
   - Add `factory_commands` outbox table (SQLite + Postgres migrations) keyed by `factoryId` and `commandId` with `pending | applied | failed` status.
   - Upsert pushed Factory projections into HQ read tables and emit SSE events on `transitionBus` so `apps/web` updates live.
   - Route Web UI mutation endpoints (`POST /work-orders/:id/transitions`, `POST /incidents/:id/resolve`, queue actions) for synced Factories into `factory_commands` outbox and return accepted status.
3. **Factory Sync Loop (`apps/factory`)**:
   - When `credential !== null`, push local state changes (debounced + periodic heartbeat) to `POST /api/v1/factories/sync`.
   - Execute returned commands locally against `localEngine` / `scaler`, then call `/commands/:id/ack` and push refreshed snapshot.
   - If HQ is unreachable, keep running local Cells uninterrupted and sync backlog on reconnect.
4. **Tests**:
   - Black-box integration tests across `apps/factory` + `apps/hq`:
     - Factory runs work order locally, syncs order + escalated incident (`issueUrl`, `draftPrUrl`) to HQ, visible via HQ read endpoints.
     - Supervisor action submitted to HQ (`resolve_incident` / `cancel_order` / `scale_cells`) drains to Factory, executes locally, acks, and updates HQ projection.
     - Offline Factory queues command in HQ outbox and applies it upon reconnect.

## Acceptance Criteria

- [ ] Connected Factory pushes order, incident (including forge URLs), cell, and metric projections to HQ while executing 100% locally.
- [ ] Web UI / supervisor actions on HQ enqueue in `factory_commands` outbox and execute on the owning Factory (immediately or on reconnect).
- [ ] HQ outage never blocks or interrupts local Factory execution.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
