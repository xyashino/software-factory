---
status: todo
factory: v2
plan: factory-backend
depends_on: [step-04-cells-heartbeat-list-revoke]
priority: high
line: feature
type: feat
---

# Todo: `step-05-jobs-transition-domain` — Pure Job Transition Rules

## 🎯 Objective

Implement the pure step, retry and reset calculations from `PLAN.md` §3.2–§3.5 with no DB or HTTP code.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/domain/orders/job-transitions.ts`, `apps/factory-server/src/domain/orders/__tests__/job-transitions.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Domain Core`
- **Dependencies**: `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **`lineSnapshot` validation** for Step 0: ordered stations with `kind: 'operator' | 'inspection' | 'deliver'`, `requiredFiles`, `maxAttempts`, optional `onFailRetryStationId` that must point to an earlier station. The last station must be `kind === 'deliver'`.
2. **Artifact check** for `complete`: every `step.required_files_json` entry is in `producedFiles`, else an unprocessable error.
3. **Retry math** for `fail`:
   - Increment `attempts_used`.
   - Below `max_attempts`: if `onFailRetryStationId` is set, return a rewind plan to that station; otherwise retry the current step.
   - At or above `max_attempts`: return a blocked plan with trigger `step_retries_exhausted`, or `delivery_failed` when the step is `deliver`.
4. **Worktree reset math** for `worktree_missing`:
   - Increment `worktree_resets`. If it exceeds `MAX_WORKTREE_RESETS` (2), return a blocked plan with `worktree_reset_limit`.
   - Otherwise return a plan that resets to Step 0 with `workspaceMode: 'fresh'`.

---

## ✅ Acceptance Criteria

- [ ] Unit tests: lineSnapshot materialization, invalid snapshot rejected, required-files check, `onFailRetryStationId` rewind (`quality-gate` → `build`), attempts exhausted, reset cap.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
