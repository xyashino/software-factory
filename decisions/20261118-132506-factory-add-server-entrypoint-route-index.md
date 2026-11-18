---
scope: factory/server
summary: Bun.serve entrypoint, admin token CLI and full PLAN 9 route index
why: Server must run from a CLI and mount every PLAN section 9 endpoint, with tokens and projects routes added.
date: 2026-11-18
tags: [factory, server, tokens, projects, http]
---

- New `src/index.ts`: `Bun.serve` on `FACTORY_PORT` (default 7070) and `FACTORY_HOST` (default 127.0.0.1). SQLite path from `FACTORY_DB_PATH`, default `./.factory-local/factory.db`.
- `bun src/index.ts admin token create` mints a `sf_sup_` supervisor token on the DB and prints it once. Scopes: `supervisor:read`, `supervisor:write`, `admin:tokens`.
- Mounted `POST /api/v1/tokens` (`admin:tokens`) to issue `supervisor` or `cell_join` tokens. Response is 201 with the raw token once.
- Mounted `POST /api/v1/tokens/rotate` (any valid token). New token copies kind, name, scopes, cell and expiry. Old token stays valid for `TOKEN_ROTATE_GRACE_MS`. Rotating an already-rotated token gives 409.
- Mounted `DELETE /api/v1/tokens/{id}` (`admin:tokens`). Sets `revokedAt`. Unknown id gives 404.
- Mounted `POST /api/v1/projects` (`supervisor:write`). Upserts by `projectId`: 201 on create, 200 on update.
- Mounted `GET /api/v1/projects` (`supervisor:read`), ordered by `projectId`.
- Route-index black-box test covers all 26 PLAN section 9 endpoints. Each returns 401 without a bearer token.
- Added `FACTORY_DB_PATH`, `FACTORY_PORT`, `FACTORY_HOST` to turbo `globalEnv` so the env-var lint rule passes.
- Token and project scope went beyond "route mounts only": these five endpoints were absent from the branch.
