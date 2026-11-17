---
status: todo
priority: high
depends_on: []
line: feature
type: feat
---

# Todo: `01-foundation-and-db` — Package Scaffold, Drizzle SQLite Schema & Core Procedure Harness

## 🎯 Objective

Bootstrap `apps/factory-server` (`@repo/factory-server`) following `BE_RULES.md` and `.tmp/omino-api`: package setup, branded IDs, time/event primitives, `bun:sqlite` + Drizzle ORM schema with all 8 tables and 3 partial unique indexes (`PLAN.md` §7), `application/core` (`procedure`, `error-handling`, `withZodSchema`), Hono adapter/middlewares, and `createTestApp()` harness.

---

## 🌐 Context & Problem Statement

`@repo/factory-server` requires a zero-ambiguity foundation before domain slices (`tokens`, `projects`, `queue`, `cells`, `jobs`, `incidents`) are built. Without the `omino-api` procedure/contract pipeline, `immediateTx` SQLite wrapper, and partial unique indexes enforcing single-Cell exclusivity at the database level, later slices would duplicate validation, error formatting, and transaction boilerplate.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/`
- **Boundary**: Strictly backend-only inside `apps/factory-server/` (do not connect or edit `apps/cell`, `apps/cli`, or `packages/factory-*`; simulate Cell/Supervisor HTTP calls via `app.request()` in `apps/factory-server/test/`).
- **Classification**: `Infrastructure` / `Domain Core`
- **Dependencies**:
  - `hono: catalog:`
  - `drizzle-orm: catalog:`
  - `zod: catalog:`
  - `yaml: catalog:`
  - `@repo/eslint-config: workspace:*` (dev)
  - `@repo/typescript-config: workspace:*` (dev)
  - `@types/bun: catalog:` (dev)
  - `@types/node: catalog:` (dev)
  - `drizzle-kit: catalog:` (dev)
  - `eslint: catalog:` (dev)
  - `typescript: catalog:` (dev)
  - `vitest: catalog:` (dev)

---

## 🛠️ Implementation Plan

1. **Initialize Package & Tooling (`apps/factory-server/`)**:
   - `package.json`, `tsconfig.json`, `eslint.config.mjs` (enforcing `func-style` arrow functions and `BE_RULES.md` layer boundaries), `vitest.config.ts`, `drizzle.config.ts`.
   - `src/config.ts`: timing constants from `PLAN.md` §3.7 (`CLAIM_WAIT_MS = 25_000`, `HEARTBEAT_INTERVAL_MS = 10_000`, `SELF_FENCE_MS = 45_000`, `LEASE_TTL_MS = 60_000`, `MAX_WORKTREE_RESETS = 2`, `MAX_MECHANIC_RUNS = 2`, `TOKEN_ROTATE_GRACE_MS = 60_000`).
2. **Pure Domain Primitives (`src/domain/common/`)**:
   - `brand.ts`: `Brand<K, T>` and branded types + constructors (`ProjectId`, `PlanId`, `OrderId`, `StepId`, `JobId`, `CellId`, `IncidentId`, `TokenId`, `CommandId`).
   - `time.ts`: epoch ms helpers (`addMs`, `isExpired`).
   - `events.ts`: `EntityType`, `ActorKind`, `StateTransitionInput`, and `StateTransitionRecord`.
3. **Database Layer (`src/db/`)**:
   - `columns.ts`: shared column helpers (`timestamps()`, `jsonColumn<T>()`).
   - `schema/projects.ts`, `schema/tokens.ts`, `schema/cells.ts`, `schema/plans.ts`, `schema/orders.ts` (`work_orders` + `order_steps`), `schema/jobs.ts`, `schema/incidents.ts`, `schema/transitions.ts` matching `PLAN.md` §7 column-for-column.
   - `migrations/0000_init.sql`: DDL for all 8 tables plus the 3 SQLite partial unique indexes (`idx_jobs_one_active_per_order`, `idx_jobs_one_active_per_cell`, `idx_work_orders_one_active_per_cell`) and `state_transitions.command_id` unique index.
   - `client.ts`: `createDb(sqlitePath)` configuring `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`, migration runner, and `immediateTx(db, fn)` (`BEGIN IMMEDIATE` wrapper).
4. **Application Core, Ports & Contracts (`src/contracts/`, `src/application/`)**:
   - `src/contracts/common.ts`: `errorResponse(code, type)`, `idSchema(brand)`, `paginationIn`, `pageOut(item)`.
   - `src/application/core/error-handling.ts`: `BaseError`, `BadRequest(400)`, `Unauthorized(401)`, `Forbidden(403)`, `NotFound(404)`, `Conflict(409)`, `StaleLeaseEpoch(409, 'stale-lease-epoch')`, `PayloadTooLarge(413)`, `UnprocessableEntity(422)`, `InternalServer(500)`.
   - `src/application/core/schema/types.ts` & `zod.ts`: `ZodContract`, `withZodSchema(contract)`.
   - `src/application/ports/`: `auth.port.ts` (`Principal`, `TokenScope`, `AuthPort`), `clock.port.ts` (`ClockPort`), `claim-waiters.port.ts` (`ClaimWaitersPort`), `transition-bus.port.ts` (`TransitionBusPort`).
   - `src/application/core/procedure.ts`: `TransportContext`, `publicProcedure`, `authenticatedProcedure`, `scopedProcedure(requiredScopes)`.
5. **Adapters, Bootstrap & Test Harness (`src/adapters/`, `src/bootstrap/`, `src/app.ts`, `test/`)**:
   - `src/adapters/memory/`: `system-clock.adapter.ts`, `claim-waiters.adapter.ts` (in-memory `Set<() => void>`), `transition-bus.adapter.ts`.
   - `src/adapters/hono/`: `types.ts`, `adapter.ts` (`honoAdapter`), `error-handlers.ts` (`errorHandler`, `notFoundHandler`), `middlewares.ts` (`requestId`, `noCache`, `payloadLimit`, `transportMiddleware`).
   - `src/bootstrap/transport.ts` & `src/app.ts`: `createTransport` and `createApp(createTransport)`.
   - `test/support/`: `test-db.ts`, `test-transport.ts` (controllable fake clock), `test-app.ts` (`createTestApp`, `postJson`, `getJson`).

---

## ✅ Acceptance Criteria

- [ ] All 8 SQLite tables (`projects`, `safe_tokens`, `cells`, `order_plans`, `work_orders`, `order_steps`, `jobs`, `incidents`, `state_transitions`) and 3 partial unique indexes from `PLAN.md` §7 are created and verified in `test/db/schema-indexes.test.ts`.
- [ ] Inserting two `claimed` or `running` jobs for the same `order_id` or same `cell_id`, or two `work_orders` with the same non-null `active_cell_id`, fails with a SQLite `UNIQUE` constraint error.
- [ ] `withZodSchema`, `honoAdapter`, `errorHandler`, and `notFoundHandler` map validation errors to `400`, missing routes to `404`, and `StaleLeaseEpoch` to `409` in black-box tests.
- [ ] No barrel `index.ts` files (except `src/index.ts`), declaration order follows `BE_RULES.md` §3.2, and arrow functions only.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
