---
status: queued
priority: medium
line: standard
type: feat
depends_on: zod-contract-kit-package
---

# factory-contracts-package: factory wire contracts as package

## 🎯 Objective

Create `@repo/factory-contracts`: all factory API contracts + the enums they use. Factory imports it. Factory domain imports enums from it.

---

## 🌐 Context & Problem Statement

Factory API contracts live in `apps/factory/src/contracts/`. sf keeps hand copies (`apps/sf/src/contracts/`), enums redefined in sf `common.ts`. Package = single source. sf switch is a separate todo (`sf-adopt-factory-contracts`). See `docs/contracts-plan.md`.

---

## 📦 Specification / Scope

- **Target**: `packages/factory-contracts`, `apps/factory`
- **Classification**: `Domain Core`
- **Dependencies**:
  - `zod: catalog:`
  - `@repo/zod-contract-kit: workspace:*`
  - dev: same toolchain set as `packages/prompt`
- Out: sf, web-demo, domain logic (state machines, transitions), server runtime.

---

## 🛠️ Implementation Plan

1. **Verify first**: read `apps/factory/src/domain/orders/order-state.ts`, `domain/common/events.ts`, `domain/incidents/incident-rules.ts`. Move only constants (and types derived from them) the contracts need. Logic stays in app. If a constant is entangled with logic, stop and report.
2. **Initialize File Structure**:
   - `packages/factory-contracts/` (package.json `exports {"./*": "./src/*.ts"}`, tsconfig, eslint, vitest).
   - `src/*.contract.ts` x9: cells, incidents, jobs, order-plans, projects, queue, stream, tokens, work-orders.
   - `src/common.ts`: `projectIdSchema` only (rest from kit).
   - `src/enums/orders.ts`: `WORK_ORDER_STATES`, `WORK_ORDER_ACTIONS`, `PRIORITIES`, `ORDER_TYPES`, `PLAN_STATES`, `PLAN_ACTIONS`.
   - `src/enums/events.ts`: `ACTOR_KINDS`, `ENTITY_TYPES`. `src/enums/incidents.ts`: incident reasons/statuses.
3. **Core Logic & Behavior**:
   - Contract files moved as is; imports retarget to kit (`errorResponse`, fields) and local enums.
   - Factory domain files import the moved constants from `@repo/factory-contracts/enums/*`, keep re-derived types/logic.
4. **Exports & Integration**:
   - Factory: delete `src/contracts/`; update 30 src + 4 test importers to `@repo/factory-contracts/<name>.contract`.
   - Add dep to `apps/factory/package.json`, `pnpm install`.
   - Subpath exports only, no barrel.

Tests: move existing contract tests with the files. Factory blackbox tests stay untouched and green.

---

## ✅ Acceptance Criteria

- [ ] `apps/factory/src/contracts/` removed; no enum constant defined twice.
- [ ] Package has no import from `apps/*`, no Hono, no server errors.
- [ ] Factory blackbox tests pass with no assertion changes.
- [ ] Wire shapes unchanged (zod schemas byte-equivalent after move).
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
