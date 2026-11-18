---
status: todo
factory: v2
plan: factory-backend
depends_on: [step-05-jobs-transition-domain]
priority: high
line: feature
type: feat
---

# Todo: `step-06-jobs-start-and-complete` — Job `start` and `complete` Transitions

## 🎯 Objective

Implement `POST /api/v1/jobs/:id/transitions` for the `start` and `complete` actions, so a Cell runs a whole order through steps without re-claiming, per `PLAN.md` §3.2–§3.5 and §6.2.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/contracts/jobs.contract.ts`, `apps/factory-server/src/application/procedures/jobs/transition-job.procedure.ts`, `apps/factory-server/src/adapters/hono/routes/jobs.route.ts`, `apps/factory-server/test/blackbox/job-start-complete.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. Contract: `start` `{ action, commandId, epoch, lineSnapshot? }` and `complete` `{ action, commandId, epoch, producedFiles, commitSha?, output? }`, as a discriminated union on `action`.
2. Procedure, all inside `immediateTx`:
   - Check `commandId` idempotency in `state_transitions`.
   - Check `job.cell_id === principal.cellId` and `job.epoch === body.epoch`, else `409 StaleLeaseEpoch`.
3. **`start`**: on Step 0, materialize `order_steps[0..N-1]` from `lineSnapshot`. Bind `job.step_id`. Set job and step to `running`.
4. **`complete` on `plan_branch`**: `OrderPlan.state = 'active'`, `branch_commit_sha = commitSha`, unlock root WorkOrders (`waiting_parent` → `queued`), wake claim waiters.
5. **`complete` on an intermediate step**: mark it `passed`, update `head_commit_sha`, create `nextJob` for the next step (`workspaceMode: 'reuse'`, `expectedPriorSteps` from steps `0..k`). Keep `active_cell_id` and `pinned_cell_id`. Return `{ completed: true, nextJob }`.
6. **`complete` on `deliver`**: mark passed, WorkOrder → `delivered`, record `head_commit_sha`, clear `active_cell_id`, `active_job_id`, `pinned_cell_id`. Unlock `waiting_parent` children with `base_commit_sha = commitSha`. Return `{ completed: true, nextJob: null }`.

---

## ✅ Acceptance Criteria

- [ ] `start` on Step 0 with `lineSnapshot` populates `order_steps` in SQLite.
- [ ] Completing an intermediate step returns `nextJob` inline and keeps the same Cell locked.
- [ ] Completing `deliver` clears all locks and unlocks waiting children.
- [ ] A stale epoch or a different Cell gets `409 StaleLeaseEpoch`.
- [ ] Repeating a `commandId` does not repeat the transition.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
