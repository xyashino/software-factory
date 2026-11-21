---
status: queued
priority: medium
line: standard
type: feat
---

# bun-sqlite-kit-package: shared Bun SQLite plumbing package

## 🎯 Objective

Create `@repo/bun-sqlite-kit`: generic `createDb`, transactions, column helpers, embedded-migration builder. No consumers yet.

---

## 🌐 Context & Problem Statement

Cell and factory each hold copy of `src/db/client.ts` + `columns.ts`. Copies hide drizzle internals hack (`dialect`/`session` cast) and diverge: only cell does `chmod 0600`. One package = one fix point. See `docs/bun-sqlite-kit-plan.md`.

---

## 📦 Specification / Scope

- **Target**: `packages/bun-sqlite-kit`
- **Classification**: `Infrastructure`
- **Dependencies**:
  - `drizzle-orm: catalog:`
  - dev: `@types/bun: catalog:`, `@types/node: catalog:`, `eslint: catalog:`, `typescript: catalog:`, `vitest: catalog:`, `@repo/eslint-config: workspace:*`, `@repo/typescript-config: workspace:*`
- Out: schemas, migration files, queries, repositories, `drizzle.config.ts`, `sql.d.ts`.

---

## 🛠️ Implementation Plan

1. **Initialize File Structure** (mirror `packages/prompt`):
   - `package.json`: `name @repo/bun-sqlite-kit`, `type module`, `private`, `exports {"./*": "./src/*.ts"}`, scripts `check-types`, `lint`, `test` = `bun --bun vitest run`.
   - `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`.
   - `src/create-db.ts`, `src/immediate-tx.ts`, `src/columns.ts`, `src/embedded-migrations.ts`.
   - tests in `src/__tests__/`.
2. **Core Logic & Behavior**:
   - `createDb<S>(path, { schema, migrations, fileMode? })` returns `BunSQLiteDatabase<S>`. `fileMode` default `0o600`.
     - Open `bun:sqlite` `Database`. If path is not `:memory:`, `chmodSync(path, fileMode)`.
     - Exec pragmas: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
     - `drizzle(sqlite, { schema })`, then `dialect.migrate(migrations, session)` through the one `InternalMigrator` cast, keep the why-comment.
   - Types: `BunSqliteDb<S>`, `BunSqliteTx<S>` (tx param of `transaction` callback).
   - `immediateTx(db, fn)` = `db.transaction(fn, { behavior: 'immediate' })`, generic over `S`.
   - `columns.ts`: move `timestamps`, `jsonColumn`, `idText` unchanged.
   - `embeddedMigrationsOf({ journal, sqlByTag })` returns `MigrationMeta[]` (type from `drizzle-orm/migrator`). Per entry: `sql` = query split on `--> statement-breakpoint`, `bps`, `folderMillis` = `when`, `hash` = sha256 of query. Throw `no embedded SQL for migration <tag>` if tag missing. Same logic as `apps/factory/src/db/migrations/index.ts`.
   - Follow `coding-export-order`: constants, types, private helpers, exported functions.
3. **Exports & Integration**:
   - Consumers import subpaths: `@repo/bun-sqlite-kit/create-db`, `/immediate-tx`, `/columns`, `/embedded-migrations`. No `index.ts`.
   - Apps keep `.sql` imports (`with { type: 'text' }`), `sql.d.ts`, journal JSON.

Tests (black box, AAA, story names, tiny fixture schema in test):
- fresh `:memory:` db has migrated tables.
- file db is WAL, foreign keys on, busy timeout 5000.
- file db mode is `0600`; custom `fileMode` honored; `:memory:` does not throw.
- `immediateTx` commits on success, rolls back on throw, takes write lock at start.
- migrations: hash and split correct; missing tag throws; re-open does not re-apply.
- `columns`: `timestamps` not-null, `jsonColumn` round-trips, `idText` plain text.

---

## ✅ Acceptance Criteria

- [ ] `packages/bun-sqlite-kit` exists, no barrel, subpath exports work.
- [ ] `createDb` sets 4 pragmas and `0600` mode for file DBs.
- [ ] Drizzle private-field cast exists once, with comment and a test that fails if migrate breaks.
- [ ] `createDb<S>` keeps full schema typing (`db.query.<table>` typed in a test).
- [ ] Strict TypeScript typings without `any` or loose assertions beyond the single internals cast.
- [ ] One new ADR in `decisions/`.
- [ ] Passes verification gate (`pnpm ci:verify`).
