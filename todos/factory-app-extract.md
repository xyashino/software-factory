---
status: queued
priority: high
line: feature
type: refactor
plan: standalone-factory
depends_on: factory-contracts-package
---

# factory-app-extract: extract local Factory server into apps/factory

## Objective

Move the Factory daemon from `apps/sf/src/factory/*` into a standalone workspace package `apps/factory` (`@repo/factory`), wired into `apps/sf` via `entry-dispatch.ts` just like `apps/hq`.

## Context

Part of [`docs/standalone-factory-plan.md`](../docs/standalone-factory-plan.md).

Verified current paths:

- `apps/sf/src/factory/` contains `index.ts`, `routes.ts`, `relay.ts`, `scaler.ts`, `supervisor.ts`, `hq-link.ts`.
- `apps/sf/test/unit/factory/` contains `hq-link.test.ts`, `scaler.test.ts`, `supervisor.test.ts`.
- `apps/sf/src/bootstrap/entry-dispatch.ts` imports `../../../hq/src/index` for `HQ_MARKER` (`__server`) and `../factory/index` for `FACTORY_DAEMON_MARKER` (`__factory-daemon`).
- `apps/sf/src/config.ts` defines `FACTORY_DAEMON_ENTRY = fileURLToPath(new URL('./factory/index.ts', import.meta.url))`.

## Scope

- **Target**: `apps/factory`, `apps/sf`, `turbo.json`, `docs`
- **Classification**: `Infrastructure`, `Integration`
- **Dependencies**: `@repo/factory-contracts: workspace:*`, `@repo/hq-contracts: workspace:*`, `zod: catalog:`
- **Out of scope**: Local SQLite execution engine (`factory-local-engine`) and `--local` CLI flag (`sf-local-mode-cli`).

## Implementation Plan

1. **Create `apps/factory` (`@repo/factory`)**:
   - Create `apps/factory/package.json` (`name: "@repo/factory"`, scripts `check-types`, `lint`, `test`), `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, and `README.md` pointing to `../../docs/README.md`.
   - Move `apps/sf/src/factory/{index,routes,relay,scaler,supervisor,hq-link}.ts` into `apps/factory/src/`.
   - Move `apps/sf/test/unit/factory/{hq-link,scaler,supervisor}.test.ts` into `apps/factory/test/unit/`.
2. **Decouple `apps/factory` from `apps/sf` CLI internals**:
   - Define narrow Factory ports (`ProcessPort`, `ClockPort`, `HqLinkPort`, `CredentialStorePort`, `PidFilePort`, `RepoConfigPort`) and local error classes (`ArgumentError`, `Refused`, `Unreachable`) inside `apps/factory/src/` (or adapters wired in `apps/factory/src/bootstrap.ts`) so `apps/factory` does not import `apps/sf/src/bootstrap/context.ts`.
   - Keep `cellNameOf` and launcher resolution self-contained in `apps/factory`.
3. **Wire `apps/sf` dispatch and build**:
   - Update `apps/sf/src/config.ts`: point `FACTORY_DAEMON_ENTRY` to `../../factory/src/index.ts`.
   - Update `apps/sf/src/bootstrap/entry-dispatch.ts`: `FACTORY_DAEMON_MARKER` dynamically imports `../../../factory/src/index`.
   - Update `apps/sf/tsconfig.json` and `turbo.json` if needed so `bun run build:sf` and `bun run ci:verify` compile and typecheck `apps/factory`.
4. **Update docs**:
   - Update `docs/architecture.md`, `docs/README.md`, `docs/cell.md`, and `docs/hq-factory-cell-plan.md` to list `apps/factory` as the local Factory daemon package.

## Acceptance Criteria

- [ ] `apps/factory` (`@repo/factory`) exists and owns the Factory server code and unit tests; `apps/sf/src/factory/` is removed.
- [ ] `sf factory start`, `sf factory status`, `sf factory stop`, and `sf cell scale` work identically against `apps/factory`.
- [ ] `bun run build:sf` compiles a single `sf` binary that dispatches `__factory-daemon` to `apps/factory/src/index.ts`.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
