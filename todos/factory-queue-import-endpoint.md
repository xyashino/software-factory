---
status: queued
priority: high
line: feature
type: feat
plan: standalone-factory
depends_on: factory-local-engine
---

# factory-queue-import-endpoint: move todos import action to apps/factory server

## Objective

Add `POST /queue/import` to `apps/factory` (`@repo/factory`) and `@repo/factory-contracts` so the Factory server reads `<repo>/.factory/config.json` and `<dir>/*.md`, importing to its local execution DB when `local: true` or forwarding to HQ when connected.

## Context

Part of [`docs/standalone-factory-plan.md`](../docs/standalone-factory-plan.md).

Verified current behavior:

- `apps/sf/src/application/procedures/todos/import.procedure.ts` reads `.factory/config.json` and `todos/*.md` in the CLI, parses frontmatter with `parseTodo` / `renderTodo`, and sends `{ commandId, projectId, mode: 'apply', files }` to `POST /api/v1/queue/import` on HQ.
- Under `HQ <-> Factory <-> Cells`, `apps/factory` sits on the local machine with filesystem access to `<repo>/todos/*.md` and `.factory/config.json`.

## Scope

- **Target**: `packages/factory-contracts`, `apps/factory`
- **Classification**: `Domain Core`, `Integration`
- **Dependencies**: `@repo/factory-contracts: workspace:*`, `@repo/hq-contracts: workspace:*`
- **Out of scope**: Updating `apps/sf` CLI commands to pass `--local` (handled in `sf-local-mode-cli`).

## Implementation Plan

1. **Contract (`packages/factory-contracts/src/queue.contract.ts`)**:
   - `FactoryImportRequestSchema`:
     ```ts
     z.object({
       repoRoot: z.string().min(1),
       dir: z.string().min(1).optional(),
       dryRun: z.boolean().default(false),
       paused: z.boolean().default(false),
       local: z.boolean().default(false),
     }).strict();
     ```
   - `FactoryImportReplySchema`: `{ mode: 'dry_run' | 'apply', projectId, sent: string[], skipped: { filename, reason }[], created, updated, unchanged, paused, errors: { filename, message }[] }`.
2. **Mode Gate in `apps/factory` (`POST /queue/import`)**:
   - If `input.local === true` and `credential !== null`: refuse with `409 Conflict` (`factory is connected to HQ; disconnect or omit --local`).
   - If `input.local === false` and `credential === null`: refuse with `409 Conflict` (`factory not connected to HQ: pass --local or run "sf factory connect"`).
   - If `input.local === false` and `hq.state().kind !== 'ok'`: refuse with `503` (`HQ unreachable`) or `409` (`HQ rejected credential`).
3. **Server-Side File Reading & Dispatch**:
   - Read `<repoRoot>/.factory/config.json` to resolve `projectId` (refuse `400` if missing or invalid).
   - Read markdown files from `dir ?? join(repoRoot, 'todos')`, apply `paused` frontmatter override in memory (without modifying disk files), and collect `sent` and `skipped` (`no line` or frontmatter parse errors).
   - If `dryRun === true`, return the preview counts without writing.
   - If `local === true`: auto-upsert `projectId` in the local SQLite engine if not present, then invoke `POST /api/v1/queue/import` on `localEngine`.
   - If `local === false`: forward `{ commandId, projectId, mode: 'apply', files: sent }` to HQ `POST /api/v1/queue/import` (using the supervisor token passed in `authorization` header or Factory HQ link).
4. **Tests**:
   - Black-box tests in `apps/factory/test/blackbox/queue-import.test.ts`:
     - Standalone Factory imports `todos/*.md` with `local: true` and creates queued work orders in local DB.
     - Standalone Factory rejects `local: false` with `409`.
     - Connected Factory rejects `local: true` with `409` and forwards `local: false` to HQ.

## Acceptance Criteria

- [ ] `POST /queue/import` on `apps/factory` reads `<repo>/todos/*.md`, validates frontmatter, and imports into local SQLite when `local: true`.
- [ ] Connected Factory refuses `local: true` (`409`) and forwards `local: false` to HQ.
- [ ] Disconnected Factory refuses `local: false` (`409`).
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
