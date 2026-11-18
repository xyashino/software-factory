---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [07-jobs-fail-block-and-worktree]
priority: high
line: feature
type: feat
---

# Todo: `08-jobs-line-unavailable` — Job `line_unavailable` and Re-dispatch

## 🎯 Objective

Add the `line_unavailable` transition, so a Cell that cannot run a line hands its job to another eligible job immediately, per `PLAN.md` §3.2.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/contracts/jobs.contract.ts`, `apps/factory-server/src/application/procedures/jobs/transition-job.procedure.ts`, `apps/factory-server/test/blackbox/job-line-unavailable.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. Contract: `line_unavailable` `{ action, commandId, epoch, lineName, detail }`.
2. Inside `immediateTx`:
   - Set `Job.status = 'line_unavailable'`.
   - Append `cellId` to `unavailable_line_cells_json`.
   - Clear `active_cell_id`, `active_job_id`, `pinned_cell_id`.
3. If no other online Cell for the project supports `lineName`: WorkOrder → `line_unavailable` and open Incident `line_unavailable`. Otherwise leave it `queued`.
4. Claim a different eligible job for this Cell using the claim rules from `06`, then return `{ markedLineUnavailable: true, nextJob }`.

---

## ✅ Acceptance Criteria

- [ ] The Cell is recorded in `unavailable_line_cells_json`.
- [ ] With no other online Cell for the line, the order goes `line_unavailable` and an Incident opens.
- [ ] With another eligible order queued, `nextJob` is returned inline.
- [ ] Black-box test: second queued order is re-dispatched to the same Cell.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
