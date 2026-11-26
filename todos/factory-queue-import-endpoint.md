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

Add `POST /queue/import` to `apps/factory` (`@repo/factory`) and `@repo/factory-contracts` so Factory reads `<repo>/.factory/config.json` and `<dir>/*.md` and imports directly into its local execution DB with no local-vs-HQ split-brain flag.

## Context

Part of [`docs/plans/standalone-factory-plan.md`](../docs/plans/standalone-factory-plan.md). Factory owns repo execution locally; HQ receives synced projections asynchronously when connected.

Verified current behavior:

- `apps/sf/src/application/procedures/todos/import.procedure.ts` reads `.factory/config.json` and `todos/*.md` in CLI, parses frontmatter with `parseTodo` / `renderTodo`, and posts `{ commandId, projectId, mode: 'apply', files }` to `POST /api/v1/queue/import`.
- `apps/factory` runs on local host with direct filesystem access to `<repo>/todos/*.md` and `.factory/config.json`.

## Scope

- **Target**: `packages/factory-contracts`, `apps/factory`
- **Classification**: `Domain Core`, `Integration`
- **Dependencies**: `@repo/factory-contracts: workspace:*`, `@repo/hq-contracts: workspace:*`
- **Out of scope**: Updating `apps/sf` CLI default targeting (`sf-local-mode-cli`) and syncing imported projections to HQ (`hq-thin-bridge-sync-and-outbox`).

## Implementation Plan

1. **Contract (`packages/factory-contracts/src/queue.contract.ts`)**:
   - `FactoryImportRequestSchema`:
     ```ts
     z.object({
       repoRoot: z.string().min(1),
       dir: z.string().min(1).optional(),
       dryRun: z.boolean().default(false),
       paused: z.boolean().default(false),
     }).strict();
     ```
   - `FactoryImportReplySchema`: `{ mode: 'dry_run' | 'apply', projectId, sent: string[], skipped: { filename, reason }[], created, updated, unchanged, paused, errors: { filename, message }[] }`.
2. **Server-Side File Reading & Local Import (`POST /queue/import`)**:
   - Read `<repoRoot>/.factory/config.json` to resolve `projectId` (refuse `400` if missing or invalid).
   - Read markdown files from `dir ?? join(repoRoot, 'todos')`, apply `paused` frontmatter override in memory without modifying disk files, collect `sent` and `skipped` (`no line` or parse errors).
   - If `dryRun === true`, return preview counts without DB writes.
   - Auto-upsert `projectId` in local SQLite engine if absent, then invoke `POST /api/v1/queue/import` on `localEngine`.
   - Succeeds identically whether HQ credential exists or not (no `409` mode refusal).
3. **Tests**:
   - Black-box tests in `apps/factory/test/blackbox/queue-import.test.ts`:
     - Factory imports `todos/*.md` into local SQLite engine and creates queued work orders.
     - `dryRun: true` reports counts and errors without mutating DB.
     - Missing `.factory/config.json` returns `400`.

## Acceptance Criteria

- [ ] `POST /queue/import` on `apps/factory` reads `<repo>/todos/*.md`, validates frontmatter, and imports into local SQLite.
- [ ] Works identically whether Factory is connected to HQ or standalone (no `local` flag, no `409` split-brain).
- [ ] `dryRun: true` previews without writing to DB.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
