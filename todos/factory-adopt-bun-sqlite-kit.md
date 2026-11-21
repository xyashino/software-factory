---
status: queued
priority: medium
line: standard
type: refactor
depends_on: bun-sqlite-kit-package
---

# factory-adopt-bun-sqlite-kit: factory uses shared SQLite kit

## 🎯 Objective

Replace factory's local DB plumbing with `@repo/bun-sqlite-kit`. Factory DB file gets `0600`. Call sites unchanged.

---

## 🌐 Context & Problem Statement

`apps/factory/src/db/client.ts` + `columns.ts` duplicate cell copies. Factory also lacks `chmod 0600` while storing `safeTokens`. ~40 factory files import `Db`/`DbTx`/`immediateTx` from `db/client`; keep that import path to keep diff small.

---

## 📦 Specification / Scope

- **Target**: `apps/factory`
- **Classification**: `Infrastructure`
- **Dependencies**:
  - `@repo/bun-sqlite-kit: workspace:*` (`linkWorkspacePackages: false`, declare explicitly, then `pnpm install`)
- Out: schema tables, migration SQL, `drizzle.config.ts`, `sql.d.ts`, cell app, any repository layer.

---

## 🛠️ Implementation Plan

1. **Initialize File Structure**:
   - `apps/factory/package.json`: add dep.
   - `src/db/client.ts`: thin app binding.
   - `src/db/migrations/index.ts`: call kit builder.
   - delete `src/db/columns.ts`.
   - `src/db/schema/*.ts` (8 files): import columns from `@repo/bun-sqlite-kit/columns`.
2. **Core Logic & Behavior**:
   - `client.ts`: keep `schema` object. `export type Db = BunSqliteDb<typeof schema>`, `DbTx = BunSqliteTx<typeof schema>`. `export const createDb = (path: string): Db => createKitDb(path, { schema, migrations: embeddedMigrationsOf() })`. `immediateTx` re-bound with factory `Db` type so imports elsewhere stay.
   - `migrations/index.ts`: keep `.sql` imports, `SQL_BY_TAG`, journal import; export `embeddedMigrationsOf = () => buildMigrations({ journal, sqlByTag: SQL_BY_TAG })`.
   - Tests: drop what kit now covers (pragmas, generic immediate-tx). Keep `schema-indexes`, and the check that embedded SQL equals files on disk and journal. Add test: DB file created via `createDb(createTempDbPath())` has mode `0600`; reopening a `0644` file tightens it.
   - Behavior change to note in ADR: factory DB files become `0600`, existing ones on next open.
3. **Exports & Integration**:
   - No other factory file edited beyond schema column imports. If tsc forces more edits, stop and report.
   - Cell untouched; follow-up todo.

---

## ✅ Acceptance Criteria

- [ ] `apps/factory/src/db/columns.ts` gone; no duplicate pragma list or internals cast in factory.
- [ ] Factory DB file mode `0600` verified by test, incl. existing looser file.
- [ ] All existing factory tests pass without changing assertions on behavior.
- [ ] `pnpm db:check` (drizzle-kit) still passes, migrations unchanged.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
