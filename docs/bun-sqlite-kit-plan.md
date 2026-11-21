# bun-sqlite-kit plan

## Goal

One shared package for opening and configuring SQLite via Bun + drizzle. Factory adopts first. Cell follows later.

## Why

- `apps/cell/src/db/client.ts` and `apps/factory/src/db/client.ts` near-identical: pragmas, `createDb`, `immediateTx`, `Db`/`DbTx`, drizzle internals hack (`dialect`, `session`).
- `columns.ts` byte-identical in both.
- Factory skips `chmod 0600` on DB file. Cell does it. Factory holds `safeTokens`. Gap.
- Drizzle upgrade can break internals hack. Today fix in two places.

## Decisions

- Name `@repo/bun-sqlite-kit`, dir `packages/bun-sqlite-kit`. Not agnostic: only SQLite on Bun used, no second driver to design against.
- No `db-cell` / `db-factory` packages: one consumer each, schema + migrations + `drizzle.config.ts` belong to app.
- No barrel. Subpath exports `"./*": "./src/*.ts"` like `packages/operator-protocol`.
- Kit owns plumbing only. No schema, no migration files, no queries, no repositories.
- `MigrationMeta` comes from public `drizzle-orm/migrator`. Only `dialect` and `session` are private drizzle fields.

## Split

| Todo | What | Depends on |
| --- | --- | --- |
| `bun-sqlite-kit-package` | Create package, tests, no consumers | none |
| `factory-adopt-bun-sqlite-kit` | Rewire factory, add 0600 test | package |

Two todos, not one: package is reviewable alone, factory switch is the behavior change (file mode).

## Out of scope

- Cell adoption: follow-up todo after factory lands. Verify cell `embeddedMigrationsOf` matches factory first (not checked).
- Repository layer (`settings.set` style): ~20 cell + ~40 factory files use `ctx.db` directly. Separate refactor, inside apps as ports, not in kit.
- `server-kit` (zod, hono adapter, errors, clock): separate effort.

## Risks

- Factory DB files tighten to 0600 on open, incl. existing ones. Intended. Note in ADR.
- Kit Bun-only (`bun:sqlite`). Rename if runtime changes.
- Generic `Db<S>` typing must keep procedure call sites compiling unchanged.

## Verify

`pnpm ci:verify`.

## Related

Contract packages and full order: `docs/contracts-plan.md`.
