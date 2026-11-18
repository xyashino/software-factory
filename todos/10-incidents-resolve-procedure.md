---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [09-incidents-triage-domain]
priority: high
line: feature
type: feat
---

# Todo: `10-incidents-resolve-procedure` — Incident Endpoints and Mechanic Dispatch

## 🎯 Objective

Expose incidents over HTTP: list them, resolve them as a supervisor or as the mechanic Cell, and dispatch mechanic jobs through claims. Per `PLAN.md` §4 and §9.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/contracts/incidents.contract.ts`, `apps/factory-server/src/application/procedures/incidents/{list-incidents,resolve-incident}.procedure.ts`, `apps/factory-server/src/adapters/hono/routes/incidents.route.ts`, `apps/factory-server/test/blackbox/incidents-resolve.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **List** (`GET /api/v1/incidents`, scope `supervisor:read`): filter by `projectId`, `orderId`, `reason`, `status`.
2. **Resolve** (`POST /api/v1/incidents/:id/resolve`, scope `supervisor:write` or `cell:worker`):
   - For `cell:worker`: verify the Cell holds the active `mechanic` job lease for this incident (check epoch). Mark that job `passed` in the same `immediateTx`.
   - Apply the chosen resolution from `incident-rules.ts`. Record `state_transitions`.
   - Wake claim waiters if the WorkOrder returned to `queued`.
3. Dispatch of mechanic jobs goes through the existing claim path from `06`.

---

## ✅ Acceptance Criteria

- [ ] All 5 resolutions work for a supervisor (`supervisor:write`).
- [ ] The mechanic Cell can resolve only its own leased incident, and only with an epoch match.
- [ ] Black-box: step failure exhausts retries → incident → mechanic job claimed → `retry_step` → Cell finishes deliver.
- [ ] Black-box: mechanic `escalate` → supervisor `restart_from_step` and `restart_from_scratch`.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
