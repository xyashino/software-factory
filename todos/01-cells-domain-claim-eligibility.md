---
status: todo
factory: v2
plan: cells-jobs-incidents
priority: high
line: feature
type: feat
---

# Todo: `01-cells-domain-claim-eligibility` — Pure Claim Eligibility Domain

## 🎯 Objective

Implement the pure Cell/claim selection rules from `PLAN.md` §3.1 with no database or HTTP code.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/domain/cells/claim-eligibility.ts`, `apps/factory-server/src/domain/cells/__tests__/claim-eligibility.test.ts`
- **Boundary**: `apps/factory-server/` only. No edits to `apps/cell`, `apps/cli`, `packages/factory-*`.
- **Classification**: `Domain Core`
- **Dependencies**: `zod: catalog:`

---

## 🛠️ Implementation Plan

1. Eligibility for a `WorkOrder` candidate against a Cell:
   - `state === 'queued'`, `active_cell_id === null`, `active_job_id === null`.
   - `project_id === cell.projectId`.
   - `line_name` in `cell.allowedLines` (or `allowedLines` includes `'*'`).
   - `cell.cellId` not in `unavailable_line_cells_json`.
   - `pinned_cell_id === null`, or equals `cell.cellId`, or the pinned Cell is offline or lease-expired (passed in as a flag, not read from DB).
2. Respect the `projects.max_running` limit (passed in as a count).
3. Order candidates: (1) warm worktree (`pinned_cell_id === cellId` or `localWorktrees` contains `orderId`), (2) priority `high > medium > low`, (3) `created_at ASC`.
4. Export pure functions only. Inputs and outputs are plain typed objects.

---

## ✅ Acceptance Criteria

- [ ] Each eligibility rule has a unit test: project match, `allowedLines` with and without `'*'`, `unavailable_line_cells`, pinned affinity, expired pin, `max_running`.
- [ ] Ordering test covers warm-worktree, priority and `created_at` tie-breaks.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
