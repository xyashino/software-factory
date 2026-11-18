---
status: todo
factory: v2
plan: cells-jobs-incidents
depends_on: [03-cells-claims-and-reaper]
priority: high
line: feature
type: feat
---

# Todo: `04-cells-heartbeat-list-revoke` — Heartbeats, Cell List, Revoke and Stale-Epoch Fencing

## 🎯 Objective

Implement the remaining Cell endpoints: heartbeats with epoch fencing, cell listing, and revocation, per `PLAN.md` §3.6, §3.7 and §9. Finish with the end-to-end lease expiry test.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/application/procedures/cells/{heartbeat-cell,list-cells,revoke-cell}.procedure.ts`, `apps/factory-server/src/contracts/cells.contract.ts`, `apps/factory-server/test/blackbox/cells-claims-leases.test.ts`
- **Boundary**: `apps/factory-server/` only.
- **Classification**: `Integration`
- **Dependencies**: `hono: catalog:`, `drizzle-orm: catalog:`, `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Heartbeat** (`POST /api/v1/cells/heartbeats`, scope `cell:worker`):
   - Verify `job.cell_id === cellId` and `job.epoch === body.epoch`, else `409 StaleLeaseEpoch`.
   - Set `lease_expires_at = now + LEASE_TTL_MS`.
   - Return `{ code: 200, leaseExpiresAt, signals }`. `signals` is `['abort']` if the order or job was cancelled or paused, else `[]`.
2. **List** (`GET /api/v1/cells`, scope `supervisor:read`).
3. **Revoke** (`DELETE /api/v1/cells/:id`, scope `supervisor:write`):
   - Revoke the Cell and its session tokens.
   - Mark its active job `lost`.
   - Unpin orders and return the running order to `queued`.
4. **End-to-end test**: enroll → hello → claim (woken by import) → heartbeat extends lease → hello reconnect returns `resumedJob` → advance clock +60,001 ms → Cell B claims → Cell A's late heartbeat gets `409 StaleLeaseEpoch`.

---

## ✅ Acceptance Criteria

- [ ] Heartbeat with the current epoch extends the lease; a stale epoch gets `409 StaleLeaseEpoch`.
- [ ] Revoke releases the order and the Cell cannot claim again.
- [ ] Lease expiry after `> 60_000ms` lets Cell B take over.
- [ ] No `any` and no loose type assertions.
- [ ] `pnpm --filter @repo/factory-server-v2 test check-types lint` passes.
