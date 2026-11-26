# Engineering Rules

Source of truth for code shape, layering, transactions, and testing in `apps/hq` and `apps/sf`. When plan or todo diverges on code shape, **this file wins**.

---

## 1. Runtime & Stack

1. **Stack**: Bun (`Bun.serve`, `bun:sqlite` WAL, Bun SQL for Postgres) + Hono (`^4.13`) + Drizzle ORM (`drizzle-orm/bun-sqlite`, `drizzle-orm/bun-sql`) + Zod (`^4.6`).
2. **Standalone Backend Isolation**:
   - `apps/hq` owns domain, SQLite/PG schema, procedures, Hono adapters inside `apps/hq/src/`.
   - Workspace deps only: `@repo/hq-contracts`, `@repo/zod-contract-kit`, `@repo/bun-sqlite-kit`.
   - Cell interactions (`claims`, `heartbeats`, `jobs/:id/transitions`, `incidents/:id/resolve`) are backend HTTP endpoints verified via black-box `app.request()` tests in `apps/hq/test/`.
3. **Catalog dependencies only**: Pin third-party packages via `catalog:` in root `package.json`.
4. **Zero GitHub coupling**: Server never calls `gh` CLI, GitHub APIs, or webhooks. Cells push branches, publish PRs on `deliver`, report git refs via REST.

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
│   │   └── pg/                               # Postgres: client.ts, schema/, migrations/
│   ├── application/                          # Use-case orchestration (domain, contracts, ports); no drizzle, no db/
│   │   ├── core/                             # error-handling.ts, procedure.ts, identity.ts, schema/zod.ts
│   │   ├── ports/                            # auth, clock, claim-waiters, transition-bus, storage (StoragePort + row types)
│   │   ├── orders/, tokens/                  # Shared writes (job loss, cell release, token writes)
│   │   └── procedures/                       # cells, factories, jobs, incidents, order-plans, projects, queue, tokens, work-orders
│   ├── adapters/
│   │   ├── auth/safe-token-auth.adapter.ts   # SHA-256 + timingSafeEqual + grace window + scope check
│   │   ├── storage/sqlite-storage.adapter.ts # StoragePort on bun:sqlite
│   │   ├── storage/postgres-storage.adapter.ts # StoragePort on Postgres (HQ_DATABASE_URL)
│   │   ├── memory/                           # system clock, claim waiters (max 5), transition bus (SSE)
│   │   └── hono/                             # adapter, error handlers, middlewares, types, routes/
│   └── bootstrap/                            # transport.ts, admin.ts, web-join.ts
└── test/
    ├── support/                              # test app, test db, test transport
    ├── db/                                   # Partial unique index, immediateTx concurrency & storage port tests
    └── blackbox/                             # HTTP black-box route tests via app.request()
```

### Dependency Direction (Strict DAG)

- `domain/` -> imports nothing outside `domain/`. Pure functions and types only.
- `@repo/hq-contracts` -> imports `zod` only.
- `db/` -> imports `drizzle-orm`, `bun:sqlite`, `domain/` branded types.
- `application/` -> imports `domain/`, contracts, `application/ports/`. Never imports `db/`, `drizzle-orm`, `hono`, `adapters/`.
- `adapters/` -> imports `application/`, contracts, `domain/`, `db/`, `hono`.
- `bootstrap/` & `app.ts` -> wires `adapters/` into `application/` ports.

---

## 3. Code Style & TypeScript Rules

Shared rules (`coding-no-barrel-export`, `coding-export-order`, `coding-minimal-comments`, `ts-strict`, `ts-exhaustive`, `ts-unknown-as`) live in [`.nitpick/rules/`](../../.nitpick/rules/).

1. **Arrow functions only**: Use `const fn = (...) => ...` everywhere.
2. **Barrel exception**: package root `src/index.ts` is exempt from `coding-no-barrel-export`.

---

## 4. Contracts, Procedures & Hono Adapter Rules

1. **ZodContract per JSON endpoint** (`packages/hq-contracts/src/<domain>.contract.ts`):
   - Shape: `{ in?: { params?, query?, body? }, out: Record<StatusCode, ZodType<{ code: StatusCode, ... }>> }`.
   - Every response includes literal `code` matching HTTP status code (`200`, `400`, `401`, `403`, `404`, `409`, `422`).
2. **Validation in `withZodSchema(contract)`**:
   - `parseInput` maps `ZodError` to `BadRequest(400, "Invalid request payload: <path>: <msg>")`.
   - `parseOutput` validates handler output against `contract.out[output.code]`; mismatch throws `InternalServer(500)`.
3. **Procedures (`src/application/procedures/<domain>/<action>.procedure.ts`)**:
   - Built via `publicProcedure`, `authenticatedProcedure`, or `scopedProcedure(['supervisor:write'])`.
   - Data access only through `ctx.storage.read(tx => ...)` and `ctx.storage.write(tx => ...)`.
   - Procedures never touch Hono `Context` or HTTP headers.
4. **Thin Hono routes (`src/adapters/hono/routes/<domain>.route.ts`)**:
   - Mount `honoAdapter(procedure)`. Zero `try/catch` in routes or procedures.
   - Only `GET /api/v1/stream` (SSE) uses Hono `streamSSE` directly after verifying `supervisor:read`.
5. **No module-level mutable state**:
   - Never cache DB connections, timers, or waiter sets in module globals so parallel `createTestApp()` runs stay isolated.

---

## 5. SQLite, Transactions & Concurrency Rules

1. **WAL & Pragmas on `createDb`**: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
2. **`storage.write(fn)` for all mutations**:
   - SQLite adapter runs `BEGIN IMMEDIATE`, awaits `fn`, then `COMMIT` or `ROLLBACK`. Postgres adapter runs `db.transaction` with `SELECT ... FOR UPDATE`.
   - Never call `ctx.storage.read` or `ctx.storage.write` inside a `write` callback (deadlocks SQLite queue).
   - `write(fn, { dryRun: true })` rolls back every change and returns `fn` result.
3. **Database-enforced single-Cell exclusivity** ([hq.md](../apps/hq.md)):
   - `idx_jobs_one_active_per_order ON jobs(order_id) WHERE order_id IS NOT NULL AND status IN ('claimed', 'running')`
   - `idx_jobs_one_active_per_cell ON jobs(cell_id) WHERE cell_id IS NOT NULL AND status IN ('claimed', 'running')`
   - `idx_work_orders_one_active_per_cell ON work_orders(active_cell_id) WHERE active_cell_id IS NOT NULL`
4. **Monotonic `epoch` fencing & state-based idempotency**:
   - Every Cell mutation verifies `job.claimed_by_cell_id === x-cell-id` and `job.epoch === body.epoch`. Mismatch throws `StaleLeaseEpoch` (`409`).
   - Repeat of already-applied outcome at same `epoch` returns `200 already_applied` ([hq.md](../apps/hq.md#4-agent-reporting-operator--mechanic-via-cell)).
5. **Post-commit side effects**:
   - Call `ctx.claimWaiters.wakeAll()` and `ctx.transitionBus.publish(transitions)` only after transaction commit.

---

## 6. Domain Invariants

1. **Project & Line Pinning**: Every `OrderPlan`, `WorkOrder`, `Job` has non-null `projectId` and `lineName`.
2. **Start-to-Finish Cell Ownership**: Claiming Step 0 locks `active_cell_id`, `active_job_id`, `pinned_factory_id` across Steps `0..deliver` via inline `nextJob`.
3. **Local Line Check (`line_unavailable`)**: Records Factory in `unavailable_line_factories_json`, releases lock, opens Incident if no online Factory serves line, dispatches different eligible `nextJob` inline.
4. **Worktree Check (`worktree_missing` -> Scratch Reset)**: Increments `worktree_resets` (blocks with `worktree_reset_limit` Incident if `> 2`), rewinds to Step 0, returns fresh Step 0 `nextJob` (`workspaceMode: 'fresh'`, `epoch + 1`).
5. **Dynamic Step Materialization**: `order_steps[0..N-1]` materialized from `lineSnapshot.stations` sent by Cell on Step 0 `start`.
6. **Parent Stacking & `stale_base`**: At most 1 parent (`parent_order_id`). New parent `head_commit_sha` marks started/delivered child `stale_base = 1`, `blocked`, and opens `parent_rebased` Incident.
7. **Safe Tokens**: 256-bit CSPRNG tokens (`sf_sup_`, `sf_join_`, `sf_factory_`) hashed with SHA-256, checked via `crypto.timingSafeEqual`, 60s rotation grace window.

---

## 7. Testing Pyramid & Verification Gate

- **Domain Unit Tests (`src/domain/**/__tests__/*.test.ts`)**: Pure, zero I/O, zero SQLite.
- **DB & Concurrency Tests (`test/db/*.test.ts`)**: Real `bun:sqlite` + `storage-port.contract.ts` (SQLite + Postgres).
- **Black-Box HTTP Tests (`test/blackbox/*.test.ts`)**: Through `app.request()` via `createTestApp()`.
- **Verification Gate**: `bun run ci:verify`.
