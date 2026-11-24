# Engineering rules: `apps/hq` backend

Source of truth for code shape, layering, transactions, and testing in `apps/hq`. When a plan or todo diverges from this file on code shape, **this file wins**.

---

## 1. Runtime & Stack

1. **Stack**: Bun (`Bun.serve`, `bun:sqlite` WAL, Bun SQL for Postgres) + Hono (`^4.13`) + Drizzle ORM (`drizzle-orm/bun-sqlite`, `drizzle-orm/bun-sql`) + Zod (`^4.6`).
2. **Standalone Backend Isolation**:
   - `apps/hq` owns its domain, SQLite schema, procedures, and Hono adapters inside `apps/hq/src/`.
   - Workspace deps only: `@repo/hq-contracts` (wire contracts, shared with `sf` and web), `@repo/zod-contract-kit`, `@repo/bun-sqlite-kit` (db plumbing).
   - All Cell interactions (`claims`, `heartbeats`, `jobs/:id/transitions`, `incidents/:id/resolve`) are implemented purely as backend HTTP endpoints and verified via black-box `app.request()` HTTP tests inside `apps/hq/test/`.
3. **Catalog dependencies only**: Pin third-party packages via `catalog:` in root `package.json` (`workspaces.catalog`) (`hono`, `drizzle-orm`, `drizzle-kit`, `zod`, `yaml`, `vitest`, `@types/bun`, `@types/node`, `typescript`, `eslint`).
4. **Zero GitHub coupling**: Server never calls `gh` CLI, GitHub REST/GraphQL APIs, or GitHub webhooks. Cells push branches, publish PRs on `deliver`, and report git refs/commits back via REST.

---

## 2. Directory Layout & Layering

```text
apps/hq/
├── drizzle.config.ts
├── src/
│   ├── index.ts                              # Bun.serve entrypoint, env (HQ_PORT, HQ_HOST, HQ_DB_PATH, HQ_DATA_DIR, HQ_DATABASE_URL)
│   ├── app.ts                                # createApp(createTransport)
│   ├── config.ts                             # Timing constants and limits
│   ├── domain/                               # Pure domain logic (zero I/O, zero DB, zero Hono)
│   │   ├── common/                           # brand.ts (branded ids), scoped-id.ts, time.ts, events.ts
│   │   ├── cells/                            # claim eligibility
│   │   ├── tokens/                           # Safe token prefix, scope & role rules
│   │   ├── topology/                         # resolveBaseBranch, parent stack & stale_base rules
│   │   ├── orders/                           # WorkOrder & OrderStep state machine, scratch reset, lineSnapshot materialization
│   │   ├── incidents/                        # Incident triggers, triage owner & resolution state machine
│   │   └── queue/                            # todos/<slug>.md parser/serializer & DAG validation
│   ├── db/
│   │   ├── client.ts                         # createDb on @repo/bun-sqlite-kit (SQLite default)
│   │   ├── migrations/                       # SQLite Drizzle migrations + partial unique indexes
│   │   ├── schema/                           # SQLite tables: factories, projects, tokens, plans, orders, jobs, incidents, transitions
│   │   └── pg/                               # Postgres: client.ts (bun-sql + embedded migrations), schema/, migrations/ (drizzle-kit postgresql)
│   ├── application/                          # Use-case orchestration (domain, contracts, ports); no drizzle, no db/
│   │   ├── core/                             # error-handling.ts, procedure.ts (scopedProcedure), identity.ts (factory id, x-cell-id), schema/zod.ts
│   │   ├── ports/                            # auth, clock, claim-waiters, transition-bus, storage (StoragePort + row types)
│   │   ├── orders/, tokens/                  # Shared writes used by several procedures (job loss, cell release, token writes)
│   │   └── procedures/                       # cells, factories, jobs, incidents, order-plans, projects, queue, tokens, work-orders
│   ├── adapters/
│   │   ├── auth/safe-token-auth.adapter.ts   # SHA-256 + timingSafeEqual + grace window + scope check
│   │   ├── storage/sqlite-storage.adapter.ts # StoragePort on bun:sqlite: drizzle queries, read/write tx, dry-run
│   │   ├── storage/postgres-storage.adapter.ts # StoragePort on Postgres (HQ_DATABASE_URL): drizzle bun-sql, FOR UPDATE claims
│   │   ├── memory/                           # system clock, claim waiters (max 5), transition bus (SSE)
│   │   └── hono/                             # adapter, error handlers, middlewares, types, routes/ (one file per resource)
│   └── bootstrap/                            # transport.ts, admin.ts (admin token), web-join.ts (web-demo join secret)
└── test/
    ├── support/                              # test app, test db, test transport
    ├── db/                                   # Partial unique index, immediateTx concurrency & storage port tests
    └── blackbox/                             # HTTP black-box route tests via app.request()
```

Wire contracts live in `packages/hq-contracts/src` (one file per resource, `enums/`).

### Dependency Direction (Strict DAG)

- `domain/` -> imports nothing outside `domain/`. Pure functions and types only. No `Date.now()`, no `crypto`, no `bun:sqlite`, no `hono`.
- `@repo/hq-contracts` -> imports `zod` only. Never imports `apps/hq`.
- `db/` -> imports `drizzle-orm`, `bun:sqlite`, and `domain/` branded types. Never calls domain state machines or procedures.
- `application/` -> imports `domain/`, contracts, and `application/ports/`. Never imports `db/`, `drizzle-orm`, `hono`, or `adapters/`. Storage goes through `StoragePort`.
- `adapters/` -> imports `application/`, contracts, `domain/`, `db/`, and `hono`. `adapters/storage/` is the only place drizzle queries for application data live.
- `bootstrap/` & `app.ts` -> wires `adapters/` into `application/` ports.

---

## 3. Code Style & TypeScript Rules (Repo-Wide Nitpick Compliance)

Shared style rules (`coding-no-barrel-export`, `coding-export-order`, `coding-minimal-comments`, `ts-strict`, `ts-exhaustive`, `ts-unknown-as`) live in [`.nitpick/rules/`](../.nitpick/rules/) and apply to this app. Not repeated here.

1. **Arrow functions only**: Use `const fn = (...) => ...` everywhere (implementation and tests). `function` declarations are forbidden except where TypeScript requires overload signatures on a single adapter helper.
2. **Barrel exception**: package root `src/index.ts` (server entrypoint) is exempt from `coding-no-barrel-export`.

---

## 4. Contracts, Procedures & Hono Adapter Rules

1. **Every JSON endpoint has a `ZodContract` in `src/contracts/<domain>.contract.ts`**:
   - Shape: `{ in?: { params?: ZodType, query?: ZodType, body?: ZodType }, out: Record<StatusCode, ZodType<{ code: StatusCode, ... }>> }`.
   - Every response object includes a literal `code` field matching the HTTP status code (`{ code: z.literal(200), ... }`), plus declared error responses (`400`, `401`, `403`, `404`, `409`, `422`).
2. **Input & Output validation in `withZodSchema(contract)`**:
   - `parseInput` validates `{ params, query, body }` and maps `ZodError` to `BadRequest(400, "Invalid request payload: <path>: <msg>")`.
   - `parseOutput` validates handler output against `contract.out[output.code]`; undeclared codes or schema mismatches throw `InternalServer(500)`.
3. **Procedures (`src/application/procedures/<domain>/<action>.procedure.ts`)**:
   - Built via `publicProcedure`, `authenticatedProcedure`, or `scopedProcedure(['supervisor:write'])`.
   - Handlers receive `(input, ctx)` where `ctx` is `TransportContext` (`storage`, `clock`, `auth`, `claimWaiters`, `transitionBus`, `signal`, plus `principal` on authenticated procedures).
   - Data access only through `ctx.storage.read(tx => ...)` and `ctx.storage.write(tx => ...)`. Handlers that touch storage are `async`.
   - Procedures never touch Hono `Context`, HTTP headers, or status helpers—they return `{ code: 200 as const, ... }` or throw `BaseError` subclasses.
4. **Thin Hono routes (`src/adapters/hono/routes/<domain>.route.ts`)**:
   - Routes only mount `honoAdapter(procedure)`: e.g. `.post('/claims', honoAdapter(claimJobProcedure))`.
   - Zero `try/catch` in route files or procedures. Centralized `errorHandler` (`.onError`) and `notFoundHandler` (`.notFound`) format all `BaseError` and `HTTPException` instances into `{ code, type, message }`.
   - Only `GET /api/v1/stream` (SSE) uses Hono's `streamSSE` directly in `stream.route.ts` after verifying `supervisor:read` via `ctx.auth`.
5. **No module-level mutable state**:
   - `createTransport` is called per request (or holds per-app injected instances of `storage`, `clock`, `claimWaiters`, `transitionBus`).
   - Never cache DB connections, timers, or waiter sets in module-global variables so parallel `createTestApp()` instances remain 100% isolated.

---

## 5. SQLite (`bun:sqlite`), Transactions & Concurrency Rules

1. **WAL & Pragmas on `createDb`**:
   - `PRAGMA journal_mode = WAL;`
   - `PRAGMA synchronous = NORMAL;`
   - `PRAGMA foreign_keys = ON;`
   - `PRAGMA busy_timeout = 5000;`
2. **`storage.write(fn)` for all mutating state transitions**:
   - Every claim (`/cells/claims`), job transition (`/jobs/{id}/transitions`), queue import/action (`/queue/import`, `/queue/actions`), order/plan transition, and incident resolution MUST run inside `storage.write`. The SQLite adapter runs `BEGIN IMMEDIATE`, awaits `fn`, then `COMMIT` or `ROLLBACK`; a per-adapter queue serializes reads and writes on its one connection. The Postgres adapter runs `db.transaction`.
   - `fn` is `(tx) => T | Promise<T>`. Every repo call returns a Promise and MUST be awaited inside `fn`; an un-awaited write can commit before it runs. Helpers that touch `tx` are `async` and awaited by their callers.
   - Postgres claim and transition paths lock rows with `SELECT ... FOR UPDATE` inside writes: by-id finds on jobs, orders and tokens, and the claim selects (`listQueued`, `listReadyPlanBranches`, `findReady*`). Concurrent claims of one job serialize on that lock.
   - Do not call `ctx.storage.read` or `ctx.storage.write` from inside a `write` callback; the SQLite queue would deadlock.
   - `write(fn, { dryRun: true })` runs `fn`, rolls back every change, and returns `fn`'s result (queue import dry run).
   - `storage.read(fn)` for queries outside a write.
   - Only `adapters/storage/` may build drizzle queries for application data. `application/` calls `tx.<aggregate>.<op>()` on the port.
3. **Database-enforced single-Cell exclusivity**:
   - Migrations MUST create the three partial unique indexes from [`hq.md`](./hq.md) §7:
     - `idx_jobs_one_active_per_order ON jobs(order_id) WHERE order_id IS NOT NULL AND status IN ('claimed', 'running')`
     - `idx_jobs_one_active_per_cell ON jobs(cell_id) WHERE cell_id IS NOT NULL AND status IN ('claimed', 'running')`
     - `idx_work_orders_one_active_per_cell ON work_orders(active_cell_id) WHERE active_cell_id IS NOT NULL`
4. **Monotonic `epoch` fencing & state-based idempotency**:
   - Every Cell mutation (`start`, `complete`, `fail`, `block`, `line_unavailable`, `worktree_missing`, `heartbeats`) verifies `job.claimed_by_cell_id` equals the `x-cell-id` the Factory relayed and `job.epoch === body.epoch`. Mismatch throws `StaleLeaseEpoch` (`409`, `type: 'stale-lease-epoch'`).
   - The server stores no command ids and no replay results. A transition is applied only if the job is live, owned by the caller and at the current `epoch`.
   - If the job already reflects the command's outcome at the same `epoch`, the server answers `200 already_applied` and changes nothing ([`hq.md`](./hq.md) §11.4).
   - `state_transitions` is history only, written for the SSE stream. It is never read to answer a retry.
5. **Post-commit side effects (`claimWaiters` & `transitionBus`)**:
   - Only after `immediateTx` commits successfully may a procedure call `ctx.claimWaiters.wakeAll()` (when work becomes `queued`/`ready`) or `ctx.transitionBus.publish(transitions)`.

---

## 6. Domain Invariants (Must Never Be Violated)

1. **Project & Line Pinning**: Every `OrderPlan`, `WorkOrder`, and `Job` has a non-null `projectId` (from `.factory/config.json`) and `lineName` (from `todos/<slug>.md` `line:`).
2. **Start-to-Finish Cell Ownership**: Once a Cell claims Step 0 of a `WorkOrder`, `active_cell_id` and `active_job_id` stay locked to that Cell and `pinned_factory_id` to its Factory across Steps `0..deliver` via inline `nextJob` handoff. Only a gone Cell, lease expiry (`leaseTtlMs = 60_000`) or `line_unavailable` releases `active_cell_id`.
3. **Local Line Check (`line_unavailable`)**: When a Cell reports `action: 'line_unavailable'`, the server records the caller's Factory in `unavailable_line_factories_json`, releases `active_cell_id`/`pinned_factory_id`, transitions `WorkOrder` to `'line_unavailable'` + opens an Incident if no other online Factory serves the line, and immediately dispatches a different eligible `Job` (`nextJob`) in the same response.
4. **Worktree Check (`worktree_missing` -> Scratch Reset)**: When a Cell reports `action: 'worktree_missing'` on `stepIndex > 0` (`workspaceMode: 'reuse'`), the server increments `worktree_resets` (blocking with `worktree_reset_limit` Incident if `> 2`), rewinds `current_step_index = 0` and all `order_steps`, keeps `active_cell_id` locked to the Cell and `pinned_factory_id` to its Factory, and returns a fresh Step 0 `Job` (`workspaceMode: 'fresh'`, `epoch + 1`) inline as `nextJob`.
5. **Dynamic Step Materialization**: `order_steps[0..N-1]` are materialized from `lineSnapshot.stations` sent by the Cell on Step 0 `action: 'start'`.
6. **Parent Stacking & `stale_base`**: A `WorkOrder` has at most 1 parent (`parent_order_id`). When parent `A` delivers a new `head_commit_sha` that differs from a started/delivered child `B`'s `base_commit_sha`, child `B` is marked `stale_base = 1`, transitioned to `'blocked'`, and an Incident (`reason = 'parent_rebased'`) is opened.
7. **Safe Tokens**: Raw tokens (`sf_sup_`, `sf_join_`, `sf_factory_`) have 256 bits of CSPRNG entropy, are hashed with SHA-256 before DB storage, compared via `crypto.timingSafeEqual`, enforce `expires_at` and `revoked_at`, and support 60s rotation grace windows via `rotated_from_id`.

---

## 7. Testing Pyramid & Verification Gate

1. **3-Tier Test Strategy**:
   - **Domain Unit Tests (`src/domain/**/__tests__/*.test.ts`)**: Pure, zero I/O, zero SQLite. Test state machines, `resolveBaseBranch`, markdown import/export parsing, DAG cycle detection, token hash/scope logic, and incident transitions.
   - **DB & Concurrency Tests (`test/db/*.test.ts`)**: Real `bun:sqlite` DB (`:memory:` or temp file with WAL). Test partial unique indexes (`idx_jobs_one_active_per_order`, `idx_jobs_one_active_per_cell`, `idx_work_orders_one_active_per_cell`), concurrent claims, and schema constraints. `storage-port.contract.ts` runs the same `StoragePort` behaviour suite against SQLite always and against Postgres when `TEST_POSTGRES_URL` is set.
   - **Black-Box HTTP Tests (`test/blackbox/*.test.ts`)**: Through `app.request()` using `createTestApp()` (fresh SQLite DB + controllable fake clock + in-memory waiters/bus per test). Arrange-Act-Assert, story-like test names, zero internal mocks.
2. **Single Verification Gate**:
   - Every vertical slice must pass `bun run ci:verify` (typecheck, lint, format, tests) with zero warnings and zero errors.
