---
status: queued
priority: high
line: feature
type: feat
plan: standalone-factory
depends_on: factory-app-extract
---

# factory-local-engine: run local SQLite execution engine as default in apps/factory

## Objective

Equip `apps/factory` with an embedded local SQLite execution engine (`$XDG_DATA_HOME/sf/factory-local.db`) so Factory always owns execution locally (claims, heartbeats, job transitions, retries, Mechanic triage, incidents) whether connected to HQ or standalone.

## Context

Part of [`docs/plans/standalone-factory-plan.md`](../docs/plans/standalone-factory-plan.md). Execution decisions live in local Factory around the repo; HQ acts as optional Web UI bridge and fleet observatory.

Verified current behavior:

- `gateOf` in `apps/factory/src/index.ts` (moved from `apps/sf/src/factory/index.ts`) blocks Cell scaling when `state.kind === 'not_connected'` (`factory not connected: run "sf factory connect"`).
- `relay.ts` returns `503` when `credential === null` (`factory not connected: run "sf factory connect"`).
- `apps/hq` exports `createApp` (`apps/hq/src/app.ts`), `createTransport` (`apps/hq/src/bootstrap/transport.ts`), `createDb` (`apps/hq/src/db/client.ts`), `createClaimWaiters`, `createTransitionBus`, and `TOKEN_SCOPES` (`apps/hq/src/application/ports/auth.port.ts`).

## Scope

- **Target**: `apps/factory`, `apps/hq`
- **Classification**: `Domain Core`, `Infrastructure`
- **Dependencies**: `@repo/hq: workspace:*`, `@repo/bun-sqlite-kit: workspace:*`, `@repo/hq-contracts: workspace:*`
- **Out of scope**: `POST /queue/import` server-side file loading (`factory-queue-import-endpoint`), CLI default local routing (`sf-local-mode-cli`), and HQ projection sync + command outbox (`hq-thin-bridge-sync-and-outbox`).

## Implementation Plan

1. **Always-On Local SQLite Execution Engine in `apps/factory`**:
   - Open `$XDG_DATA_HOME/sf/factory-local.db` (or `:memory:` in tests) using `createDb`.
   - Instantiate local execution Hono app (`createApp(createTransport({ db, clock, auth: loopbackAuth, claimWaiters, transitionBus }))`) with loopback principal (`tokenId: asTokenId('tok_local')`, `factoryId: asFactoryId('fac_local')`, `scopes: ['supervisor:read', 'supervisor:write', 'factory:worker']`).
   - Upsert local Factory row `fac_local` in `factories` table on startup so `/api/v1/cells/*` and `/api/v1/factories/cells/:id/gone` recognize `fac_local`.
   - Auto-upsert repo project in `localEngine` on `PUT /scale` so Cells claim immediately without manual HQ registration.
2. **Unify Cell Execution Locally (No HQ Gate on Cell Startup)**:
   - Update `gateOf`: allow Cells to scale regardless of HQ connection state (`not_connected` or `unreachable` never blocks local execution).
   - Update `relay.ts`: validate Cell local bearer grant, attach `x-cell-id: live.grant.cellId`, and dispatch Cell `/relay/api/v1/*` requests directly to `localEngine.fetch(request)`.
   - Update `onStopped(cellId)`: invoke `POST /api/v1/factories/cells/:cellId/gone` on `localEngine` so killed Cells requeue active job and bump `epoch`.
   - Keep optional outbound HQ heartbeat loop running when `credential !== null` without blocking local Cell traffic.
3. **Expose Local `/api/v1/*` on Loopback**:
   - In `apps/factory/src/routes.ts`, forward loopback `/api/v1/*` requests to `localEngine.fetch(request)` unconditionally (no `409` local-vs-HQ split-brain).
4. **Tests**:
   - Black-box tests in `apps/factory/test/blackbox/`:
     - Factory with no HQ credential allows `PUT /scale`, spawns Cell, serves Cell claim/heartbeat/transition/incident-resolve locally, and requeues on Cell kill.
     - Factory with HQ credential still executes Cell jobs locally even when HQ is unreachable.

## Acceptance Criteria

- [ ] `apps/factory` runs local SQLite execution engine by default and serves Cell claims, heartbeats, transitions, and incident resolutions without HQ.
- [ ] Killing a Cell triggers local gone-Cell cleanup and epoch bump.
- [ ] Loopback `/api/v1/*` works whether HQ is connected, unreachable, or unconfigured.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
