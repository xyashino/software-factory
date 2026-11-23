# Standalone Factory Plan

## Goal

Extract `apps/factory` (`@repo/factory`) as standalone Bun backend server (`127.0.0.1:7072`) with wire contracts in `packages/factory-contracts` (`@repo/factory-contracts`). Enforce strict chain `HQ <-> Factory <-> Cells` and support standalone local execution (`--local`) without an HQ server.

## Verified facts

- `apps/sf/src/factory/` currently holds 6 files (`index.ts`, `routes.ts`, `relay.ts`, `scaler.ts`, `supervisor.ts`, `hq-link.ts`) and unit tests in `apps/sf/test/unit/factory/` (`hq-link.test.ts`, `scaler.test.ts`, `supervisor.test.ts`).
- `apps/sf/src/bootstrap/entry-dispatch.ts` dispatches `HQ_MARKER` (`__server`) to `../../../hq/src/index` and `FACTORY_DAEMON_MARKER` (`__factory-daemon`) to `../factory/index`.
- `apps/hq` (`@repo/hq`) holds the execution engine (`createApp`, `createTransport`, `createDb` on SQLite via `@repo/bun-sqlite-kit`) for projects, plans, work orders, queue import/export/actions, cell claims/heartbeats, job transitions, incidents, and SSE stream (`/api/v1/*`).
- `apps/sf/src/factory/index.ts` blocks Cell startup when not connected to HQ (`gateOf`: `factory not connected: run "sf factory connect"`), and `relay.ts` returns `503` when `credential === null`.
- `apps/sf/src/application/procedures/todos/import.procedure.ts` reads `todos/*.md` in the CLI and posts directly to `ctx.hq.call('/api/v1/queue/import', ...)`.

## Decisions

1. **Contracts**: `packages/factory-contracts` (`@repo/factory-contracts`) defines Zod schemas for Factory loopback routes (`/health`, `/status`, `/scale`, `/cells/:cellId/activity`, `/queue/import`) and shared Factory state (`HqStateSchema`, `DaemonStatusSchema`, `FactoryCredentialSchema`).
2. **Standalone `apps/factory` package**: Move `apps/sf/src/factory/*` into `apps/factory/src/`. `apps/sf` embeds `../../../factory/src/index` on `__factory-daemon`, matching `../../../hq/src/index` on `__server`.
3. **Local execution engine in `apps/factory`**:
   - `apps/factory` opens local SQLite `$XDG_DATA_HOME/sf/factory-local.db` via `createDb` and mounts a local execution app (`createApp` + loopback principal with `supervisor:read`, `supervisor:write`, `factory:worker`).
   - When `credential === null` (`hq.state().kind === 'not_connected'`), `gateOf` allows Cells to start, `relay.ts` routes Cell `/api/v1/cells/*`, `/api/v1/jobs/*`, `/api/v1/incidents/*` to the local execution app, and `onStopped` runs gone-Cell cleanup against the local DB.
   - When `credential !== null` (connected to HQ), `apps/factory` relays Cell calls upstream to HQ as before.
4. **Server-side import and `--local` routing**:
   - `POST /queue/import` on `apps/factory` accepts `{ repoRoot, dir?, mode, paused?, local }`, reads `.factory/config.json` and `<dir>/*.md` on the server, auto-upserts the project locally when `local: true`, and either runs the import in local SQLite (`local: true`) or forwards to HQ (`local: false`).
   - Connected Factory refuses `local: true` with `409 Conflict` (`factory is connected to HQ; disconnect or omit --local`). Standalone Factory without `--local` refuses with `409 Conflict` (`factory not connected: pass --local or run "sf factory connect"`).
   - `sf todos import|export`, `sf queue`, `sf order`, `sf incident`, and `sf watch` accept `--local` to target `apps/factory` (`/api/v1/*` on `127.0.0.1:7072`, no supervisor token file needed) and refuse `--local` when `apps/factory` is connected to HQ.

## Work order chain

| Order | Slug | Line | Depends on | Target | Summary |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `factory-contracts-package` | `standard` | - | `packages/factory-contracts`, `apps/sf` | Create `@repo/factory-contracts` for Factory loopback schemas and state types |
| 2 | `factory-app-extract` | `standard` | `factory-contracts-package` | `apps/factory`, `apps/sf`, `turbo.json` | Extract `apps/sf/src/factory/*` into standalone `@repo/factory` workspace app |
| 3 | `factory-local-engine` | `standard` | `factory-app-extract` | `apps/factory`, `apps/hq` | Embed local SQLite execution engine in `apps/factory` for standalone Cell runs |
| 4 | `factory-queue-import-endpoint` | `standard` | `factory-local-engine` | `apps/factory`, `packages/factory-contracts` | Add `POST /queue/import` on `apps/factory` with `--local` vs HQ forwarding gate |
| 5 | `sf-local-mode-cli` | `standard` | `factory-queue-import-endpoint` | `apps/sf`, `docs` | Add `--local` flag to `sf todos`, `sf queue`, `sf order`, `sf incident`, `sf watch` |

## Risks

- **Split-brain prevention**: A Factory connected to HQ must never run local orders alongside HQ orders. Both `POST /queue/import` (`local: true`) and local `/api/v1/*` supervisor routes reject requests with `409` when `credential !== null`.
- **Single-binary compile (`build:sf`)**: `bun build --compile` in `apps/sf` bundles `../../../factory/src/index` and `../../../hq/src/index`; `apps/sf/tsconfig.json` and `turbo.json` inputs must include `apps/factory`.
