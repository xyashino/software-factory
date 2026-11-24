---
status: queued
priority: medium
line: standard
type: refactor
---

# sf-orders-nomenclature: migrate todos folder and sf todos CLI to orders and sf order

## Objective

Align work-order file storage and CLI commands with the domain glossary by adopting `orders/*.md` and `sf order import|export`, while keeping `todos/` and `sf todos` as deprecated fallbacks.

## Context

- The domain glossary (`docs/README.md`), HQ schema (`apps/hq/src/db/schema/orders.ts`), HQ routes (`/api/v1/work-orders`), and CLI (`apps/sf/src/adapters/cli/order.command.ts`) name the entity **Work order** (`order` / `orders`).
- File import/export still defaults to `DEFAULT_TODO_DIR = 'todos'` (`apps/sf/src/config.ts:60`), exposes `sf todos import|export` (`apps/sf/src/adapters/cli/todos.command.ts`), and lints `TODOS_DIR = 'todos'` (`scripts/lint-todos.ts:9`).
- `apps/sf/src/adapters/cli/legacy.command.ts` already provides `deprecatedAlias` for migrating old top-level commands (`sf server` -> `sf hq`) with a single `deprecated: use "..."` stderr line.

## Scope

- **Target**: `apps/sf/src/config.ts`, `apps/sf/src/adapters/cli/{order,todos,legacy}.command.ts`, `apps/sf/src/cli.ts`, `apps/sf/test`, `scripts/lint-todos.ts`, `docs/README.md`, `docs/sf.md`
- **Classification**: `Universal Tooling`, `CLI`
- **Dependencies**: `@repo/hq-contracts: workspace:*`
- **Out of scope**: HQ database column names or REST endpoint paths (`/api/v1/queue/import`, `/api/v1/queue/export`).

## Implementation Plan

1. **Default directory resolution (`apps/sf/src/config.ts`, `apps/sf/src/adapters/cli/todos.command.ts`)**:
   - Define `DEFAULT_ORDER_DIR = 'orders'` (keeping `DEFAULT_TODO_DIR = 'todos'` as fallback).
   - When `--dir` is not explicitly passed to `import` or `export`, resolve `'orders'` if present on disk (or for `export` when neither directory exists), falling back to `'todos'` when `'orders'` is absent and `'todos'` exists.
2. **CLI subcommands (`apps/sf/src/adapters/cli/order.command.ts`, `legacy.command.ts`, `cli.ts`)**:
   - Mount `import` and `export` subcommands under `orderCommand` (`sf order import`, `sf order export`).
   - Move top-level `todos` into `legacyCommands` in `apps/sf/src/adapters/cli/legacy.command.ts` using `deprecatedAlias` so `sf todos import` prints `deprecated: use "sf order import"` to stderr and delegates to `sf order import` (and likewise for `sf todos export`).
3. **Linter and repository folder (`scripts/lint-todos.ts`)**:
   - Update `scripts/lint-todos.ts` to check `orders/` when present (and `todos/` when present) so both directories are linted cleanly during migration.
4. **Docs and tests (`docs/README.md`, `docs/sf.md`, `apps/sf/test/`)**:
   - Update `docs/README.md` and `docs/sf.md` command tables and deprecated-names table to list `sf order import|export` and `orders/*.md`.
   - Add black-box CLI tests in `apps/sf/test/blackbox/todos-queue.test.ts` and `apps/sf/test/blackbox/hq-names.test.ts` verifying `sf order import|export` and the `sf todos import|export` deprecation notice.

## Acceptance Criteria

- [ ] `sf order import` and `sf order export` work without deprecation warnings and prefer `orders/` with fallback to `todos/`.
- [ ] `sf todos import` and `sf todos export` print `deprecated: use "sf order import"` / `deprecated: use "sf order export"` to stderr and preserve exit codes and stdout.
- [ ] `bun run todo:lint` validates work-order markdown files in `orders/` and `todos/`.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
