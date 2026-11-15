---
status: todo
priority: high
depends_on: [passive-server-01-drizzle-schema]
line: feature
factory: v2
plan: passive-server
---

# passive-server-02: Every factory-db store on the Drizzle query builder

## Objective

Replace the raw `db.run` / `db.query` / `db.prepare` SQL in `packages/factory-db` with typed Drizzle queries over `schema.ts`, so row types come from the schema and there is one way to talk to the database. Transactions stay raw `BEGIN IMMEDIATE` (STORAGE §3.1).

## Read first

- `docs/STORAGE.md` (§2, §3, §3.1), `docs/RULES.md` (§2.3 read validation)
- `packages/factory-db/src/db.ts` (`drizzleOf`), `schema.ts`, `write-mutex.ts`, `writer-lock.ts`
- Raw-SQL stores: `cells-table.ts`, `signals-table.ts`, `join-tokens-table.ts`, `projects-table.ts`, `supervisor-tokens-table.ts`, `intake-table.ts`, `sqlite-lease-store.ts`, `sqlite-blob-store.ts`, `archive.ts`, `rebuild-projections.ts`, `export-import.ts`, and the remaining raw statements in `sqlite-event-store.ts`
- `packages/factory-core/src/ports/*` (the port contracts these stores implement)

## Deliverables

1. **Conversion (`packages/factory-db`):**
   - Rewrite each store above with the Drizzle query builder on `FactoryDatabase`: `insert … onConflictDoUpdate / onConflictDoNothing`, `update`, `delete`, `select` with `eq`/`and`/`inArray`, `.get()` / `.all()` / `.run()`.
   - Delete hand-written row interfaces (`CellRow`, etc.); use `typeof table.$inferSelect` / `$inferInsert`. JSON columns keep their zod validation on read (RULES §2.3).
   - Keep `StatementGate`, `writer.assertHeld()`, the write mutex and raw `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` / savepoints exactly where they are today. Drizzle statements run inside them on the same connection; no `orm.transaction`.
   - The only raw SQL left: transaction control, pragmas in `openDatabase`, the migration runner, and anything Drizzle cannot express (each with a one-line comment why). Add a lint rule or test that flags new `db.run(`/`db.query(`/`db.prepare(` outside an allowlist.
2. **No behaviour change:** port contracts in `factory-core` and every public function signature in `factory-db` stay the same.
3. **Tests:** the existing store, contract, mutex, export/import and rebuild tests pass unchanged; add a test for the raw-SQL allowlist.
4. **Docs:** update `docs/STORAGE.md` §1–§3 to describe the Drizzle-only query layer.

## Acceptance criteria

- [ ] No raw SQL in `packages/factory-db/src` outside the documented allowlist.
- [ ] All `factory-db`, `factory-runtime` and `apps/server` tests pass without edits to their assertions.
- [ ] `pnpm ci:verify` passes.

## Note

`perf-04-runtime-queue-and-sqlite-reads` also changes these stores (read connection split). Whichever lands second rebases onto the other; prefer landing this first.
