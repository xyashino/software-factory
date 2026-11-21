---
scope: repo
summary: Add shared bun-sqlite-kit package for SQLite plumbing
why: cell and factory copied db client and columns; one package is one fix point
date: 2026-11-21
tags: [sqlite, drizzle, packages]
---

- New `packages/bun-sqlite-kit` (`@repo/bun-sqlite-kit`), private, subpath exports `./*` to `src/*.ts`, no barrel.
- `createDb(path, { schema, migrations, fileMode? })`: sets WAL, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- File DBs get `chmod` to `fileMode` (default `0600`); `:memory:` skips chmod.
- Drizzle private `dialect`/`session` cast kept once in `create-db.ts`; covered by fresh-db migration test.
- `immediateTx(db, fn)`: `BEGIN IMMEDIATE` transaction, generic over schema.
- `columns`: `timestamps`, `jsonColumn`, `idText` moved unchanged.
- `embeddedMigrationsOf({ journal, sqlByTag })`: split on breakpoint, sha256 hash, throws on missing tag.
- No consumers yet. Factory and cell adoption are separate todos.
