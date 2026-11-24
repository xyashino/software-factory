---
scope: factory/hq
summary: Add a Postgres StoragePort adapter selected by HQ_DATABASE_URL
why: Production HQ needs concurrent connections and transactional claims, while SQLite stays the local default
date: 2026-11-24
---

- `StoragePort` is async inside transactions: repo methods return `Promise<T>` and `read`/`write` callbacks return `T | Promise<T>`. Callers `await` every repo call; the port comment says so.
- `sqlite-storage.adapter.ts` implements the async port. `write` runs `BEGIN IMMEDIATE`, awaits the callback, then `COMMIT` or `ROLLBACK`; a per-adapter queue serializes reads and writes on the one connection.
- Procedures, helpers in `application/orders`, `application/tokens`, `application/core`, `bootstrap/{admin,web-join}`, the safe-token auth adapter and the stream route await storage calls. Behaviour is unchanged and the 293 existing tests pass on SQLite.
- `postgres-storage.adapter.ts` implements `StoragePort` with `drizzle-orm/bun-sql`. `write` is `db.transaction`; dry run throws inside the transaction and returns the callback result.
- In writes, by-id finds on jobs, orders and tokens, and the claim selects (`listQueued`, `listReadyPlanBranches`, `findReady*`), use `SELECT ... FOR UPDATE`.
- `db/pg/schema/` mirrors the SQLite tables with `bigint` epoch-ms columns and `jsonb` JSON columns, plus the same three partial unique indexes.
- `db/pg/migrations/` holds the drizzle-kit `postgresql` migration, embedded like the SQLite one. Migrations run on connect under `pg_advisory_lock` on a single-connection client, so parallel starts apply each migration once.
- `HQ_DATABASE_URL` (or `FACTORY_DATABASE_URL`) selects Postgres in `index.ts`. Unset keeps `createSqliteStorageAdapter(createDb(HQ_DB_PATH))`. The startup log names `postgres`, never the URL.
- `test/db/storage-port.contract.ts` is one behaviour suite (commit, rollback, dry run, three unique violations, one winner for concurrent claims). It runs on SQLite always and on Postgres when `TEST_POSTGRES_URL` is set.
- `turbo.json` declares `TEST_POSTGRES_URL` in `globalEnv`.
- Not done: no Postgres CI service; the Postgres suites skip without `TEST_POSTGRES_URL`. Deadlock retry on Postgres is not added; a deadlock surfaces as an error.
