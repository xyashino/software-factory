---
status: todo
priority: high
depends_on: [v2-04-core-harness-scenarios-properties]
workflow: feature
---

# v2-07: Storage — contract suite, SQLite event store, projection

## Objective

Give the Factory a durable, idempotent, concurrency-safe event store: a shared contract suite, an
in-memory fake and the SQLite implementation that both pass it, with the `orders` projection
written in the same transaction and rebuildable byte-for-byte.

## Read first

- `docs/STORAGE.md` §1–4, §6, §9 (§3.1 on the synchronous driver is critical)
- `docs/CORE.md` §10 (I10), `docs/RULES.md` §2, §6
- v1: `packages/software-factory/src/testing/{store.contract.ts,fake-store.ts}`,
  `src/adapters/store/sqlite-store.ts`

## Scope (ROADMAP items)

`factory-m3-contract`, `factory-m3-tx-spike`, `factory-m3-sqlite`, `factory-m3-projection`.

## Deliverables

1. Contract suite in `factory-core/testing`: append, `conflict`, `replayed`, feed order, projection
   written atomically, `transaction` isolation, two concurrent appenders, a slow transaction body.
2. In-memory `EventStore` fake passing it.
3. Spike first, kept as a test: one write mutex around `append` / `transaction` over `bun:sqlite`
   proves no foreign statement joins an open write transaction. Record the result in `decisions/`.
4. `factory-db`: `migrations/0001_init.sql` (all tables of STORAGE §4), migration runner
   (`schema_migrations`, one transaction), SQLite `EventStore` (STORAGE §3) passing the suite.
5. Projection rebuild function (fold with core `evolve` + `toProjection`, write through
   `factory-db`) and a test that rebuilding gives an identical `orders` table on every scenario
   fixture from v2-04.

## Out of scope

Leases, blobs, export (v2-08). Hono / HTTP.

## Acceptance criteria

- Fake and SQLite pass the same contract suite, including 2 concurrent appenders.
- Identical-rebuild test green.
- `factory-db` never calls `decide`, `nextJob` or `toProjection` (RULES §4.6; lint or test).
- `pnpm turbo check-types lint test` green.
