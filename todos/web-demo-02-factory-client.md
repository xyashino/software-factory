---
status: todo
factory: v2
plan: web-demo
depends_on: [web-demo-01-skeleton]
priority: medium
line: feature
type: feat
---

# Todo: `web-demo-02-factory-client` — Reply Schemas and factory-server Client

## 🎯 Objective

Give the demo one typed way to call factory-server: GET reads, one POST transition, Zod-validated replies, and an error type that never carries the token.

---

## 🌐 Context & Problem Statement

- Pages must not call `fetch` directly. A single client keeps the bearer header, the error mapping, and the schema checks in one place.
- Reply shapes come from factory-server contracts (`apps/factory-server/src/contracts/*.contract.ts`). The demo copies only the fields it renders and allows unknown keys, so server additions do not break it.
- Routes: PLAN §1 in [`apps/factory-web-demo/docs/PLAN.md`](../apps/factory-web-demo/docs/PLAN.md).

---

## 📦 Specification / Scope

- **Target**: `apps/factory-web-demo/src/lib/`, `test/unit/`.
- **Classification**: `Integration` (client), `Domain Core` (schemas).
- **Files**:
  - `src/lib/factory-schemas.ts`: `cellsReply`, `workOrdersReply`, `workOrderDetailReply`, `incidentsReply`, `projectsReply`, `transitionReply`.
  - `src/lib/factory-client.ts`: `createFactoryClient({ baseUrl, getToken })` returning `listCells`, `listWorkOrders(filter)`, `getWorkOrder(id)`, `listIncidents`, `transitionWorkOrder(id, action)`.
  - `src/lib/factory-error.ts`: `FactoryUnavailable` (network error or non-2xx) with `status` and `code` from the body; no token field.
- `getToken` is a function so task 05 can swap in the auto-registered session without changing callers.

---

## 🛠️ Implementation Plan

1. Schemas: `z.object({ ... })` for each reply with `code` literal where the server sends one. Unknown keys allowed (no `.strict()`).
2. Client: one private `request(method, path, body?)` that sets `Authorization: Bearer <getToken()>` and `content-type: application/json` when there is a body. Public functions call it.
3. Network error or timeout: `FactoryUnavailable` with `status: 0`. Non-2xx: parse `{ code, message }` if possible, else `status` only.
4. Schema mismatch throws a `FactoryUnavailable` with `status: 502` so pages render the same `503`-style message.
5. No retry. No cache.
6. Tests (`test/unit/factory-client.test.ts`, msw as the backend):
   - bearer header is sent on GET and POST;
   - a reply missing a required field fails;
   - `500` throws `FactoryUnavailable` with `status: 500`;
   - transition sends exactly `{ action }`;
   - the error object does not contain the token value.

---

## ✅ Acceptance Criteria

- [ ] Every public client function sends `Authorization: Bearer <token>`.
- [ ] Each read reply is validated; a bad body throws.
- [ ] `transitionWorkOrder` body is exactly `{ "action": "<action>" }`.
- [ ] Errors carry `status` and optional `code`; the token value never appears in an error message or property.
- [ ] No barrel `index.ts`; no `any`; no `unknown` used as a type.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence per [evidence](.agents/skills/evidence/SKILL.md): vitest output.
