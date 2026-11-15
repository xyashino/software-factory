---
status: todo
priority: high
depends_on: []
line: feature
factory: v2
plan: passive-server
---

# passive-server-01: Drizzle schema as the single source of truth, drizzle-kit migrations

## Objective

Make `packages/factory-db/src/schema.ts` the only definition of the database schema. Migrations are generated from it by `drizzle-kit` instead of being hand-written SQL mirrored by a parity test. Existing data directories keep working without re-running or rewriting history.

## Read first

- `docs/STORAGE.md` (§1, §3.1, §4, §9), `docs/RULES.md`
- `packages/factory-db/src/schema.ts`, `migrate.ts`, `db.ts`, `sqlite-event-store.ts` (`openDatabase`)
- `packages/factory-db/migrations/0001_init.sql`, `0002_join_token_command_id.sql`, `0003_order_plan.sql`
- `packages/factory-db/src/__tests__/schema.test.ts`
- `packages/factory-runtime/src/open-runtime.ts` (migration 0003 triggers a projection rebuild)
- `pnpm-workspace.yaml` (catalog: `drizzle-orm`)

## Deliverables

1. **Tooling (`packages/factory-db`, `pnpm-workspace.yaml`):**
   - Add `drizzle-kit` to the catalog (version compatible with `drizzle-orm` 0.45.x) as a dev dependency of `factory-db`.
   - Add `drizzle.config.ts` (`dialect: 'sqlite'`, `schema: './src/schema.ts'`, `out: './drizzle'`) and scripts `db:generate` and `db:check`.
2. **Schema is the source of truth:**
   - Bring `schema.ts` to the exact shape of migrations 0001–0003 (columns, defaults, indexes, uniques, foreign keys, `CHECK`s expressible in Drizzle). Anything Drizzle cannot express goes in a custom migration (`drizzle-kit generate --custom`), documented in a comment.
   - Generate a baseline migration into `drizzle/` from `schema.ts`. A fresh database built from the baseline must be schema-identical to one built from 0001–0003 (compare `sqlite_master` normalized, as the current parity test does).
3. **Migration runner (`migrate.ts`):**
   - Apply `drizzle/` migrations using drizzle-kit's journal (`drizzle/meta/_journal.json`), forward only, all pending in one `BEGIN IMMEDIATE` transaction (STORAGE §3.1: never `orm.transaction`, never a plain `BEGIN`). Keep the current guarantees: a failure rolls the batch back; an applied migration missing from the folder is an error.
   - Baseline adoption: a database whose `schema_migrations` holds exactly `0001`–`0003` is marked as having the baseline applied, without executing it. A database with an unknown legacy state is refused with a clear error.
   - Keep the "projection rebuild after the plan migration" behaviour of `open-runtime.ts` working for databases that come from before 0003 (they still run the legacy files first, then adopt the baseline). Delete the legacy `migrations/` folder only if no supported database can need it; otherwise keep it frozen and say so in STORAGE §9.
4. **Tests & CI:**
   - Replace the SQL↔schema parity test with: (a) `drizzle-kit check` / generate-produces-no-diff in CI (`db:check` wired into `pnpm ci:verify`), (b) fresh-baseline vs legacy-0001–0003 schema equality, (c) baseline adoption on a legacy database, (d) failure rollback and missing-migration refusal.
5. **Docs:** update `docs/STORAGE.md` §4 and §9 (and `docs/RULES.md` if it mentions hand-written SQL) to say `schema.ts` is the source of truth and how to add a migration.

## Acceptance criteria

- [ ] Changing `schema.ts` and running `pnpm --filter @repo/factory-db db:generate` is the only way to add a migration; CI fails when `schema.ts` and `drizzle/` drift.
- [ ] An existing `.factory/software-factory.sqlite` opens, adopts the baseline without data change, and all runtime tests pass against it.
- [ ] `pnpm ci:verify` passes.
