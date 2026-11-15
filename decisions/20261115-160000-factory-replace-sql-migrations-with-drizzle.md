---
scope: factory/db
summary: schema.ts is the migration source; drizzle-kit writes drizzle/
why: Hand-written SQL mirrored by a parity test could drift; generated migrations and a CI drift check keep one definition
date: 2026-11-15
tags: [storage, migrations, drizzle]
---

- `src/schema.ts` is the only schema definition. `drizzle-kit generate` writes the baseline `drizzle/0000_baseline.sql` and every later migration; the frozen `migrations/` holds only 0001-0003.
- `migrate.ts` applies `drizzle/meta/_journal.json` forward only, in one `BEGIN IMMEDIATE` transaction; any failure rolls the whole batch back.
- A database whose history holds 0001-0003, or a prefix of them, runs the missing legacy files in order, then records the baseline as applied without executing it. Its data is kept.
- Legacy rows stay in `schema_migrations` and count as known, so an adopted database opens again without error.
- Unknown history is refused before anything runs: a gap, an unknown name, or tables without a migration history.
- `db:check` runs in `pnpm ci:verify`. It runs `drizzle-kit check` and fails when `schema.ts` would generate a new migration.
- `unique()` becomes a unique index, which SQLite treats like an inline `UNIQUE`. The parity test is replaced by a fresh-baseline versus legacy schema equality test.
