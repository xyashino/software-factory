---
scope: factory
summary: Embed local SQLite engine in Factory daemon (standalone)
why: Standalone Factory must scale Cells and serve their relay calls without HQ; the engine reuses the HQ app over a per-process loopback token
date: 2026-11-24
tags: [factory, local-engine, sqlite, standalone, relay]
---

- `apps/factory/src/local-engine.ts`: opens `$XDG_DATA_HOME/sf/factory-local.db` (`:memory:` in tests) with `@repo/hq` `createDb` + `createApp`, seeds factory row `fac_local`, exposes `fetch`, `ensureProject`, `goneCell`, `localToken`.
- Local bearer is a random per-process token, not "any bearer": only the daemon and its Cells hold it, so other local processes get `401` on direct `/api/v1/*`.
- `src/app.ts` takes ports + local engine and returns `{ fetch, tick, reconcile, stop }`; `src/index.ts` only builds ports, timers, `Bun.serve` and shutdown. Tests import `app.ts` without side effects.
- Not connected (`credential === null`): `PUT /scale` upserts the project (`repoUrl` from `git remote get-url origin`, fallback repo path; base branch `main`) and starts Cells; gate no longer blocks on `not_connected`.
- Not connected: `/relay/api/v1/*` (claims, heartbeats, transitions, incident resolve) served by local engine; relay reads the credential live per request.
- Not connected: killing a Cell calls local gone-Cell, requeuing its job and bumping epoch.
- Connected: `/relay/api/v1/*` still relayed to HQ; direct `/api/v1/*` returns `409 refused` with `factory is connected to HQ; disconnect or omit --local`; `unreachable` and `rejected` still block scaling.
- `RepoConfigPort` gains `repoUrlOf`; `apps/factory` depends on `@repo/hq` and `@repo/bun-sqlite-kit`; factory tsconfig includes `../hq/src/sql.d.ts`; vitest gets the same `.sql`-as-text plugin HQ uses.
- Out of scope, unchanged: `POST /queue/import`, `sf --local` flags, `apps/sf`.
