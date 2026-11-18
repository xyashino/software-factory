---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [02-cells-enroll-and-hello]
priority: high
line: feature
type: feat
---

# Todo: `03-cells-claims-and-reaper` — Long-Poll Claims and Lazy Lease Reaper

## 🎯 Objective

Implement `POST /api/v1/cells/claims` as an exclusive, long-polling claim dispatcher, backed by a lazy lease reaper, per `PLAN.md` §3.1, §3.7 and §9.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/application/procedures/cells/{reap-expired-leases,claim-job}.procedure.ts`, `apps/factory-server/src/application/procedures/cells/` (contract entry), `apps/factory-server/test/blackbox/cells-claims.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Lazy reaper** (`reap-expired-leases.ts`), run inside `immediateTx` before claims:
   - Jobs with `status IN ('claimed','running') AND lease_expires_at <= now` → `status = 'lost'`, `finished_at = now`.
   - Owning WorkOrder: `active_cell_id = null`, `active_job_id = null`, `epoch += 1`, `state = 'queued'`, keep `pinned_cell_id`.
   - Cells with `last_heartbeat_at + LEASE_TTL_MS <= now` → `status = 'offline'`.
2. **Claim** (`POST /api/v1/cells/claims`, scope `cell:worker`):
   - Inside `immediateTx`: reap, then pick the next eligible `OrderPlan` (`plan_branch`), `Incident` (`mechanic`) or WorkOrder step, using `claim-eligibility.ts`.
   - On WorkOrder claim: `state = 'running'`, `active_cell_id`, `pinned_cell_id`, `epoch += 1`. Create the `Job` with `workspaceMode = current_step_index === 0 && worktree_resets === 0 ? 'fresh' : 'reuse'` and `expected_prior_steps_json`. Set `active_job_id`, `lease_expires_at = now + LEASE_TTL_MS`.
   - No job and `waitMs > 0`: await `ctx.claimWaiters.waitForWake(Math.min(waitMs, CLAIM_WAIT_MS), ctx.signal)`, retry once, then return `{ code: 200, job: null }`.

---

## ✅ Acceptance Criteria

- [ ] A WorkOrder is claimed by exactly one Cell matching `projectId` and `allowedLines`, inside `immediateTx`.
- [ ] Idle claim with `waitMs` parks on `ClaimWaitersPort` with zero SQLite queries and wakes in `< 5ms` when a task is imported.
- [ ] Expired lease: the job becomes `lost`, the order re-queues with `epoch + 1`, and another Cell can claim it.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
