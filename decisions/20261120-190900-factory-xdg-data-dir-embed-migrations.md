---
scope: factory
summary: Default sf and factory-server state to XDG data dir, pass FACTORY_DATA_DIR on spawn, embed SQLite migrations
why: Per-repo ./.factory-local isolated state per checkout, and migrations read from disk broke outside the monorepo
date: 2026-11-20
tags: [v2, xdg, data-dir, migrations, server, cli]
---

- Default data dir: `$XDG_DATA_HOME/sf`, fallback `~/.local/share/sf` (`||`, so empty `XDG_DATA_HOME` falls back).
  - `apps/factory/src/config.ts` and `apps/factory-server/src/config.ts`: private `XDG_DATA_HOME` constant, `DEFAULT_DATA_DIR`, `DEFAULT_DB_PATH = <dataDir>/factory.db`.
  - Explicit `FACTORY_DATA_DIR` / `FACTORY_DB_PATH` still override.
- `startServer` spawn env now carries `FACTORY_DATA_DIR: input.dataDir`, so the server writes `web-demo.join` and `server.log` in the same dir as `server.pid`.
- Migrations embedded, no disk path:
  - `apps/factory-server/src/db/migrations/index.ts` imports `_journal.json` and each `.sql` (Bun `with { type: 'text' }`), exports `embeddedMigrationsOf()`.
  - `createDb` calls drizzle's sqlite dialect `migrate` with the embedded list. Same hashes and `__drizzle_migrations` table, so existing DBs still migrate correctly.
  - Dialect and session reached through an internal cast: drizzle's public `migrate()` only reads from disk.
  - New migration: add its `.sql` import and `SQL_BY_TAG` entry. Drift test fails otherwise.
- Tests:
  - `apps/factory-server/test/db/embedded-migrations.test.ts`: fresh DB gets tables; embedded hashes/timestamps match journal and `.sql` files; every `.sql` on disk is in the journal.
  - `apps/factory-server/vitest.config.ts`: small plugin serves `.sql` as text module under vitest.
  - `apps/factory/test/blackbox/server-commands.test.ts`: `server start` writes `server.pid`, `server.log`, `factory.db`, `web-demo.join` under `$XDG_DATA_HOME/sf`; falls back to `~/.local/share/sf`; `web-demo.join` lands in `FACTORY_DATA_DIR`.
- `turbo.json`: `XDG_DATA_HOME` added to `globalEnv` (lint `turbo/no-undeclared-env-vars`).
- Not changed: `CELL_STATE_PATH`, `CELL_LOG_PATH`, `SUPERVISOR_TOKEN_PATH` stay under cwd `./.factory-local`. `token create` spawn does not pass `FACTORY_DATA_DIR` (only uses `FACTORY_DB_PATH`). `packages/factory-db` untouched.
- Behavior change: existing `./.factory-local/factory.db` users are not migrated; new default DB is empty. Old DB stays where it was.
- Checks: factory and factory-server tests, lint, check-types, prettier, `nitpick:check`, `ci:verify` (see evidence dir).
