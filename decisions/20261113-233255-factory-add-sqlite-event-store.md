---
scope: factory
summary: SQLite event store behind one write mutex, shared contract suite
why: Appends and transactions must be atomic and idempotent, and bun:sqlite is synchronous, so a foreign statement can join an open write transaction on one connection.
date: 2026-11-13
tags: [v2, storage, event-store, sqlite, transactions, projection]
---

- **Spike result (factory-m3-tx-spike).** One `bun:sqlite` connection, two async tasks.
  - Without a mutex, a task that awaits inside an open `BEGIN IMMEDIATE` lets a foreign `INSERT` join that transaction, and the rollback erases it.
  - Without a mutex, a second `BEGIN IMMEDIATE` fails with "cannot start a transaction within a transaction".
  - With one FIFO write mutex around `append`, `transaction`, reads and the rebuild, N writers with slow bodies never interleave.
  - The control and guarded cases stay as `factory-db/src/__tests__/write-mutex.spike.test.ts`.
- **One contract, two stores.** `defineEventStoreContract` lives in `factory-core/testing` and takes `describe`/`it` from the caller, so core ships no test framework.
  - The in-memory fake and SQLite (in memory and on a WAL file) run its 16 cases.
  - The cases include two concurrent appenders and a slow transaction body.
- **Port change: `AppendInput.at`.** `decide` emits bare events, so the caller supplies the clock. The store stamps `at` on every event it writes and never reads a clock itself.
- **The store never decides.** `factory-db` writes the projection row it is handed.
  - `rebuildProjections` takes the row builder as a parameter, so `factory-db` source does not import or call `decide`, `nextJob` or `toProjection`.
  - A test scans the non-test sources for those names.
- **Column names follow STORAGE §4.** The projection's `lastWorkerId` maps to `last_cell_id`, and `avoidWorkers` maps to `avoid_cells` as `[{ cellId, until }]`.
  - The docs say "Cell" where core says "worker"; the ids are the same, only the name drifts.
  - Renaming the core fields is a follow-up, not part of this change.
- **Projects are not invented.** `orders.project_id` references `projects`, so the store does not insert a stub project.
  - Tests seed the project row. The Factory creates projects when it registers them.
- **Reads queue behind writes.** `load` and `feed` run through the same mutex, so no statement touches the connection while a write transaction is open.
  - A reader that starts during a transaction sees either nothing or all of it, never part of it.
- **Fixtures live in core testing.** `steps` and `runner` moved from `order/__tests__` to `factory-core/src/testing`.
  - The nine named v2-04 scenario histories are shared with `factory-db`.
  - The rebuild test checks the `orders` table is byte-identical after a rebuild on every fixture.
- **Migrations.** `0001_init.sql` is STORAGE §4 verbatim.
  - `migrate` is forward-only and applies all pending files in one `BEGIN IMMEDIATE`.
  - It records each name in `schema_migrations` and refuses to run when an applied file is missing.
- **Out of scope.** Leases, blobs and export (v2-08), and the `acquireWriter` file lock.
