---
status: todo
priority: high
depends_on: [passive-server-02-drizzle-stores]
line: feature
factory: v2
plan: passive-server
---

# passive-server-03: Server stores tasks, Lines and Operators; API to create and update them

## Objective

The server is the store for the four things it owns: **tasks** (Work orders and Order Plans), **workflows** (Lines), **agents** (Operator profiles and their prompt templates) and **state** (already stored). Add Drizzle tables and API routes so tasks, Lines and Operators are created through the API, and the runtime reads Lines and Operators from the database instead of from `packages/factory-definitions/` on disk.

## Read first

- `docs/PLAN.md`, `docs/CORE.md` (Line snapshot pinning), `docs/PROTOCOL.md` (§1, §3, §4, §8.3), `docs/STORAGE.md`
- `packages/factory-db/src/schema.ts`, `orders-table.ts`, `plans-table.ts`, `sqlite-blob-store.ts`
- `packages/factory-definitions/src/load.ts` (`Definitions`), `line-schema.ts`, `line-validate.ts`, `line-snapshot.ts`, `operator-profile.ts`, `templates.ts`
- `packages/factory-core/src/contracts/routes.ts`, `http-routes.ts`, `supervisor.ts`, `job.ts`
- `packages/factory-core/src/order/commands.ts`, `events.ts`, `decide-lifecycle.ts`; `plan/commands.ts`
- `packages/factory-runtime/src/open-runtime.ts`, `ports.ts`, `operations.ts`, `job-builder.ts`, `intake.ts`, `plan-commands.ts`
- `apps/cell/src/jobs/deliver.ts`

## Deliverables

1. **Tables (`schema.ts` + generated migration):**
   - `lines`: `name`, `version` (monotonic per name), `definition` (validated JSON), `content_hash`, `created_at`, `created_by`; primary key (`name`, `version`). The latest version is the one new Work orders pin.
   - `operators`: same shape for Operator profiles (profile id, version, frontmatter JSON, prompt body blob).
   - `templates`: supervisor prompt templates and PR templates, versioned the same way.
   - Runtime prompts (`templates/runtime/`) are the factory's own protocol text: they stay bundled with the server, not stored.
2. **Contracts (`packages/factory-core`):** routes under `auth: 'supervisor'`, each idempotent by `commandId`:
   - `POST /v1/orders` (`createOrder`: `projectId`, `todoId`, `title`, `type`, `body` markdown spec, `line`, `priority`, `dependsOn`, optional `plan`, optional `baseBranch`).
   - `POST /v1/plans` (`createPlan`: `projectId`, `slug`, optional `baseBranch`, ordered members validated as a linear chain).
   - `PUT /v1/lines/:name`, `GET /v1/lines`, `GET /v1/lines/:name[?version=]`.
   - `PUT /v1/operators/:id`, `GET /v1/operators`, `GET /v1/operators/:id`.
   - `PUT /v1/templates/:id`, `GET /v1/templates`.
   - `POST /v1/orders/:id/pr-state` (`recordPrState`: `open | merged | closed`) and the plan equivalent.
3. **Runtime (`packages/factory-runtime`):**
   - Replace the startup `loadDefinitions(DEFINITIONS_ROOT)` with a `DefinitionStore` port backed by the new tables. Validation on write reuses `factory-definitions` (`line-validate`, `operator-profile`, cross-checks such as "every Line operator profile exists"); a write that breaks a stored Line is refused.
   - `createOrder` / `createPlan` store the spec body as a blob, compute `contentHash`, validate project and Line, pin the Line snapshot (as intake does today), and append through `CommandHandler`, waking waiting Cells.
   - `job-builder.ts` takes Operator profiles and templates from the store at the version the Work order pinned, so editing an Operator never changes a Cycle in flight.
   - `deliver.removeTodo` becomes optional in `jobSchema`; API-created orders omit it and `apps/cell/src/jobs/deliver.ts` skips deleting a todo file when it is absent.
4. **Seeding:** an empty database gets no definitions automatically; `passive-server-05` adds the CLI that uploads them. Tests use a fixture helper that seeds the store from `packages/factory-definitions/src/__tests__/fixtures/valid`.
5. **Tests:** contract tests for every route (validation, idempotency, versioning, refused invalid Line/Operator), pinning (order created on Line v1 keeps v1 after v2 is pushed), and a Cell delivering an API-created order end to end.
6. **Docs:** `docs/PLAN.md` (server owns tasks, Lines, Operators, state), `docs/PROTOCOL.md` route table, `docs/STORAGE.md` §4 new tables.

## Acceptance criteria

- [ ] A Work order and an Order Plan created via the API are claimed, executed and delivered with no `todos/*.md` in the repository.
- [ ] Lines and Operators are read from the database; the server no longer reads `packages/factory-definitions/lines` or `operators` at runtime.
- [ ] Pushing a new Line or Operator version never changes a Work order already in flight.
- [ ] `pnpm ci:verify` passes.
