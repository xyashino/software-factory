# Engineering rules: `apps/factory` backend

Source of truth for code shape, layering, transactions, and testing in `apps/factory`. When a plan or todo diverges from this file on code shape, **this file wins**.

---

## 1. Runtime & Stack

1. **Stack**: Bun (`Bun.serve`, `bun:sqlite` WAL) + Hono (`^4.13`) + Drizzle ORM (`drizzle-orm/bun-sqlite`) + Zod (`^4.6`).
2. **Standalone Backend Isolation**:
   - Scope is strictly limited to `apps/factory/`. Do **NOT** modify, wire, or connect other apps or packages from here.
   - `apps/factory` owns all of its domain, SQLite schema, contracts, procedures, and Hono adapters inside `apps/factory/src/`.
   - All Cell interactions (`enroll`, `hello`, `claims`, `heartbeats`, `jobs/:id/transitions`, `incidents/:id/resolve`) are implemented purely as backend HTTP endpoints and verified via black-box `app.request()` HTTP tests inside `apps/factory/test/`.
3. **Catalog dependencies only**: Pin third-party packages via `catalog:` in `pnpm-workspace.yaml` (`hono`, `drizzle-orm`, `drizzle-kit`, `zod`, `yaml`, `vitest`, `@types/bun`, `@types/node`, `typescript`, `eslint`).
4. **Zero GitHub coupling**: Server never calls `gh` CLI, GitHub REST/GraphQL APIs, or GitHub webhooks. Cells push branches, publish PRs on `deliver`, and report git refs/commits back via REST.

---

## 2. Directory Layout & Layering

```text
apps/factory/
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                              # Bun.serve entrypoint + CLI flags
│   ├── app.ts                                # createApp(createTransport) (~30 lines)
│   ├── config.ts                             # Typed env/config resolution, timing constants
│   ├── types/
│   │   └── env.ts                            # ServerBindings / ServerConfig
│   ├── domain/                               # Pure domain logic (zero I/O, zero DB, zero Hono)
│   │   ├── common/
│   │   │   ├── brand.ts                      # Branded IDs (ProjectId, PlanId, OrderId, StepId, JobId, CellId, IncidentId, TokenId)
│   │   │   ├── time.ts                       # Epoch ms helpers, TTL math
│   │   │   └── events.ts                     # StateTransitionEvent types
│   │   ├── tokens/                           # Safe token prefix, scope & role rules
│   │   ├── topology/                         # resolveBaseBranch, parent stack & stale_base rules
│   │   ├── orders/                           # WorkOrder & OrderStep state machine, scratch reset, lineSnapshot materialization
│   │   ├── incidents/                        # Incident triggers, triage owner & resolution state machine
│   │   └── queue/                            # todos/<slug>.md frontmatter parser/serializer & DAG validation
│   ├── db/                                   # bun:sqlite + Drizzle ORM schema & helpers
│   │   ├── client.ts                         # createDb(sqlitePath), WAL pragma, immediateTx(db, fn)
│   │   ├── columns.ts                        # Shared column builders (timestamps, jsonText, branded text PKs)
│   │   ├── migrations/                       # Drizzle SQL migrations + partial unique indexes
│   │   └── schema/                           # Drizzle table definitions
│   │       ├── projects.ts
│   │       ├── tokens.ts
│   │       ├── cells.ts
│   │       ├── plans.ts
│   │       ├── orders.ts
│   │       ├── jobs.ts
│   │       ├── incidents.ts
│   │       └── transitions.ts
│   ├── contracts/                            # Pure Zod HTTP contracts ({ in: { params?, query?, body? }, out: { [code]: z.ZodType } })
│   │   ├── common.ts                         # errorResponse, idSchema, paginationIn, pageOut
│   │   ├── tokens.contract.ts
│   │   ├── projects.contract.ts
│   │   ├── queue.contract.ts
│   │   ├── order-plans.contract.ts
│   │   ├── work-orders.contract.ts
│   │   ├── cells.contract.ts
│   │   ├── jobs.contract.ts
│   │   ├── incidents.contract.ts
│   │   └── stream.contract.ts
│   ├── application/                          # Use-case orchestration (depends on domain, db, contracts, ports)
│   │   ├── core/
│   │   │   ├── error-handling.ts             # BaseError, BadRequest(400), Unauthorized(401), Forbidden(403), NotFound(404), Conflict(409), StaleLeaseEpoch(409), PayloadTooLarge(413), UnprocessableEntity(422), InternalServer(500)
│   │   │   ├── procedure.ts                  # TransportContext, publicProcedure, authenticatedProcedure, scopedProcedure(scopes)
│   │   │   └── schema/
│   │   │       ├── types.ts                  # ZodContract, ContractIn, ContractOut, ZodProcedureSchema
│   │   │       └── zod.ts                    # withZodSchema(contract)
│   │   ├── ports/
│   │   │   ├── auth.port.ts                  # AuthPort (verify Bearer sf_* token -> Principal)
│   │   │   ├── clock.port.ts                 # ClockPort (now(): number)
│   │   │   ├── claim-waiters.port.ts         # ClaimWaitersPort (park/wake in-memory long-poll waiters)
│   │   │   └── transition-bus.port.ts        # TransitionBusPort (publish/subscribe state_transitions for SSE)
│   │   └── procedures/
│   │       ├── tokens/
│   │       ├── projects/
│   │       ├── queue/
│   │       ├── order-plans/
│   │       ├── work-orders/
│   │       ├── cells/
│   │       ├── jobs/
│   │       └── incidents/
│   ├── adapters/                             # Concrete port implementations + Hono transport
│   │   ├── auth/
│   │   │   └── safe-token-auth.adapter.ts    # SHA-256 + timingSafeEqual + grace window + scope check
│   │   ├── memory/
│   │   │   ├── system-clock.adapter.ts
│   │   │   ├── claim-waiters.adapter.ts      # Set<() => void> max 5 resolvers, zero SQLite polling
│   │   │   └── transition-bus.adapter.ts     # In-memory pub/sub for GET /api/v1/stream
│   │   └── hono/
│   │       ├── adapter.ts                    # honoAdapter(procedure)
│   │       ├── error-handlers.ts             # errorHandler (.onError) + notFoundHandler (.notFound)
│   │       ├── middlewares.ts                # requestId, logger, noCache, bodyLimit, transportMiddleware
│   │       ├── types.ts                      # AppEnv, ContractHonoInput, ProcedureResponse
│   │       └── routes/
│   │           ├── tokens.route.ts
│   │           ├── projects.route.ts
│   │           ├── queue.route.ts
│   │           ├── order-plans.route.ts
│   │           ├── work-orders.route.ts
│   │           ├── cells.route.ts
│   │           ├── jobs.route.ts
│   │           ├── incidents.route.ts
│   │           └── stream.route.ts
│   └── bootstrap/
│       └── transport.ts                      # createTransport({ db, clock, claimWaiters, transitionBus })
└── test/
    ├── support/
    │   ├── test-app.ts                       # createTestApp(), request helpers (postJson, getJson, withBearer)
    │   ├── test-db.ts                        # Fresh in-memory or temp-file SQLite migrated + indexed per test
    │   └── test-transport.ts                 # Controllable clock + isolated waiters/bus + test DB per app
    ├── db/                                   # SQLite partial unique index & immediateTx concurrency tests
    └── blackbox/                             # End-to-end HTTP black-box route tests via app.request()
```

### Dependency Direction (Strict DAG)

- `domain/` -> imports nothing outside `domain/`. Pure functions and types only. No `Date.now()`, no `crypto`, no `bun:sqlite`, no `hono`.
- `contracts/` -> imports `zod` and `domain/` branded types only.
- `db/` -> imports `drizzle-orm`, `bun:sqlite`, and `domain/` branded types. Never calls domain state machines or procedures.
- `application/` -> imports `domain/`, `contracts/`, `db/`, and `application/ports/`. Never imports `hono` or `adapters/`.
- `adapters/` -> imports `application/`, `contracts/`, `domain/`, `db/`, and `hono`.
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
   - Handlers receive `(input, ctx)` where `ctx` is `TransportContext` (`db`, `clock`, `auth`, `claimWaiters`, `transitionBus`, `signal`, plus `principal` on authenticated procedures).
   - Procedures never touch Hono `Context`, HTTP headers, or status helpers—they return `{ code: 200 as const, ... }` or throw `BaseError` subclasses.
4. **Thin Hono routes (`src/adapters/hono/routes/<domain>.route.ts`)**:
   - Routes only mount `honoAdapter(procedure)`: e.g. `.post('/enroll', honoAdapter(enrollCellProcedure))`.
   - Zero `try/catch` in route files or procedures. Centralized `errorHandler` (`.onError`) and `notFoundHandler` (`.notFound`) format all `BaseError` and `HTTPException` instances into `{ code, type, message }`.
   - Only `GET /api/v1/stream` (SSE) uses Hono's `streamSSE` directly in `stream.route.ts` after verifying `supervisor:read` via `ctx.auth`.
5. **No module-level mutable state**:
   - `createTransport` is called per request (or holds per-app injected instances of `db`, `clock`, `claimWaiters`, `transitionBus`).
   - Never cache DB connections, timers, or waiter sets in module-global variables so parallel `createTestApp()` instances remain 100% isolated.

---

## 5. SQLite (`bun:sqlite`), Transactions & Concurrency Rules

1. **WAL & Pragmas on `createDb`**:
   - `PRAGMA journal_mode = WAL;`
   - `PRAGMA synchronous = NORMAL;`
   - `PRAGMA foreign_keys = ON;`
   - `PRAGMA busy_timeout = 5000;`
2. **`immediateTx(db, fn)` for all mutating state transitions**:
   - Every claim (`/cells/claims`), job transition (`/jobs/{id}/transitions`), queue import/action (`/queue/import`, `/queue/actions`), order/plan transition, cell hello/revoke, and incident resolution MUST execute inside a serialized `BEGIN IMMEDIATE` transaction (`db.transaction(..., { behavior: 'immediate' })`).
3. **Database-enforced single-Cell exclusivity**:
   - Migrations MUST create the three partial unique indexes from [`factory.md`](./factory.md) §7:
     - `idx_jobs_one_active_per_order ON jobs(order_id) WHERE order_id IS NOT NULL AND status IN ('claimed', 'running')`
     - `idx_jobs_one_active_per_cell ON jobs(cell_id) WHERE cell_id IS NOT NULL AND status IN ('claimed', 'running')`
     - `idx_work_orders_one_active_per_cell ON work_orders(active_cell_id) WHERE active_cell_id IS NOT NULL`
4. **Monotonic `epoch` fencing & state-based idempotency**:
   - Every Cell mutation (`start`, `complete`, `fail`, `block`, `line_unavailable`, `worktree_missing`, `heartbeats`) verifies `job.cell_id === principal.cellId` and `job.epoch === body.epoch`. Mismatch throws `StaleLeaseEpoch` (`409`, `type: 'stale-lease-epoch'`).
   - The server stores no command ids and no replay results. A transition is applied only if the job is live, owned by the caller and at the current `epoch`.
   - If the job already reflects the command's outcome at the same `epoch`, the server answers `200 already_applied` and changes nothing (PLAN §11.4).
   - `state_transitions` is history only, written for the SSE stream. It is never read to answer a retry.
5. **Post-commit side effects (`claimWaiters` & `transitionBus`)**:
   - Only after `immediateTx` commits successfully may a procedure call `ctx.claimWaiters.wakeAll()` (when work becomes `queued`/`ready`) or `ctx.transitionBus.publish(transitions)`.

---

## 6. Domain Invariants (Must Never Be Violated)

1. **Project & Line Pinning**: Every `OrderPlan`, `WorkOrder`, and `Job` has a non-null `projectId` (from `.factory/config.json`) and `lineName` (from `todos/<slug>.md` `line:`).
2. **Start-to-Finish Cell Ownership**: Once a Cell claims Step 0 of a `WorkOrder`, `pinned_cell_id`, `active_cell_id`, and `active_job_id` stay locked to that Cell across Steps `0..deliver` via inline `nextJob` handoff. Only lease expiry (`leaseTtlMs = 60_000`) or `line_unavailable` releases `active_cell_id`.
3. **Local Line Check (`line_unavailable`)**: When a Cell reports `action: 'line_unavailable'`, the server records `cellId` in `unavailable_line_cells_json`, releases `active_cell_id`/`pinned_cell_id`, transitions `WorkOrder` to `'line_unavailable'` + opens an Incident if no other online Cell supports the line, and immediately dispatches a different eligible `Job` (`nextJob`) in the same response.
4. **Worktree Check (`worktree_missing` -> Scratch Reset)**: When a Cell reports `action: 'worktree_missing'` on `stepIndex > 0` (`workspaceMode: 'reuse'`), the server increments `worktree_resets` (blocking with `worktree_reset_limit` Incident if `> 2`), rewinds `current_step_index = 0` and all `order_steps`, keeps `pinned_cell_id` and `active_cell_id` locked to the Cell, and returns a fresh Step 0 `Job` (`workspaceMode: 'fresh'`, `epoch + 1`) inline as `nextJob`.
5. **Dynamic Step Materialization**: `order_steps[0..N-1]` are materialized from `lineSnapshot.stations` sent by the Cell on Step 0 `action: 'start'`.
6. **Parent Stacking & `stale_base`**: A `WorkOrder` has at most 1 parent (`parent_order_id`). When parent `A` delivers a new `head_commit_sha` that differs from a started/delivered child `B`'s `base_commit_sha`, child `B` is marked `stale_base = 1`, transitioned to `'blocked'`, and an Incident (`reason = 'parent_rebased'`) is opened.
7. **Safe Tokens**: Raw tokens (`sf_sup_`, `sf_join_`, `sf_cell_`) have 256 bits of CSPRNG entropy, are hashed with SHA-256 before DB storage, compared via `crypto.timingSafeEqual`, enforce `expires_at` and `revoked_at`, and support 60s rotation grace windows via `rotated_from_id`.

---

## 7. Testing Pyramid & Verification Gate

1. **3-Tier Test Strategy**:
   - **Domain Unit Tests (`src/domain/**/__tests__/*.test.ts`)**: Pure, zero I/O, zero SQLite. Test state machines, `resolveBaseBranch`, markdown import/export parsing, DAG cycle detection, token hash/scope logic, and incident transitions.
   - **DB & Concurrency Tests (`test/db/*.test.ts`)**: Real `bun:sqlite` DB (`:memory:` or temp file with WAL). Test partial unique indexes (`idx_jobs_one_active_per_order`, `idx_jobs_one_active_per_cell`, `idx_work_orders_one_active_per_cell`), `immediateTx` contention, and schema constraints.
   - **Black-Box HTTP Tests (`test/blackbox/*.test.ts`)**: Through `app.request()` using `createTestApp()` (fresh SQLite DB + controllable fake clock + in-memory waiters/bus per test). Arrange-Act-Assert, story-like test names, zero internal mocks.
2. **Single Verification Gate**:
   - Every vertical slice must pass `pnpm ci:verify` (typecheck, lint, format, tests) with zero warnings and zero errors.
