---
scope: factory
summary: Drizzle schema and typed queries over the SQLite store
why: Typed queries catch column drift, and the SQL migrations stay the DDL truth, so a parity test ties the two.
date: 2026-11-14
tags: [v2, storage, drizzle, sqlite, schema]
---

- **Drizzle is the query layer only.** `migrations/0001_init.sql` stays the DDL source of truth, `migrate.ts` is unchanged, and drizzle-kit is not used.
  - `schema.ts` declares the eleven STORAGE §4 tables with `drizzle-orm/sqlite-core`, and exports the inferred record types.
  - `schema.ts` holds no domain logic: it does not call `decide`, `nextJob` or `toProjection`.
- **One connection, one lock.** `db.ts` wraps the same `bun:sqlite` handle with `drizzle(db, { schema })`.
  - `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK` and the `append` savepoints stay raw SQL on that handle.
  - `orm.transaction` is never used, because it would issue a plain `BEGIN`.
- **Store modules use Drizzle.** `sqlite-event-store`, `orders-table`, `rebuild-projections` and `projects-table` run their table statements through typed builders.
  - Raw `db.run`/`db.query` calls remain only in the out-of-scope stores (signals, workers, leases, blobs) and in `migrate.ts`.
- **Parity test.** `schema.test.ts` applies `0001_init.sql` to an in-memory database and compares each table with `PRAGMA table_info`, `index_list`, `index_info` and `foreign_key_list`.
  - Key columns skip the NOT NULL flag, because Drizzle implies it on `primaryKey()` while SQLite does not store it.
- **Row shape.** `OrderRow` is the Drizzle select type, with camelCase keys. Column mapping (`lastCellId`, `avoidCells`) and JSON and 0/1 encoding are unchanged, so `rawOrders` stays byte-identical.
