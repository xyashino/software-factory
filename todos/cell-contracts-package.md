---
status: queued
priority: medium
line: standard
type: feat
depends_on: zod-contract-kit-package
---

# cell-contracts-package: cell wire contracts as package

## 🎯 Objective

Create `@repo/cell-contracts`: cell API contracts + the enums they use. Cell imports it.

---

## 🌐 Context & Problem Statement

Cell API contracts live in `apps/cell/src/contracts/`. sf talks to cell-server with raw route strings and no contract. Package gives sf something to type against (separate todo) and keeps cell contracts independent of cell domain code. See `docs/plans/contracts-plan.md`.

---

## 📦 Specification / Scope

- **Target**: `packages/cell-contracts`, `apps/cell`
- **Classification**: `Domain Core`
- **Dependencies**:
  - `zod: catalog:`
  - `@repo/zod-contract-kit: workspace:*`
  - dev: same toolchain set as `packages/prompt`
- Out: sf, domain logic, supervisor/runtime code.

---

## 🛠️ Implementation Plan

1. **Verify first**: read `apps/cell/src/domain/cells/cell-slot.ts` and `domain/settings/preferences.ts`. Move only `RUNTIME_STATUSES` and `RUNNERS` constants. Logic stays. sf also has runner code (`adapters/runners`): check it does not define a second runner list; report if it does.
2. **Initialize File Structure**:
   - `packages/cell-contracts/` (package.json `exports {"./*": "./src/*.ts"}`, tsconfig, eslint, vitest).
   - `src/cells.contract.ts`, `factories.contract.ts`, `health.contract.ts`, `settings.contract.ts`, `stream.contract.ts`.
   - `src/enums/cells.ts` (`RUNTIME_STATUSES`), `src/enums/settings.ts` (`RUNNERS`).
3. **Core Logic & Behavior**:
   - Contract files moved as is; `errorResponse` from kit; `common.ts` deleted.
   - Cell domain imports the constants from `@repo/cell-contracts/enums/*`.
4. **Exports & Integration**:
   - Cell: delete `src/contracts/`; update 14 src + 1 test importers.
   - Add dep, `pnpm install`. No barrel.

---

## ✅ Acceptance Criteria

- [ ] `apps/cell/src/contracts/` removed; each enum defined once.
- [ ] Package has no import from `apps/*`, no Hono, no server errors.
- [ ] Cell blackbox tests pass with no assertion changes; wire shapes unchanged.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
