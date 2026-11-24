---
status: queued
priority: high
line: feature
type: feat
plan: standalone-factory
depends_on: factory-app-extract
---

# factory-local-engine: run local SQLite execution engine in apps/factory when disconnected from HQ

## Objective

Equip `apps/factory` with an embedded local SQLite execution engine (`$XDG_DATA_HOME/sf/factory-local.db`) so Cells can start, claim jobs, send heartbeats, transition jobs, and resolve incidents locally when Factory is not connected to HQ.

## Context

Part of [`docs/standalone-factory-plan.md`](../docs/standalone-factory-plan.md).

Verified current behavior:

- `gateOf` in `apps/factory/src/index.ts` (moved from `apps/sf/src/factory/index.ts`) blocks Cell scaling when `state.kind === 'not_connected'` (`factory not connected: run "sf factory connect"`).
- `relay.ts` returns `503` when `credential === null` (`factory not connected: run "sf factory connect"`).
- `apps/hq` exports `createApp` (`apps/hq/src/app.ts`), `createTransport` (`apps/hq/src/bootstrap/transport.ts`), `createDb` (`apps/hq/src/db/client.ts`), `createClaimWaiters`, `createTransitionBus`, and `TOKEN_SCOPES` (`apps/hq/src/application/ports/auth.port.ts`).

## Scope

- **Target**: `apps/factory`, `apps/hq`
- **Classification**: `Domain Core`, `Infrastructure`
- **Dependencies**: `@repo/hq: workspace:*`, `@repo/bun-sqlite-kit: workspace:*`, `@repo/hq-contracts: workspace:*`
- **Out of scope**: `POST /queue/import` server-side file loading (`factory-queue-import-endpoint`) and CLI `--local` flags (`sf-local-mode-cli`).

## Implementation Plan

1. **Local SQLite & Loopback Engine in `apps/factory`**:
   - Open `$XDG_DATA_HOME/sf/factory-local.db` (or in-memory `:memory:` in tests) using `createDb`.
   - Instantiate a local execution Hono app (`createApp(createTransport({ db, clock, auth: loopbackAuth, claimWaiters, transitionBus }))`) where `loopbackAuth` grants local principal (`tokenId: asTokenId('tok_local')`, `factoryId: asFactoryId('fac_local')`, `scopes: ['supervisor:read', 'supervisor:write', 'factory:worker']`).
   - Seed or upsert the local Factory row `fac_local` in `factories` table on startup so `/api/v1/cells/*` and `/api/v1/factories/cells/:id/gone` recognize `fac_local`.
2. **Gate & Relay Switching (`not_connected` vs `connected`)**:
   - Update `gateOf`: when `state.kind === 'not_connected'`, return `null` (allow Cells to scale in standalone local mode). When `state.kind === 'unreachable'` or `'rejected'` (i.e. a Factory credential exists in `factory.json` but HQ is down or rejected it), continue to block Cell startup.
   - Update `relay.ts`: when `deps.credential() === null`, validate the Cell's local bearer grant as usual, attach `x-cell-id: live.grant.cellId`, and dispatch the request directly to `localEngine.fetch(request)` instead of returning `503`.
   - Update `onStopped(cellId)`: when `credential === null`, invoke `POST /api/v1/factories/cells/:cellId/gone` on `localEngine` so a killed local Cell immediately requeues its active job and bumps `epoch`.
3. **Expose Local `/api/v1/*` on Loopback Only When Standalone**:
   - In `apps/factory/src/routes.ts`, forward `/api/v1/*` requests to `localEngine.fetch(request)` when `credential === null`.
   - When `credential !== null` (Factory is connected to HQ), reject direct `/api/v1/*` requests on `apps/factory` with `409 Conflict` (`{ code: 409, type: 'refused', message: 'factory is connected to HQ; disconnect or omit --local' }`).
   - Also auto-upsert the repo project in `localEngine` during `PUT /scale` when `credential === null` so Cells can immediately claim for that `projectId`.
4. **Tests**:
   - Black-box tests in `apps/factory/test/blackbox/`:
     - Disconnected Factory (`credential === null`) allows `PUT /scale`, spawns a Cell, serves Cell claim and job transition via `/relay/api/v1/*` against the local DB, and requeues the job when the Cell is killed.
     - Connected Factory (`credential !== null`) relays Cell traffic to HQ and refuses direct `/api/v1/*` local engine calls with `409`.

## Acceptance Criteria

- [ ] Disconnected Factory (`hq.kind === 'not_connected'`) allows scaling Cells and processes `/relay/api/v1/cells/claims`, `/relay/api/v1/cells/heartbeats`, `/relay/api/v1/jobs/:id/transitions`, and `/relay/api/v1/incidents/:id/resolve` locally.
- [ ] Killing a Cell in standalone mode triggers gone-Cell cleanup in the local DB.
- [ ] Connected Factory refuses local `/api/v1/*` supervisor calls with `409` and continues relaying Cell traffic to HQ.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
