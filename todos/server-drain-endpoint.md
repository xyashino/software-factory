---
status: todo
factory: v2
plan: factory-cli
depends_on: [step-02-adapter-declared-sections]
priority: high
line: feature
type: feat
---

# Todo: `server-drain-endpoint` — Drain and Leave for Cells

## 🎯 Objective

Add two routes to factory-server so a Cell can stop cleanly: one the Supervisor uses to drain a Cell, and one the Cell uses to hand over its Job and leave.

---

## 🌐 Context & Problem Statement

- `factory cell stop --id` must hand over the running Job, not wait for the lease to expire (`apps/factory/docs/PLAN.md` §3 gap, §8 open 1).
- Today the server has no way to say "this Cell takes no new work" or "this Cell gives up its Job now". `DELETE /api/v1/cells/{id}` revokes and unpins everything, which is too blunt for a stop.
- The server's rules for leases, epochs and pinning are in `apps/factory-server/docs/PLAN.md` §3.1 and §3.6. This step extends them and must not weaken fencing.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/`. Follows `apps/factory-server/docs/BE_RULES.md` (procedure file, `BEGIN IMMEDIATE`, `state_transitions` row per mutation).
- **Classification**: `Domain Core` and `Integration`.
- **Routes to add** (also add rows to `apps/factory-server/docs/PLAN.md` §9):
  - `POST /api/v1/cells/{id}/drain`, auth `supervisor:write`.
  - `POST /api/v1/cells/leave`, auth `cell:worker`.
- **Files to create or change**:
  - `src/application/procedures/cells/drain.procedure.ts`
  - `src/application/procedures/cells/leave.procedure.ts`
  - `src/contracts/cells.contract.ts` (two new schemas, `.strict()`)
  - `src/adapters/hono/routes/cells.route.ts` (mount both routes)
  - `src/db/schema/cells.ts` (status value `draining`, `left`)
  - `src/db/migrations/` (generated with `pnpm --filter @repo/factory-server-v2 db:generate`)
  - `test/blackbox/cells-drain-leave.test.ts`
- **Dependencies**: `hono`, `zod`, `drizzle-orm` (already in the server).

---

## 🛠️ Implementation Plan

1. **Drain** (`POST /api/v1/cells/{id}/drain`, supervisor):
   - Body: `{ force: boolean }`. `force` defaults to `false`.
   - Sets the Cell's status to `draining` in one `BEGIN IMMEDIATE` transaction, and stores `force`.
   - A draining Cell gets no new claims: `claims` returns an empty reply for it.
   - Its next heartbeat reply carries `signals: ['drain']`, or `['drain', 'force']` when `force` is true.
   - Idempotent: a second drain of a draining Cell returns the same state.
   - Unknown id: `404`.
2. **Leave** (`POST /api/v1/cells/leave`, cell):
   - Body: `{ commandId, epoch, jobId? }`.
   - No active Job: sets the Cell to `left`, clears its pin, returns `200`.
   - Active Job at the given epoch: releases the lease. The Job becomes `ready` with `workspaceMode: reuse`. The Work order goes back to `queued`, `active_cell_id` and `active_job_id` are cleared, `pinned_cell_id` is kept so the same Cell can resume its warm worktree on reconnect. `epoch` is incremented.
   - Stale epoch: `409 stale_epoch`, nothing changes.
   - Same `commandId` twice: the stored result is returned (existing idempotency rule).
3. **Lease rules** are unchanged. Leave never extends a lease.
4. **Tests** (black-box, `app.request()`):
   - drain sets `draining`; a claim from that Cell is empty; heartbeat carries `drain`.
   - leave with a Job re-queues it with `reuse`, epoch increases, pin kept.
   - leave with a stale epoch is refused and changes nothing.
   - leave twice with the same `commandId` returns the same reply.

---

## ✅ Acceptance Criteria

- [ ] Both routes are mounted and listed in factory-server PLAN §9.
- [ ] Drain never releases a Job by itself.
- [ ] Leave with a stale epoch returns `409 stale_epoch` and writes no transition row.
- [ ] Every mutation writes one `state_transitions` row with `command_id`.
- [ ] `claims` for a draining or left Cell returns an empty reply.
- [ ] A migration is generated and `db:check` passes.
- [ ] No barrel file; no `any`; no `unknown` used as a type.
- [ ] `pnpm --filter @repo/factory-server-v2 check-types`, `lint`, `test`, `db:check` pass.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): black-box test output.
