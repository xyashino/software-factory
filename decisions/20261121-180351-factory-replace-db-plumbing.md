---
scope: factory
summary: Factory DB uses shared bun-sqlite-kit, files 0600
why: factory duplicated cell db client and columns and stored safeTokens without chmod; one kit is one fix point
date: 2026-11-21
tags: [sqlite, drizzle, db]
---

- `apps/factory` depends on `@repo/bun-sqlite-kit` (`workspace:*`).
- `src/db/client.ts`: thin binding; keeps `Db`, `DbTx`, `createDb`, `immediateTx` exports so ~40 imports stay unchanged.
- `src/db/migrations/index.ts`: keeps SQL imports and journal, delegates to kit `embeddedMigrationsOf`.
- Deleted `src/db/columns.ts`; schema files import `@repo/bun-sqlite-kit/columns`.
- Behavior change: factory DB file is `chmod 0600` on create; existing looser file tightened on next open.
- Pragmas and generic `immediateTx` now covered by kit tests; factory `immediate-tx` test removed.
- New test: created DB is `0600`; opening a `0644` file tightens it to `0600`.
- Schema tables, migration SQL, `drizzle.config.ts`, cell app untouched. `db:check` passes.
