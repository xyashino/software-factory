---
status: todo
priority: high
depends_on: []
workflow: feature
---

# v2-07b: Storage — Drizzle ORM schema and query layer in factory-db

## 🎯 Objective

Build `@repo/factory-db` (`packages/factory-db/`) on `drizzle-orm/bun-sqlite` by declaring the
Drizzle SQLite schema for all 11 tables in `STORAGE.md` §4 and refactoring `sqlite-event-store`,
`orders-table`, and `rebuild-projections` from raw `bun:sqlite` SQL strings to typed Drizzle query
builders, while keeping `migrations/*.sql` as the DDL source of truth.

---

## 🌐 Context & Problem Statement

`docs/STORAGE.md` §1 specifies **SQLite (`bun:sqlite`, WAL mode) behind Drizzle**, and
`packages/factory-db/package.json` already declares `"drizzle-orm": "catalog:"` (`0.45.4` in
`pnpm-workspace.yaml`), matching `docs/STRUCTURE.md` §2. However, the initial implementation from
`v2-07` (`sqlite-event-store.ts`, `orders-table.ts`, `rebuild-projections.ts`) bypassed Drizzle and
issued hand-written SQL strings and positional parameter arrays directly on `bun:sqlite`.

Without completing the Drizzle layer now:

- Column names, types, and nullability are duplicated across `0001_init.sql`, manual row interfaces
  (`OrderRow`, `EventRow`), and raw SQL string templates (`ORDER_COLUMNS`).
- Upcoming `v2-08` stores (`LeaseStore`, `BlobStore`, export/import) would either also be written in
  raw SQL or have to be rewritten later.

As in v1 (`packages/software-factory/src/adapters/store/{schema,sqlite-store}.ts`), Drizzle serves
exclusively as the typed schema and query layer over the `bun:sqlite` connection; numbered SQL files
in `packages/factory-db/migrations/` remain the source of truth for schema migrations (`migrate.ts`).

## Read first

- `docs/STORAGE.md` §1, §3 (§3.1 synchronous driver & mutex), §4 (11-table schema), §6, §9
- `docs/STRUCTURE.md` §2 (`factory-db` dependency & boundary rules)
- `docs/RULES.md` §2, §4.6 (`factory-db` never decides)
- `decisions/20261113-233255-factory-add-sqlite-event-store.md`
- v1 reference: `packages/software-factory/src/adapters/store/{schema,sqlite-store}.ts`

---

## 📦 Specification / Scope

- **Target**: `packages/factory-db`
- **Classification**: `Integration`
- **Dependencies**:
  - `drizzle-orm: catalog:` (already present in `packages/factory-db/package.json`)
  - `@repo/factory-core: workspace:*` (already present)
- **Out of scope**:
  - `LeaseStore`, `BlobStore`, and export/import (`todos/v2-08-storage-leases-blobs-export.md`)
  - `drizzle-kit` / generated migrations (forward-only SQL files in `migrations/` and `migrate.ts` stay unchanged)

---

## 🛠️ Implementation Plan

1. **Declare Drizzle Schema (`packages/factory-db/src/schema.ts`)**:
   - Define all 11 tables from `packages/factory-db/migrations/0001_init.sql` (`STORAGE.md` §4)
     using `drizzle-orm/sqlite-core` (`sqliteTable`, `text`, `integer`, `blob`, `index`, `unique`,
     `primaryKey`):
     - `projects`
     - `events` (with `events_type` index and unique `(order_id, seq)`)
     - `orders` (with `orders_queue` index, unique `(project_id, todo_id)`, and FK
       `project_id -> projects.project_id`)
     - `commands`
     - `cells` (with FK `joined_with -> join_tokens.join_token_id`)
     - `joinTokens` (`join_tokens`)
     - `leases` (with `leases_expiry` index and FK `cell_id -> cells.cell_id`)
     - `signals`
     - `blobs` (`blob('content', { mode: 'buffer' })`)
     - `supervisorTokens` (`supervisor_tokens`)
     - `intake` (composite primary key `(project_id, todo_id)`)
   - Export `$inferSelect` and `$inferInsert` record types for the tables.
   - Keep `schema.ts` 100% pure of domain logic (no `decide`, `nextJob`, or `toProjection`).

2. **Drizzle Connection & Transaction Boundary (`packages/factory-db/src/db.ts` or `sqlite-event-store.ts`)**:
   - Export a typed helper (e.g. `drizzleOf(db: Database): FactoryDatabase` wrapping
     `drizzle(db, { schema })` with `BunSQLiteDatabase<typeof schema>`).
   - Keep `openDatabase(file)` setting `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, and
     `PRAGMA busy_timeout = 5000`.
   - Keep `writeMutex()` and explicit SQLite `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` and
     `SAVEPOINT append` / `RELEASE append` / `ROLLBACK TO append` on the underlying `bun:sqlite`
     `Database` handle so Drizzle executes queries on that same synchronous connection inside the
     immediate write lock (never downgrading `BEGIN IMMEDIATE` to Drizzle's default `BEGIN`).

3. **Refactor Store Modules to Typed Drizzle Queries**:
   - `packages/factory-db/src/orders-table.ts`:
     - Replace hand-written `OrderRow`, `ORDER_COLUMNS`, and raw `INSERT ... ON CONFLICT DO UPDATE`
       / `SELECT *` SQL strings with Drizzle's `orders` table, `NewOrderRow` / `OrderRow`,
       `insert(orders).values(...).onConflictDoUpdate({ target: orders.orderId, set: ... })`, and
       `select().from(orders).orderBy(asc(orders.orderId))`.
     - Preserve pure mapping functions (`orderRowOf`, `projectionOfRow`) and `STORAGE.md` §4 column
       mapping (`last_cell_id`, `avoid_cells`).
   - `packages/factory-db/src/sqlite-event-store.ts`:
     - Replace raw `db.query` / `db.run` CRUD statements (`commands`, `orders`, `events`) with
       Drizzle query builders (`select`, `insert`, `eq`, `gt`, `asc`, `.returning()`).
     - Keep Zod validation (`orderEventSchema`, `storedEventSchema`), `upcastEvent`, savepoints, and
       `exclusive` working identically against the `EventStore` contract.
   - `packages/factory-db/src/rebuild-projections.ts`:
     - Replace `db.exec('DELETE FROM orders')` with `drizzleDb.delete(orders).run()` and route
       reads/writes through the Drizzle-backed helpers while keeping `ProjectRow` injected by the
       caller.

4. **Tests & Schema Parity Verification**:
   - Add a schema parity test (`packages/factory-db/src/__tests__/schema.test.ts`) that migrates
     `0001_init.sql` into SQLite and verifies via `PRAGMA table_info` / `sqlite_master` that every
     table, column name, and index in `schema.ts` matches `0001_init.sql`.
   - Update existing tests (`orders-table.test.ts`, `rebuild-projections.test.ts`, `helpers.ts`)
     where needed for Drizzle row shapes, keeping `sqlite-event-store.contract.test.ts`,
     `write-mutex.spike.test.ts`, `migrate.test.ts`, and `store-boundary.test.ts` green.

---

## ✅ Acceptance Criteria

- [ ] `packages/factory-db/src/schema.ts` defines all 11 tables from `migrations/0001_init.sql` (`STORAGE.md` §4) using `drizzle-orm/sqlite-core` and exports inferred types.
- [ ] `sqlite-event-store.ts`, `orders-table.ts`, and `rebuild-projections.ts` use `drizzle-orm/bun-sqlite` for all table queries, inserts, upserts, and deletes (raw `bun:sqlite` calls remain only for PRAGMAs, `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`, and `migrate.ts` DDL execution).
- [ ] Schema parity test verifies `schema.ts` tables, columns, and indexes match `migrations/0001_init.sql`.
- [ ] Existing `EventStore` contract suite (`sqlite-event-store.contract.test.ts`), `write-mutex.spike.test.ts`, `migrate.test.ts`, `rebuild-projections.test.ts`, and `store-boundary.test.ts` pass.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
