---
scope: factory/db
summary: factory-db stores query through Drizzle; raw SQL is allowlisted
why: One query layer keeps row types in schema.ts; raw SQL stays only where Drizzle cannot express it, pinned by a test
date: 2026-11-15
tags: [storage, drizzle, sql]
---

- Every `factory-db` store queries through the Drizzle builder on `FactoryDatabase`; row types come from `$inferSelect` and `$inferInsert`.
  - The hand-written row interfaces are gone.
- Raw SQL remains only for connection pragmas, transaction control, the migration runner and `VACUUM INTO`.
  - Each remaining call carries a one-line `raw:` reason.
- `src/__tests__/raw-sql-allowlist.test.ts` pins the raw-call count per file; a new raw call fails until the allowlist names it.
- Transactions stay on raw `BEGIN IMMEDIATE` on the same connection, with the write mutex and `StatementGate` unchanged; `orm.transaction` is not used because it would issue a plain `BEGIN`.
- Port contracts and every `factory-db` public signature are unchanged.
