---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [11-sse-transition-stream]
priority: medium
line: feature
type: feat
---

# Todo: `12-server-entrypoint-and-endpoint-index` — `Bun.serve` Entrypoint and Route Completeness

## 🎯 Objective

Make `@repo/factory-server` runnable: a `Bun.serve` entrypoint with an admin token command, and a test proving every endpoint in `PLAN.md` §9 is mounted.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/index.ts`, `apps/factory-server/src/app.ts` (route mounts only), `apps/factory-server/test/blackbox/route-index.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Infrastructure`
- **Dependencies**: `hono: catalog:`

---

## 🛠️ Implementation Plan

1. `src/index.ts`: `Bun.serve({ port, hostname, fetch: app.fetch })`. SQLite path from `FACTORY_DB_PATH`, default `./.factory-local/factory.db`.
2. `admin token create` subcommand: mint the initial `sf_sup_` supervisor token on a fresh database.
3. Mount every route from `PLAN.md` §9 in `src/app.ts`.
4. Route-index test: each of the 26 endpoints is mounted and returns the correct auth or validation code without a valid token.

---

## ✅ Acceptance Criteria

- [ ] The server starts on the configured port and DB path.
- [ ] `admin token create` on a fresh DB prints a working `sf_sup_` token.
- [ ] All 26 endpoints in `PLAN.md` §9 are mounted and covered by the route-index test.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
