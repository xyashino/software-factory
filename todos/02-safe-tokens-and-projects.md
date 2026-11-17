---
status: todo
priority: high
depends_on:
  - 01-foundation-and-db
line: feature
type: feat
---

# Todo: `02-safe-tokens-and-projects` — Safe Token Security & Project Registration

## 🎯 Objective

Implement Safe Token cryptography, lifecycle, and RBAC (`sf_sup_`, `sf_join_`, `sf_cell_` per `PLAN.md` §8 & §9) along with repository Project registration (`POST /api/v1/projects`, `GET /api/v1/projects`).

---

## 🌐 Context & Problem Statement

Every API endpoint in `@repo/factory-server` requires scoped Bearer token authentication (`supervisor:read`, `supervisor:write`, `admin:tokens`, `cell:enroll`, `cell:worker`), and every `OrderPlan`, `WorkOrder`, `Job`, and `Cell` is pinned to a registered `projectId` from `<repo>/.factory/config.json`. This slice delivers the real `SafeTokenAuthAdapter`, token management endpoints, and project registry.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/{domain/tokens,contracts,application/procedures/{tokens,projects},adapters/{auth,hono/routes}}`
- **Boundary**: Strictly backend-only inside `apps/factory-server/` (do not connect or edit `apps/cell`, `apps/cli`, or `packages/factory-*`; simulate Cell/Supervisor HTTP calls via `app.request()` in `apps/factory-server/test/`).
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - `hono: catalog:`
  - `drizzle-orm: catalog:`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Pure Token Domain (`src/domain/tokens/token-rules.ts`)**:
   - Token kinds & prefixes (`supervisor` -> `sf_sup_`, `cell_join` -> `sf_join_`, `cell_session` -> `sf_cell_`).
   - Allowed scopes per token kind (`supervisor`: `['supervisor:read', 'supervisor:write', 'admin:tokens']`; `cell_join`: `['cell:enroll']`; `cell_session`: `['cell:worker']`).
   - Pure validation helpers: `isTokenActive(token, now)` checking `revokedAt === null` and `(expiresAt === null || expiresAt > now)`, plus 60s rotation grace window check on rotated tokens.
2. **Safe Token Auth Adapter (`src/adapters/auth/safe-token-auth.adapter.ts`)**:
   - Minting helper: generates 32 CSPRNG bytes (base64url) with prefix, computes SHA-256 hex digest (`token_hash`), and stores only prefix + hash in `safe_tokens`.
   - Verification (`AuthPort.authenticate`): parses `Authorization: Bearer <raw>`, hashes with SHA-256, looks up token row, compares digests via `crypto.timingSafeEqual`, checks `revoked_at` and `expires_at` against `clock.now()`, updates `last_used_at`, and returns `Principal { tokenId, kind, scopes, cellId }`.
3. **Contracts (`src/contracts/tokens.contract.ts`, `src/contracts/projects.contract.ts`)**:
   - `createTokenContract` (`POST /api/v1/tokens`, scope `admin:tokens`): issues `supervisor` or `cell_join` token, returns raw token once (`201`).
   - `rotateTokenContract` (`POST /api/v1/tokens/rotate`, any valid token): issues replacement token of same kind/scopes/cellId, sets old token `expires_at = min(old.expires_at, now + 60_000)` and links `rotated_from_id` (`200`).
   - `revokeTokenContract` (`DELETE /api/v1/tokens/:id`, scope `admin:tokens`): sets `revoked_at = now` immediately (`200`).
   - `createProjectContract` (`POST /api/v1/projects`, scope `supervisor:write`): registers/upserts `{ projectId, repoUrl, defaultBaseBranch, maxRunning }` (`201` / `200`).
   - `listProjectsContract` (`GET /api/v1/projects`, scope `supervisor:read`): lists all registered projects (`200`).
4. **Procedures & Routes**:
   - `src/application/procedures/tokens/`: `create-token.procedure.ts`, `rotate-token.procedure.ts`, `revoke-token.procedure.ts`.
   - `src/application/procedures/projects/`: `create-project.procedure.ts`, `list-projects.procedure.ts`.
   - `src/adapters/hono/routes/`: `tokens.route.ts` (`/api/v1/tokens`), `projects.route.ts` (`/api/v1/projects`), mounted in `src/app.ts`.
5. **Tests**:
   - Unit tests (`src/domain/tokens/__tests__/token-rules.test.ts`): prefix/scope validation, expiry, revocation, and grace window math.
   - Black-box HTTP tests (`test/blackbox/tokens-and-projects.test.ts`): bootstrap admin token, issue `sf_sup_` and `sf_join_`, rotate with 60s grace window (both old and new work inside 60s; old fails at `+61s`), immediate revoke (`401`), scope enforcement (`403` when `cell_join` calls `/api/v1/projects`), and project CRUD.

---

## ✅ Acceptance Criteria

- [ ] Raw tokens are never persisted in `safe_tokens`; only SHA-256 `token_hash` and `prefix` are stored.
- [ ] `POST /api/v1/tokens`, `POST /api/v1/tokens/rotate`, and `DELETE /api/v1/tokens/:id` enforce scopes, TTLs, 60s rotation grace window, and immediate revocation.
- [ ] `POST /api/v1/projects` and `GET /api/v1/projects` register and list projects with `projectId`, `repoUrl`, `defaultBaseBranch`, and `maxRunning`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
