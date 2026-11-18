---
status: todo
factory: v2
plan: web-demo
depends_on: []
priority: medium
line: feature
type: feat
---

# Todo: `web-demo-04-server-web-join` — factory-server Join Secret for the Web Client

## 🎯 Objective

Add the server side of localhost auto-registration: a join secret file the web demo can read, and `POST /api/v1/tokens/join` that exchanges it for a short-lived supervisor session with read and write scopes but no admin scope.

---

## 🌐 Context & Problem Statement

- Cells enroll with a `cell_join` token (PLAN §11 and token table in [`apps/factory-server/docs/PLAN.md`](../apps/factory-server/docs/PLAN.md)). The web demo needs the same pattern for a supervisor-scoped client.
- The server plan names `POST /api/v1/tokens/join`, but the route table in §9 has no such route. This task adds it.
- Trust model (PLAN §2 of [`apps/factory-web-demo/docs/PLAN.md`](../apps/factory-web-demo/docs/PLAN.md)): the secret is a file readable only by the server's OS user. It is never printed and never returned by any API.
- Server code shape: [`apps/factory-server/docs/BE_RULES.md`](../apps/factory-server/docs/BE_RULES.md). Procedure, contract, thin Hono route, black-box `app.request()` test.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/` (domain tokens, contracts, procedure, route) and `apps/factory-server/test/blackbox/`.
- **Classification**: `Domain Core` (token kind rules), `Integration` (route).
- **Scope change**: the server gains one route and one token kind (`web_session`). This is server work, not demo work.
- **Files** (names follow existing layout):
  - `domain/tokens/` rule: `web_join` secret kind, `web_session` kind with scopes `['supervisor:read', 'supervisor:write']`, TTL 24 h.
  - `application/procedures/tokens/join-token.procedure.ts`: `publicProcedure`, loopback-only check, exchanges join secret for session.
  - `contracts/tokens.contract.ts`: `joinTokenContract` (`in.body: { joinSecret }`; `out` 201 with `{ token, expiresAt }`, 401, 403).
  - `adapters/hono/routes/tokens.route.ts`: `.post('/join', honoAdapter(joinTokenProcedure))`.
  - Startup: `src/index.ts` writes `$FACTORY_DATA_DIR/web-demo.join` (`0600`) with a new random secret each start (replaces the previous one).
- **Dependencies**: none new.

---

## 🛠️ Implementation Plan

1. Token kinds: add `web_join` (stored hashed like other Safe Tokens) and `web_session`. `web_session` cannot hold `admin:tokens`.
2. Startup writes the join file. Overwrites previous file. Failure to write aborts startup with a message.
3. `POST /api/v1/tokens/join`:
   - Rejects non-loopback remote address with `403`.
   - Verifies the secret with `timingSafeEqual` against the hashed `web_join`; invalid returns `401`.
   - Consumes the join secret (single use), issues `web_session`, returns `201 { token, expiresAt }`.
   - Runs inside `immediateTx` (BE_RULES §5).
4. The join secret is never logged, never in an error body, never in `state_transitions`.
5. Black-box tests (`test/blackbox/tokens-join.test.ts`):
   - valid secret returns a session that can call `GET /api/v1/cells` and cannot call `POST /api/v1/tokens`;
   - second use of the same secret returns `401`;
   - non-loopback address returns `403`;
   - wrong secret returns `401`.

---

## ✅ Acceptance Criteria

- [ ] `factory-server` writes `web-demo.join` with mode `0600` on start.
- [ ] `POST /api/v1/tokens/join` with a valid secret returns `201` and a session token.
- [ ] The session can read and write work orders and cannot call `POST /api/v1/tokens` (`403`).
- [ ] Re-using the join secret returns `401`.
- [ ] Non-loopback caller returns `403`.
- [ ] The join secret and session token do not appear in logs or `state_transitions`.
- [ ] `pnpm --filter @repo/factory-server check-types`, `test`, `lint` pass; `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`), noting the new token kind and route.
- [ ] Evidence per [evidence](.agents/skills/evidence/SKILL.md): test output for the four black-box cases.

---

## ❓ Open Questions

- Single-use join secret re-minted on each server start (recommended) vs. multi-use for 24 h.
