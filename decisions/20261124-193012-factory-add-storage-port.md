---
scope: factory/hq
summary: Put a StoragePort between hq application code and bun:sqlite
why: Application code must not depend on drizzle or sync SQLite so another dialect can be added later
date: 2026-11-24
---

- `application/ports/storage.port.ts` defines `StoragePort` with `read(fn)` and `write(fn, { dryRun })`, transaction-scoped repos per aggregate, and plain row and insert types.
- Transaction callbacks are sync (`(tx) => T`); the methods return `Promise<T>`. Deviates from the task text `Promise<T> | T`.
  - `bun:sqlite` has one connection, so an `await` inside `BEGIN IMMEDIATE` would let other requests interleave on it.
- `adapters/storage/sqlite-storage.adapter.ts` holds every drizzle query for application data. `write` runs inside `immediateTx`.
- Dry run rolls back every change and returns the callback result. Replaces `tx.rollback()` plus the caught `TransactionRollbackError` in queue import.
- Enum tuples moved to `domain/common/vocabulary.ts`; `STATION_KINDS` is exported from `domain/orders/job-transitions.ts`. The db schema and the port read the same tuples.
- Procedures, the safe-token auth adapter, the stream route, `mintAdminToken` and `writeWebJoinFile` take `storage`. The two bootstrap helpers are async and `index.ts` awaits them.
- `apps/hq/src/application/` has no `drizzle-orm` or `db/` imports.
- Blackbox tests that call `mintAdminToken` or `writeWebJoinFile` now await them; assertions unchanged. `createTestApp` also returns `storage`.
- New `test/db/storage-port.test.ts` covers commit, rollback and dry run through the port.
- Postgres driver, Postgres schema and `HQ_DATABASE_URL` stay out of scope.
