---
status: queued
priority: low
line: standard
type: refactor
depends_on: factory-contracts-package
---

# web-demo-adopt-factory-contracts: web-demo reuses factory reply schemas

## 🎯 Objective

Decide and, if justified, replace `apps/web-demo/src/lib/factory-schemas.ts` with schemas from `@repo/factory-contracts`.

---

## 🌐 Context & Problem Statement

web-demo imports no contracts. `lib/factory-schemas.ts` has 13 `z.object` likely copying factory reply DTOs (not compared). `factory-client.ts` also defines its own `errorBodySchema`. Third copy of the same wire shapes.

---

## 📦 Specification / Scope

- **Target**: `apps/web-demo`
- **Classification**: `Web UI`
- **Dependencies**:
  - `@repo/factory-contracts: workspace:*`
- Out: `parseReply` adoption, UI changes, Astro config.

---

## 🛠️ Implementation Plan

1. **Compare**: map each schema in `factory-schemas.ts` to a contract `out` schema. Note differences (web-demo may intentionally pick fewer fields).
2. **Decide**: full match, replace. Intentional subset, keep a derived `.pick()` from package schema. No match, keep and record why in ADR.
3. **Switch**: update `factory-client.ts` imports; tests via `msw` per `msw-backend-mocks`.

---

## ✅ Acceptance Criteria

- [ ] Each web-demo reply schema is derived from the package or documented as intentionally separate.
- [ ] web-demo tests (`msw`) pass unchanged in behavior.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
