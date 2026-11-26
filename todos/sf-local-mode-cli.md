---
status: queued
priority: high
line: feature
type: feat
plan: standalone-factory
depends_on: factory-queue-import-endpoint
---

# sf-local-mode-cli: target local apps/factory by default in sf CLI commands

## Objective

Update `apps/sf` so `sf todos import|export`, `sf queue`, `sf order`, `sf incident`, and `sf watch` target local `apps/factory` (`127.0.0.1:7072`) by default without HQ server or supervisor token file, while allowing optional `--hq` flag to target remote HQ explicitly.

## Context

Part of [`docs/plans/standalone-factory-plan.md`](../docs/plans/standalone-factory-plan.md). Local Factory is default execution engine; no `--local` ceremony needed on every CLI command.

Verified current behavior:

- `apps/sf/src/adapters/cli/todos.command.ts` runs `importTodos` and `exportTodos` against `ctx.hq` (`apps/sf/src/application/procedures/todos/{import,export}.procedure.ts`).
- `apps/sf/src/adapters/cli/{queue,order,incident,watch}.command.ts` call `readSecret(ctx)` (`apps/sf/src/application/core/repo-access.ts`), which requires `.factory-local/supervisor.token` or `$XDG_CONFIG_HOME/sf/config.json` and targets `ctx.hq`.
- With `factory-local-engine` and `factory-queue-import-endpoint`, `apps/factory` exposes `POST /queue/import` and `/api/v1/*` on loopback `127.0.0.1:7072`.

## Scope

- **Target**: `apps/sf`, `docs`
- **Classification**: `Integration`
- **Dependencies**: `@repo/factory-contracts: workspace:*`, `@repo/hq-contracts: workspace:*`
- **Out of scope**: Changes to `apps/hq` or `apps/web-demo`.

## Implementation Plan

1. **Default Local Factory Routing (`apps/sf/src/adapters/cli/` and `procedures/`)**:
   - Route `sf todos import|export`, `sf queue list|pause|unpause|reset|cancel|reprioritise`, `sf order show|resume|reopen|cancel`, `sf incident list|show|resolve`, and `sf watch` to `FACTORY_DAEMON_URL` (`http://127.0.0.1:7072`) by default with loopback bearer `'local'` (skip `readSecret(ctx)`).
   - For `sf todos import`, call `ctx.factory.post('/queue/import', { repoRoot, dir, dryRun, paused })`.
   - If `apps/factory` is unreachable, surface clear actionable error: `factory not running: run "sf factory start"`.
2. **Optional `--hq` Explicit Target**:
   - Add `hq: { type: 'boolean', default: false }` flag to the commands above.
   - When `--hq` is passed, resolve `connection.url` and `readSecret(ctx)` and call HQ directly (preserving existing remote HQ supervisor behavior).
3. **Update Docs**:
   - Update `docs/apps/sf.md` and `docs/features/cells-and-factory.md` for local-first workflow (`sf factory start` -> `sf todos import` -> `sf cell scale 1` -> `sf queue`) and optional `--hq` override.
4. **Tests**:
   - Black-box CLI/procedure tests in `apps/sf/test/`:
     - Default `sf todos import`, `sf queue`, `sf order`, `sf incident` succeed against local Factory without `.factory-local/supervisor.token` or HQ.
     - Passing `--hq` targets configured HQ URL and uses supervisor token.
     - Stopped Factory prints `factory not running: run "sf factory start"`.

## Acceptance Criteria

- [ ] `sf todos`, `sf queue`, `sf order`, `sf incident`, and `sf watch` target local `apps/factory` by default without HQ or supervisor token.
- [ ] `--hq` flag routes commands to configured HQ server with supervisor token.
- [ ] Stopped Factory surfaces clear startup hint.
- [ ] Docs reflect local-first default workflow.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
