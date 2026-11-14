---
status: todo
priority: medium
depends_on: [factory-demo-01-app-setup]
line: feature
factory: v2
plan: factory-demo
---

# factory-demo-02: Astro BFF endpoints and server connection gate

## Objective

Connect `apps/factory-demo` to `factory-server` HTTP API via type-safe Astro backend endpoints (`/api/*`) and React connection/auth gate.

## Read first

- `packages/factory-core/src/contracts/http-routes.ts`, `http-codec.ts`, `routes.ts`, `supervisor.ts`, `errors.ts`
- `apps/server/src/http/app.ts`, `apps/server/src/socket/serve.ts`
- `apps/cli/src/client/remote.ts`
- `.agents/rules/astro.md`, `.agents/rules/frontend.md`, `.agents/rules/ux.md`, `.agents/rules/msw-backend-mocks.md`

## Deliverables

1. **Server proxy & session endpoints (`src/pages/api/`):**
   - Validate all inputs and outputs with `zod` (`astro-backend-endpoints`), reusing `@repo/factory-core/contracts/*` schemas and `http-codec` / `httpPath`.
   - Connection config: read `FACTORY_URL` / `FACTORY_TOKEN` env defaults or `HttpOnly` session cookie set by `POST /api/session` (tests `GET /v1/board` before saving); `DELETE /api/session` clears cookie; `GET /api/session` returns `{ connected, baseUrl }` without ever exposing token.
   - Proxy routes:
     - `GET /api/board`, `GET /api/plans`, `GET /api/plans/[id]`, `GET /api/orders/[id]`
     - `POST /api/orders/[id]/answer`, `resume`, `reopen`, `nudge`, `cancel`, `reprioritise`
     - `POST /api/intake/sync`
     - `GET /api/cells`, `DELETE /api/cells/[id]`
     - `GET /api/join-tokens`, `POST /api/join-tokens`, `DELETE /api/join-tokens/[id]`
     - `GET /api/projects`, `POST /api/projects`, `POST /api/projects/[id]`, `DELETE /api/projects/[id]`
     - `GET /api/admin/export`, `POST /api/admin/rebuild-projections`, `POST /api/admin/recover`
     - `GET /api/blobs/[ref]` (stream/text fetch for prompt & inspection blobs)
     - `GET /api/stream` (SSE proxy forwarding `GET /v1/stream?after=...` with `Last-Event-ID`)
   - Map `factory-server` wire errors (`unauthorized`, `unavailable`, `precondition`, `conflict`, `invalid`, `not_found`) to clean JSON status responses.
2. **Client integration & Connection Gate (`src/shared/` & `src/modules/connection/`):**
   - Follow `frontend-architecture.md` layers (`domain/`, `core/`, `integration/`, `presentation/`).
   - CSR `ConnectionGate` island: connect/disconnect form (`Server URL`, `Supervisor Token`), inline validation, skeleton while checking session, structured error card (`icon:title:tech-code:description:retry-option:back-option`), toast on connect/disconnect.
3. **Tests & ADR:**
   - Tests using `msw` (`setupServer`, `http`, `HttpResponse`, `onUnhandledRequest: 'error'`) for session endpoints, error mapping, and `ConnectionGate` flows. Never stub `fetch`.
   - One `decisions/` ADR entry.

## Scope guardrails

- Do not modify `apps/server` (CORS not needed because Astro BFF proxies server-to-server).
- Do not build Work order, Plan, Cell, Project, or Admin UI views yet (WO 3–5).

## Acceptance criteria

- [ ] Every `/api/*` route validates input/output with `zod` and never leaks tokens in HTML/JSON/logs.
- [ ] All tests use `msw` per `.agents/rules/msw-backend-mocks.md`.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm --filter @repo/factory-demo build` pass.
