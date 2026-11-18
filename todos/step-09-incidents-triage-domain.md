---
status: todo
factory: v2
plan: factory-backend
depends_on: [step-08-jobs-line-unavailable]
priority: high
line: feature
type: feat
---

# Todo: `step-09-incidents-triage-domain` — Pure Incident Triage and Resolution Rules

## 🎯 Objective

Implement the pure Incident state machine from `PLAN.md` §4.1–§4.3: triage routing and the five resolution transitions.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/domain/incidents/incident-rules.ts`, `apps/factory-server/src/domain/incidents/__tests__/incident-rules.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Domain Core`
- **Dependencies**: `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Triage** (`PLAN.md` §4.2):
   - `line_unavailable` or `mechanic_runs >= MAX_MECHANIC_RUNS` → `triage_owner = 'supervisor'`.
   - Otherwise → `triage_owner = 'mechanic'`, increment `mechanic_runs`, and plan a `mechanic` job pinned to `pinned_cell_id`.
2. **Resolutions** (`PLAN.md` §4.3), as pure state changes:
   - `retry_step`: grant retries on step `x`, clear `unavailable_line_cells_json`, keep `current_step_index = x`, WorkOrder → `queued`.
   - `restart_from_step`: validate `0 <= stepIndex <= x`, rewind, reset steps `stepIndex..N-1`, WorkOrder → `queued`.
   - `restart_from_scratch`: reset to Step 0, clear `worktree_resets`, `stale_base`, unavailable cells, WorkOrder → `queued` with `fresh`.
   - `escalate`: `triage_owner = 'supervisor'`, Incident → `escalated`, WorkOrder stays `blocked`.
   - `cancel`: Incident → `cancelled`, WorkOrder → `cancelled`, clear `pinned_cell_id`.
3. Note: `retry_step` grants the retry by resetting `attempts_used` to 0 unless `max_attempts` is raised. Pick one and cover it in a test.

---

## ✅ Acceptance Criteria

- [ ] Each of the 7 incident triggers in `PLAN.md` §4.1 opens an Incident with the right `triage_owner`.
- [ ] A `mechanic` job is planned only while the mechanic budget remains.
- [ ] Each of the 5 resolutions yields the expected state.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
