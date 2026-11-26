# Standalone Factory Plan

## Goal

Extract `apps/factory` (`@repo/factory`) as standalone Bun backend server (`127.0.0.1:7072`) with wire contracts in `packages/factory-contracts` (`@repo/factory-contracts`). Enforce strict chain `HQ <-> Factory <-> Cells` and support standalone local execution (`--local`) without HQ server.

## Verified Facts

- `apps/sf/src/factory/` holds 6 files (`index.ts`, `routes.ts`, `relay.ts`, `scaler.ts`, `supervisor.ts`, `hq-link.ts`) and unit tests in `apps/sf/test/unit/factory/`.
- `apps/sf/src/bootstrap/entry-dispatch.ts` dispatches `HQ_MARKER` (`__server`) to `../../../hq/src/index` and `FACTORY_DAEMON_MARKER` (`__factory-daemon`) to `../factory/index`.
- `apps/hq` (`@repo/hq`) holds execution engine (`createApp`, `createTransport`, `createDb` on SQLite via `@repo/bun-sqlite-kit`).
- `apps/sf/src/factory/index.ts` blocks Cell startup when not connected to HQ, and `relay.ts` returns `503` when `credential === null`.
- `apps/sf/src/application/procedures/todos/import.procedure.ts` reads `todos/*.md` in CLI and posts directly to `ctx.hq.call('/api/v1/queue/import', ...)`.

## Decisions

1. **Contracts**: `packages/factory-contracts` (`@repo/factory-contracts`) defines Zod schemas for Factory loopback routes (`/health`, `/status`, `/scale`, `/cells/:cellId/activity`, `/queue/import`) and shared Factory state.
2. **Standalone `apps/factory` package**: Move `apps/sf/src/factory/*` into `apps/factory/src/`. `apps/sf` embeds `../../../factory/src/index` on `__factory-daemon`.
3. **Local execution engine in `apps/factory`**:
   - Opens local SQLite `$XDG_DATA_HOME/sf/factory-local.db` via `createDb` and mounts local execution app (`createApp` + loopback principal).
   - When `credential === null`, allows Cells to start, routes Cell `/api/v1/*` to local execution app, runs gone-Cell cleanup locally.
   - When `credential !== null`, relays Cell calls upstream to HQ.
4. **Server-side import and `--local` routing**:
   - `POST /queue/import` on `apps/factory` accepts `{ repoRoot, dir?, mode, paused?, local }`.
   - Connected Factory refuses `local: true` with `409 Conflict`. Standalone Factory without `--local` refuses with `409 Conflict`.
   - `sf todos import|export`, `sf queue`, `sf order`, `sf incident`, `sf watch` accept `--local` to target `apps/factory` (`127.0.0.1:7072`).

## Work Order Chain

| Order | Slug | Line | Depends on | Target | Summary |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `factory-contracts-package` | `standard` | - | `packages/factory-contracts`, `apps/sf` | Create `@repo/factory-contracts` for Factory loopback schemas |
| 2 | `factory-app-extract` | `standard` | `factory-contracts-package` | `apps/factory`, `apps/sf`, `turbo.json` | Extract `apps/sf/src/factory/*` into `@repo/factory` |
| 3 | `factory-local-engine` | `standard` | `factory-app-extract` | `apps/factory`, `apps/hq` | Embed local SQLite execution engine in `apps/factory` |
| 4 | `factory-queue-import-endpoint` | `standard` | `factory-local-engine` | `apps/factory`, `packages/factory-contracts` | Add `POST /queue/import` on `apps/factory` with `--local` gate |
| 5 | `sf-local-mode-cli` | `standard` | `factory-queue-import-endpoint` | `apps/sf`, `docs` | Add `--local` flag to `sf todos`, `sf queue`, `sf order`, `sf incident`, `sf watch` |

## Risks

- **Split-brain prevention**: Connected Factory must reject `local: true` and local supervisor routes with `409`.
- **Single-binary compile (`build:sf`)**: `bun build --compile` in `apps/sf` bundles both `apps/factory` and `apps/hq`.
