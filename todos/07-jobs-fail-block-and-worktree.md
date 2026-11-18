---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [06-jobs-start-and-complete]
priority: high
line: feature
type: feat
---

# Todo: `07-jobs-fail-block-and-worktree` — Job `fail`, `block` and `worktree_missing`

## 🎯 Objective

Add the `fail`, `block` and `worktree_missing` transitions to `POST /api/v1/jobs/:id/transitions`, per `PLAN.md` §3.3, §3.4 and §6.2.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/contracts/jobs.contract.ts`, `apps/factory-server/src/application/procedures/jobs/transition-job.procedure.ts`, `apps/factory-server/test/blackbox/job-fail-block-worktree.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. Contract: `fail` `{ action, commandId, epoch, detail, output?, workspaceFailed? }`, `block` `{ action, commandId, epoch, detail, handoverFile? }`, `worktree_missing` `{ action, commandId, epoch, missingStepId, missingFiles }`.
2. **`fail`**: apply the retry plan from `job-transitions.ts`.
   - Retry or rewind: issue `nextJob` inline (`workspaceMode: 'reuse'`).
   - Exhausted: WorkOrder → `blocked`, clear `active_cell_id` and `active_job_id`, open Incident with the trigger.
3. **`block`**: WorkOrder → `blocked`, open Incident `operator_blocked`.
4. **`worktree_missing`**: apply the reset plan. Reset WorkOrder and steps to Step 0, issue Step 0 `Job` (`workspaceMode: 'fresh'`, `epoch + 1`), return `{ resetToScratch: true, nextJob }`. Over the cap, open Incident `worktree_reset_limit`.
5. All three run inside `immediateTx` with the same `commandId` and `epoch` checks as `09`.

---

## ✅ Acceptance Criteria

- [ ] `fail` with retries left issues `nextJob` inline; a rewind target resets steps from target to current.
- [ ] `fail` after the last attempt blocks the order and opens the correct Incident.
- [ ] `block` opens an `operator_blocked` Incident.
- [ ] `worktree_missing` resets to Step 0 with `fresh`; the third reset opens `worktree_reset_limit`.
- [ ] Black-box test: quality-gate fail → rewind to build → pass → deliver on one Cell without re-claiming.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
