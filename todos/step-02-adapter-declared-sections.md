---
status: todo
factory: v2
plan: factory-procedure-core
depends_on: [step-01-procedure-access-model]
priority: high
line: feature
type: refactor
---

# Todo: `step-02-adapter-declared-sections` — Parse Only Declared Request Sections

## 🎯 Objective

Make the Hono adapter read only the request sections a procedure's contract declares, and reject a non-JSON body when the contract declares one. Routes stay unchanged.

---

## 🌐 Context & Problem Statement

- `apps/factory-server/src/adapters/hono/adapter.ts` always calls `c.req.param()`, `c.req.query()` and `readBody(c.req.raw)` for every request. A `GET` therefore reads and parses a body it doesn't use.
- `readBody` does not check `Content-Type`. A `POST` with a body that is not JSON is parsed as JSON or fails with a generic malformed-JSON error, depending on content.
- After `step-01`, each procedure exposes `procedure.contract`, so the adapter can branch on declared sections.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/factory-server/src/adapters/hono/adapter.ts`
  - `apps/factory-server/test/blackbox/` new file `adapter-declared-sections.test.ts`
- **Boundary**: adapter and its black-box test only. No procedure, contract or route edits.
- **Classification**: `Integration` (black-box through `app.request()`, see `test/support/test-app.ts`).
- **Behaviour**:
  - Section is read only when `contract.in[section]` is declared. Undeclared sections are `undefined`.
  - Body with a declared `body` section and a non-empty request body must have `Content-Type` starting with `application/json`. Otherwise respond `400` with a `BadRequest` message.
  - Empty body with a declared `body` section keeps today's behaviour: it reaches Zod and fails there if the body is required.
  - Malformed JSON keeps its current `BadRequest` message.
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. Read `procedure.contract.in ?? {}` once at the top of the adapter.
2. Compute each section from the declaration:
   - `params`: `c.req.param()` only if declared.
   - `query`: `c.req.query()` only if declared.
   - `body`: `readJson(c.req.raw)` only if declared.
3. Add `readJson` (private) that:
   - returns `undefined` for an empty body,
   - throws `BadRequest` for a non-JSON `Content-Type` on a non-empty body,
   - parses JSON and throws the existing `BadRequest` on failure.
4. Keep `c.json(response, response.code)` as it is.
5. Black-box test cases (AAA, story names, no internals):
   - a `GET` route with a junk body does not return 400 for the body,
   - a `POST` with a non-JSON content type is rejected with 400,
   - a `POST` with JSON still works,
   - a `POST` with malformed JSON keeps its current message.

---

## ✅ Acceptance Criteria

- [ ] Adapter reads only declared sections; no section is read for an undeclared key.
- [ ] Non-JSON `Content-Type` with a non-empty body returns `400`.
- [ ] Existing black-box tests still pass with no edits, except where they sent a body without a JSON content type (list them in the ADR if any change).
- [ ] New black-box test file covers the four cases above.
- [ ] No barrel file; no `any`.
- [ ] `pnpm --filter @repo/factory-server-v2 check-types`, `lint` and `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md).
