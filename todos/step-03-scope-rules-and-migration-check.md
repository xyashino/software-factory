---
status: todo
factory: v2
plan: factory-procedure-core
depends_on: [step-02-adapter-declared-sections]
priority: medium
line: feature
type: test
---

# Todo: `step-03-scope-rules-and-migration-check` — Lock Access Rules With Black-Box Tests

## 🎯 Objective

Prove through HTTP that every access rule behaves as before after the refactor: public, all-of scopes, any-of scopes, and authenticated-only. Confirm no procedure call site needed an edit.

---

## 🌐 Context & Problem Statement

- `step-01` changes how access is checked. Existing tests cover some routes, but no single test pins down all-of versus any-of with the exact `Forbidden` messages.
- `step-01` promised no call-site changes. This step checks that claim across the 26 files that use the procedure helpers.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/factory-server/test/blackbox/procedure-access-rules.test.ts` (new)
  - Any existing black-box test that asserts a `Forbidden` message, only if it now fails.
- **Boundary**: tests only. No source edits in this step unless a test exposes a real regression, which must be reported and fixed in `step-01` scope.
- **Classification**: `Integration`, through `app.request()` with tokens issued by the existing token support in `test/support/`.
- **Scenarios** (story names):
  - a token with every required scope reaches a `scopedProcedure` route,
  - a token missing one of several required scopes gets `403` with `Token lacks scope: <missing>`,
  - a token with one of several allowed scopes reaches an `anyScopedProcedure` route,
  - a token with none of the allowed scopes gets `403` with `Token needs one of: <list>`,
  - a request with no bearer token gets `401` on a scoped route,
  - a public route answers with no bearer token.
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. Pick one existing route per rule: an all-of scope route, an any-of route, a public route, and an authenticated-only route. Read their contracts to find real scopes; do not invent endpoints.
2. Write one test per scenario above, AAA layout, using only public HTTP behaviour.
3. Run `grep -rn "Token lacks scope\|Token needs one of" apps/factory-server/test` and confirm each assertion still matches.
4. Run `grep -rln "scopedProcedure\|anyScopedProcedure\|authenticatedProcedure\|publicProcedure" apps/factory-server/src` and confirm `git diff` shows no edits in those handler files from this work.

---

## ✅ Acceptance Criteria

- [ ] Six scenarios above are covered by black-box tests with story names.
- [ ] Both `Forbidden` messages are asserted exactly.
- [ ] `git diff` for this step touches only `test/` (and `decisions/`).
- [ ] No barrel file; no `any`.
- [ ] `pnpm --filter @repo/factory-server-v2 check-types`, `lint` and `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md).
