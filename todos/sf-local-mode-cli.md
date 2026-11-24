---
status: queued
priority: high
line: feature
type: feat
plan: standalone-factory
depends_on: factory-queue-import-endpoint
---

# sf-local-mode-cli: add --local flag to sf todos, queue, order, incident, and watch commands

## Objective

Update `apps/sf` so `sf todos import|export`, `sf queue`, `sf order`, `sf incident`, and `sf watch` accept `--local` to execute against the local `apps/factory` server (`127.0.0.1:7072`) without an HQ server or supervisor token file.

## Context

Part of [`docs/standalone-factory-plan.md`](../docs/standalone-factory-plan.md).

Verified current behavior:

- `apps/sf/src/adapters/cli/todos.command.ts` runs `importTodos` and `exportTodos` against `ctx.hq` (`apps/sf/src/application/procedures/todos/{import,export}.procedure.ts`).
- `apps/sf/src/adapters/cli/{queue,order,incident,watch}.command.ts` call `readSecret(ctx)` (`apps/sf/src/application/core/repo-access.ts`), which requires a supervisor token file (`.factory-local/supervisor.token` or `$XDG_CONFIG_HOME/sf/config.json`) and targets `ctx.hq`.
- With `factory-local-engine` and `factory-queue-import-endpoint`, `apps/factory` exposes `POST /queue/import` and `/api/v1/*` on loopback (`127.0.0.1:7072`) when not connected to HQ, and refuses `--local` with `409 Conflict` when connected to HQ.

## Scope

- **Target**: `apps/sf`, `docs`
- **Classification**: `Integration`
- **Dependencies**: `@repo/factory-contracts: workspace:*`, `@repo/hq-contracts: workspace:*`
- **Out of scope**: Changes to `apps/hq` or `apps/web-demo`.

## Implementation Plan

1. **`sf todos import [--local]` (`apps/sf/src/adapters/cli/todos.command.ts`, `import.procedure.ts`)**:
   - Add `local: { type: 'boolean', default: false }` flag to `sf todos import` and `sf todos export`.
   - When `local: true`, `importTodos` calls `ctx.factory.post('/queue/import', { repoRoot, dir, dryRun, paused, local: true })` (no supervisor token required).
   - When `local: false` and `apps/factory` is running and connected to HQ, forward via `ctx.factory.post('/queue/import', { repoRoot, dir, dryRun, paused, local: false })` (or fallback to `ctx.hq` when targeting remote HQ directly).
2. **`--local` targeting for `sf queue`, `sf order`, `sf incident`, `sf watch`**:
   - Add `--local` boolean flag to:
     - `sf queue list|pause|unpause|reset|cancel|reprioritise` (`apps/sf/src/adapters/cli/queue.command.ts`)
     - `sf order show|resume|reopen|cancel` (`apps/sf/src/adapters/cli/order.command.ts`)
     - `sf incident list|show|resolve` (`apps/sf/src/adapters/cli/incident.command.ts`)
     - `sf watch` (`apps/sf/src/adapters/cli/watch.command.ts`)
   - In procedures (`queue/{list,actions}.procedure.ts`, `work-orders/{show,transition}.procedure.ts`, `incidents/{list,resolve}.procedure.ts`, `watch/stream.procedure.ts`, `todos/export.procedure.ts`), when `local: true`:
     - Target `FACTORY_DAEMON_URL` (`http://127.0.0.1:7072`) instead of `ctx.hq` (`connection.url`) and skip `readSecret(ctx)` (use loopback bearer `'local'`).
     - If `apps/factory` is not running, surface `factory not running: run "sf factory start"`.
     - If `apps/factory` is connected to HQ, `apps/factory` returns `409` (`factory is connected to HQ; disconnect or omit --local`), which `sf` reports with `EXIT.refused`.
3. **Update docs**:
   - Document `--local` workflow (`sf factory start` -> `sf todos import --local` -> `sf cell scale 1` -> `sf queue list --local`) in `docs/sf.md`, `docs/cell.md`, and `docs/architecture.md`.
4. **Tests**:
   - Black-box CLI/procedure tests in `apps/sf/test/`:
     - `sf todos import --local` and `sf queue list --local` succeed against a standalone Factory without `.factory-local/supervisor.token`.
     - Passing `--local` when Factory is connected to HQ exits with `EXIT.refused` (`409`).

## Acceptance Criteria

- [ ] `sf todos import --local`, `sf todos export --local`, `sf queue * --local`, `sf order * --local`, `sf incident * --local`, and `sf watch --local` talk to local `apps/factory` without requiring an HQ server or supervisor token.
- [ ] Running any `--local` command while `apps/factory` is connected to HQ fails with `EXIT.refused` (`factory is connected to HQ; disconnect or omit --local`).
- [ ] Docs (`docs/sf.md`, `docs/cell.md`, `docs/architecture.md`) cover standalone `--local` mode and `HQ <-> Factory <-> Cells` connected mode.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
