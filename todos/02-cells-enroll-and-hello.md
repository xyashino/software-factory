---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [01-cells-domain-claim-eligibility]
priority: high
line: feature
type: feat
---

# Todo: `02-cells-enroll-and-hello` — Cell Enrollment and Fast Reconnect

## 🎯 Objective

Implement `POST /api/v1/cells/enroll` and `POST /api/v1/cells/hello` per `PLAN.md` §3.1 and §3.6, including resume of an unexpired active job.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/contracts/cells.contract.ts`, `apps/factory-server/src/application/procedures/cells/{enroll-cell,hello-cell}.procedure.ts`, `apps/factory-server/src/adapters/hono/routes/cells.route.ts`, `apps/factory-server/test/blackbox/cells-enroll-hello.test.ts`
- **Boundary**: `apps/factory-server/` only. Simulate Cell calls with `app.request()`.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Enroll** (`POST /api/v1/cells/enroll`, scope `cell:enroll`):
   - Validate the `sf_join_` token.
   - Create or update the `cells` row with `projectId`, `allowedLines`, `runners`.
   - Mint an `sf_cell_` session token.
   - Return `{ code: 201, cellId, sessionToken, expiresAt }`.
2. **Hello** (`POST /api/v1/cells/hello`, scope `cell:worker`):
   - Update `projectId`, `allowedLines`, `runners`, `localWorktrees`, `last_heartbeat_at = now`.
   - If the Cell holds an unexpired `active_job_id`: bump `epoch += 1`, set `lease_expires_at = now + LEASE_TTL_MS`, return `resumedJob` inline.
3. Hello reads expired-lease state without reaping. Reaping belongs to `03-cells-claims-and-reaper`.

---

## ✅ Acceptance Criteria

- [ ] Enroll with a valid join token returns `201` with a session token; an invalid token is rejected.
- [ ] Hello before lease expiry bumps `epoch`, refreshes `lease_expires_at` and returns `resumedJob`.
- [ ] Hello without an active job returns no `resumedJob`.
- [ ] Black-box test covers enroll → hello → resume.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
