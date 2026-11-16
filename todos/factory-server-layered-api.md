---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
type: refactor
---

# factory-server-layered-api: Refactor `@repo/factory-server` to layered `omino-api` architecture

## 🎯 Objective

Refactor `apps/server` (`@repo/factory-server`) into a clean, domain-divided layered API architecture modeled on `.tmp/omino-api` (`application/core`, `application/ports`, `application/procedures`, `adapters/auth`, `adapters/hono`, `bootstrap`, `app.ts`), while preserving `software-factory` workspace boundaries, shared `@repo/factory-core` contracts, and `PROTOCOL.md` wire compatibility.

---

## 🌐 Context & Problem Statement

Currently, `apps/server/src/http/app.ts` (288 lines) concentrates bearer authentication, credential caching, JSON/binary body reading, route-specific special cases (`blobPut`, `blobGet`, `claim` 204, `submitCommand` lease lookup, `join`, `stream`, `githubWebhook`), and per-route `try/catch` error mapping inside a single `serveRoute` function. Meanwhile, `apps/server/src/once.ts` duplicates Zod request/response parsing and `RuntimeError` to `WireError` mapping for `--once` mode.

Because persistence (`@repo/factory-db`), pure domain/contracts (`@repo/factory-core`), and application use cases (`@repo/factory-runtime`) already live in separate workspace packages, `apps/server` can adopt `omino-api`'s clean API layering (`procedure` + `TransportContext` + `AuthPort` + `honoAdapter` + global Hono middlewares + centralized `.onError`/`.notFound` + domain-split route modules) without duplicating domain or DB layers.

---

## 📦 Specification / Scope

- **Target**: `apps/server/src/` (and `apps/server/package.json` if adding `zod: catalog:`)
- **Classification**: `Infrastructure` / `Integration`
- **Dependencies**:
  - `@repo/factory-core: workspace:*`
  - `@repo/factory-runtime: workspace:*`
  - `hono: catalog:`
  - `zod: catalog:` (optional, if `schema/zod.ts` or contracts reference `zod` types directly)
- **Target Folder Structure**:

```text
apps/server/src/
+-- app.ts                            # createApp(createTransport) (~25 lines)
+-- main.ts                           # process entrypoint, lock, discovery, listener
+-- once.ts                           # --once mode (reuses application/core execution & errors)
+-- admin-command.ts                  # factory-server admin subcommands
+-- runtime-config.ts
+-- usage.ts
|
+-- application/
|   +-- core/
|   |   +-- procedure.ts              # publicProcedure, supervisorProcedure, localSupervisorProcedure,
|   |   |                             # cellProcedure, supervisorOrCellProcedure, runtimeProcedure
|   |   +-- error-handling.ts         # RefusalError + toWireError (WireError)
|   |   +-- schema/
|   |       +-- types.ts              # ZodContract, ContractIn, ContractOut
|   |       +-- zod.ts                # withRouteSchema / withZodSchema
|   +-- ports/
|   |   +-- auth.port.ts              # AuthPort (authenticate -> Caller)
|   |   +-- runtime.port.ts           # RuntimePort (thin facade over Runtime)
|   +-- procedures/                   # divided by domain
|       +-- orders.procedures.ts      # board, orderDetail, createOrder, answer, ...
|       +-- plans.procedures.ts       # plans, planDetail, createPlan, recordPlanPrState
|       +-- cells.procedures.ts       # join, hello, claim (204), heartbeat, submitCommand, ...
|       +-- projects.procedures.ts    # projectList, projectAdd, projectSet, projectRemove
|       +-- blobs.procedures.ts       # blobGet (binary), blobPut (binary)
|       +-- admin.procedures.ts       # adminExport, adminBackup, adminRebuildProjections
|       +-- webhooks.procedures.ts    # githubWebhook (HMAC + recordPullRequest)
|
+-- adapters/
|   +-- auth/
|   |   +-- auth.adapter.ts           # AuthPort using localToken + AuthCache + runtime.remote
|   |   +-- auth-cache.ts             # existing credential cache
|   +-- hono/
|       +-- adapter.ts                # honoAdapter(procedure)
|       +-- middlewares.ts            # requestId, noCache, bodyLimit, transportMiddleware
|       +-- error-handlers.ts         # errorHandler (.onError) + notFoundHandler (.notFound)
|       +-- types.ts                  # AppEnv, ContractHonoInput, ProcedureResponse
|       +-- wire.ts                   # jsonResponse, refusedResponse
|       +-- routes/                   # divided by domain
|           +-- orders.route.ts
|           +-- plans.route.ts
|           +-- cells.route.ts
|           +-- projects.route.ts
|           +-- blobs.route.ts
|           +-- admin.route.ts
|           +-- stream.route.ts       # GET /v1/stream (SSE)
|           +-- webhooks.route.ts     # POST /v1/webhooks/github
|
+-- bootstrap/
|   +-- transport.ts                  # createTransport({ runtime, authCache, localToken })
|
+-- http/                             # compatibility exports for existing callers/tests
    +-- app.ts                        # exports LOCAL_SUPERVISOR_NAME + createHttpApp
    +-- config.ts                     # listenerConfigFrom, parseBind
    +-- discovery.ts                  # writeDiscovery, removeDiscovery
    +-- listener.ts                   # startHttpListener
```

- **Hard Constraints & Invariants**:
  - **Package boundaries** (`apps/server/eslint.config.mjs`, `docs/RULES.md`): MUST NOT import `@repo/factory-db`, `@repo/factory-definitions`, `@repo/factory-core/cycle/*`, or `@repo/software-factory`.
  - **Code conventions**: `kebab-case.ts` filenames, arrow function expressions only (`func-style`), **no `index.ts` barrel files** (subpaths imported directly).
  - **Wire protocol** (`docs/PROTOCOL.md`, `packages/factory-core/src/contracts/http-codec.ts`): Preserve exact `ROUTES` / `HTTP_ROUTES` paths, methods, `WireError` JSON payloads, `WIRE_STATUS` HTTP codes (`422` validation, `401` unauthorized, `503` unavailable/not_configured), `204` empty `claim`, raw `application/octet-stream` for `blobPut`/`blobGet`, SSE for `/v1/stream`, and raw-body HMAC verification for `/v1/webhooks/github`.
  - **External exports preserved**: Keep `http/listener.ts`, `http/discovery.ts`, `http/config.ts`, `http/auth-cache.ts`, `http/app.ts` (`createHttpApp`, `LOCAL_SUPERVISOR_NAME`), and `testing/*` importable at their existing paths so `apps/cell` e2e/distributed tests require no edits.

---

## 🛠️ Implementation Plan

### Phase 1: Application Core & Ports (`application/`)

1. **Error Handling (`apps/server/src/application/core/error-handling.ts`)**:
   - Define `RefusalError` (wrapping `WireError` + optional `cause`) and `toWireError(error)` normalizing `RefusalError`, `isRuntimeError(error)`, Zod issue errors (`invalidWire`), and unexpected errors (`{ code: 'unavailable' }`).
2. **Schema & Contract Wrapper (`apps/server/src/application/core/schema/types.ts`, `zod.ts`)**:
   - Define transport-neutral `ProcedureSchema` / `withRouteSchema(route)` wrapping `ROUTES[route].request` and `ROUTES[route].response` (throwing `RefusalError` with `invalidWire` on input failure), plus `withZodSchema` for non-`ROUTES` endpoints (`join`, `githubWebhook`).
3. **Procedure Factory & Access Tiers (`apps/server/src/application/core/procedure.ts`)**:
   - Define `TransportContext` (`runtime: RuntimePort`, `auth: AuthPort`, `signal?: AbortSignal`).
   - Implement `publicProcedure`, `supervisorProcedure`, `localSupervisorProcedure`, `cellProcedure`, `supervisorOrCellProcedure`, and a typed `runtimeProcedure(route, access)` helper for standard JSON `HTTP_ROUTES` operations so 30+ pass-through routes do not require boilerplate duplication.
4. **Ports (`apps/server/src/application/ports/auth.port.ts`, `runtime.port.ts`)**:
   - `AuthPort`: `authenticate(auth: HttpAuth, token: string | undefined): Promise<Caller>` (returns verified `Caller` or throws `RefusalError({ code: 'unauthorized' })`).
   - `RuntimePort`: typed facade over `@repo/factory-runtime` `Runtime` (`call`, `remote`, `feed`, `recordPullRequest`).

### Phase 2: Domain Procedures (`application/procedures/`)

5. **Split Procedures by Domain**:
   - `orders.procedures.ts`: `board`, `orderDetail`, `createOrder`, `recordPrState`, `answer`, `resume`, `reopen`, `nudge`, `cancel`, `reprioritise`.
   - `plans.procedures.ts`: `plans`, `planDetail`, `createPlan`, `recordPlanPrState`.
   - `cells.procedures.ts`: `join` (custom `joinRequestSchema`/`joinResponseSchema` via `runtime.remote.joinCell`), `hello`, `claim` (`null` -> `204` signal), `heartbeat`, `submitCommand` (`orderOfJob` lease epoch resolution + `planId`/`orderId` injection), `cellProjectEnsure`, `cellsList`, `cellRevoke`, `joinTokenCreate`, `joinTokenList`, `joinTokenRevoke`, enforcing `CELL_BODY_ROUTES` credential matching.
   - `projects.procedures.ts`: `projectList`, `projectAdd`, `projectSet`, `projectRemove`.
   - `blobs.procedures.ts`: `blobGet` (binary decode), `blobPut` (binary encode + `mediaType`).
   - `admin.procedures.ts`: `adminExport`, `adminBackup` (`local` auth), `adminRebuildProjections`.
   - `webhooks.procedures.ts`: `githubWebhook` (HMAC signature, delivery id validation, `runtime.recordPullRequest`).

### Phase 3: Adapters, Hono Transport & Bootstrap (`adapters/`, `bootstrap/`, `app.ts`)

6. **Auth Adapter (`apps/server/src/adapters/auth/auth.adapter.ts`, `auth-cache.ts`)**:
   - Move/wrap `auth-cache.ts` and `lookupCaller` / `callerOf` / `sameToken` into `createAuthAdapter({ runtime, cache, localToken })` implementing `AuthPort`.
7. **Hono Types, Middlewares & Error Handlers (`apps/server/src/adapters/hono/`)**:
   - `types.ts`: `AppEnv` (`Variables: { requestId, getTransport }`).
   - `wire.ts`: `jsonResponse`, `refusedResponse` (`WIRE_STATUS[error.code]`).
   - `middlewares.ts`: `requestId()`, `noCache`, `bodyLimit` (bounded JSON limit; ensure `blobPut` accommodates valid blob sizes), `transportMiddleware(createTransport)`.
   - `error-handlers.ts`: `errorHandler` (`.onError`) and `notFoundHandler` (`.notFound`) converting thrown `RefusalError` / `RuntimeError` / `HTTPException` / unknown errors via `toWireError` into `refusedResponse`, eliminating per-route `try/catch` blocks.
   - `adapter.ts`: `honoAdapter(procedure)` extracting params/query/JSON (or raw bytes for `blobPut`), executing `procedure.execute(input, c.var.getTransport())`, and emitting `204`, `application/octet-stream`, or `200` JSON.
8. **Domain Route Modules (`apps/server/src/adapters/hono/routes/*.route.ts`)**:
   - Split routes by domain: `orders.route.ts`, `plans.route.ts`, `cells.route.ts`, `projects.route.ts`, `blobs.route.ts`, `admin.route.ts`, `stream.route.ts` (SSE `/v1/stream`), `webhooks.route.ts`.
   - Add a compile-time/unit exhaustiveness check verifying every `HttpRouteName` in `HTTP_ROUTES` is registered exactly once across the domain routers.
9. **Bootstrap & Compatibility Wiring**:
   - `apps/server/src/bootstrap/transport.ts`: `createTransport` factory wiring `AuthAdapter` + `RuntimePort`.
   - `apps/server/src/app.ts`: `createApp(createTransport)` (~25 lines) composing global middlewares, `errorHandler`, `notFoundHandler`, and domain `.route(...)` mounts.
   - `apps/server/src/http/app.ts`: thin wrapper exporting `LOCAL_SUPERVISOR_NAME` and `createHttpApp(runtime, options)` delegating to `createApp` + `createTransport` (preserving all existing callers and tests).
   - `apps/server/src/once.ts`: reuse `application/core` (`toWireError`, `withRouteSchema` / `executeRoute`) instead of duplicating Zod parsing and `RuntimeError` mapping.

### Phase 4: Tests & Cleanup

10. **Tests**:
    - Ensure all existing `apps/server/src/__tests__/*.test.ts` (`http.test.ts`, `boundaries.test.ts`, `github-webhook.test.ts`, `http-commands.test.ts`, `http-plan-commands.test.ts`, `http-task-api.test.ts`, `sse-keepalive.test.ts`, `stream.test.ts`, `once.test.ts`, `process.test.ts`) pass unchanged.
    - Add unit tests for `HTTP_ROUTES` exhaustiveness across domain route modules and `error-handling.ts` / `honoAdapter` edge cases (malformed JSON, `204` claim, `blobPut`/`blobGet`, `404` `not_found`).

---

## ✅ Acceptance Criteria

- [ ] `apps/server/src/` is organized into `application/core`, `application/ports`, `application/procedures/<domain>`, `adapters/auth`, `adapters/hono/routes/<domain>`, `bootstrap/transport.ts`, and `app.ts` with no `index.ts` barrel files and arrow functions only.
- [ ] Every `HttpRouteName` in `@repo/factory-core/contracts/http-routes` (`HTTP_ROUTES`) is registered exactly once across the domain route modules and verified by test.
- [ ] All error mapping (`RefusalError`, `RuntimeError`, Zod validation issues, unexpected failures, unknown routes) flows through `toWireError` + Hono `.onError` / `.notFound` while returning exact `WIRE_STATUS` and `WireError` payloads.
- [ ] `once.ts` shares route schema parsing and `toWireError` handling with `application/core` without duplicating validation logic.
- [ ] Existing public exports (`http/app.ts`, `http/listener.ts`, `http/discovery.ts`, `http/config.ts`, `testing/local-http.ts`) remain intact and `boundaries.test.ts` passes with zero forbidden imports.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
