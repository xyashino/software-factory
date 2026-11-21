---
status: queued
priority: medium
line: standard
type: refactor
depends_on: factory-contracts-package
---

# sf-adopt-factory-contracts: sf drops hand-copied factory contracts

## 🎯 Objective

sf imports `@repo/factory-contracts` instead of `apps/sf/src/contracts/*` copies. Any client/server drift found is reported and resolved toward factory.

---

## 🌐 Context & Problem Statement

sf contracts mirror factory API (`cells.contract.ts` = enroll/hello/claim/heartbeat/drain/leave/list/revoke). `common.ts` (127 lines) redefines factory enums and error replies. Diffs vs factory: projects 2 lines, stream 3, work-orders 31, tokens 38, incidents 40, order-plans 43, queue 47, jobs 84, cells 152. Unclassified: import-only or real drift. Drift = existing bug, nothing catches it today.

---

## 📦 Specification / Scope

- **Target**: `apps/sf`
- **Classification**: `Integration`
- **Dependencies**:
  - `@repo/factory-contracts: workspace:*`
  - `@repo/zod-contract-kit: workspace:*` if sf uses kit fields
- Out: `operator.contract.ts` (see `operator-retire-app-and-protocol`), `parseReply` adoption, cell-server calls.

---

## 🛠️ Implementation Plan

1. **Classify drift first**: for each sf contract, diff against factory. Write results in `.notes/sf-factory-contract-drift.md`: file, import-only or real, direction (sf missing field, extra field, enum mismatch). Real drift: factory wins; list affected sf procedures.
2. **Switch**:
   - Retarget 18 src + 10 test imports from `contracts/<x>` to `@repo/factory-contracts/<x>`.
   - Delete sf `contracts/*` except `operator.contract.ts`; `common.ts` enums/error replies from package or kit.
   - Add deps, `pnpm install`.
3. **Drift test**: `apps/sf/test/unit/contracts/drift.test.ts` compares sf contract field names with factory contracts. Delete the factory pairs once sf copies are gone; keep only what still applies.
4. **Fix fallout**: real drift can break sf tests or request shapes. Adjust sf code/tests to factory shape, not the package.

---

## ✅ Acceptance Criteria

- [ ] `.notes/sf-factory-contract-drift.md` lists every diff classified.
- [ ] No factory enum or DTO defined in sf.
- [ ] sf blackbox tests pass; any changed assertion justified in ADR.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
