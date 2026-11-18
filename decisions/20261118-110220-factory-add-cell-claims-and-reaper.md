---
scope: factory/server
summary: Cell claims with long-poll and lazy lease reaper
why: Cells need exclusive long-poll claims, and an expired lease must free its order for another cell.
date: 2026-11-18
tags: [factory, cells, claims, leases]
---

- `POST /api/v1/cells/claims` (scope `cell:worker`) runs the lazy reaper, then picks one job in a single `immediateTx`.
- Reaper: expired `claimed|running` jobs become `lost`. Owning WorkOrder goes `queued` with `epoch + 1`, active pointers cleared, `pinned_cell_id` kept.
- Reaper: an expired `plan_branch` job re-queues a fresh ready job while the plan stays `branching`.
- Reaper: cells whose `last_heartbeat_at + LEASE_TTL_MS` has passed go `offline`. Cells never heartbeated are skipped.
- Reaper: the cell's active pointer clears and `busy` returns to `online`.
- Pick order: `plan_branch` first, then WorkOrders in project and line match, pinned or warm cell, priority, `created_at`, `order_id`.
- WorkOrder claim: `state=running`, pins the cell, `epoch + 1`, creates a `run_operator` job in `claimed`.
- Workspace is `fresh` at step 0 with no worktree resets, else `reuse`. `step_id` is null until steps exist.
- Concurrency cap is `projects.max_running`.
- Claim does not stamp heartbeat. Heartbeat route lands in step-04.
- A cell that already holds a live job gets `job: null` and does not park.
- Idle claim with `waitMs` parks on `ClaimWaitersPort.waitForWake(ms, signal)`. Zero SQLite work while parked. Retries once after wake or timeout.
- Waiter cap full: returns at once, no park.
- `wakeAll` still fires from `publishCommitted` on `queued` and `branching`.
- Epoch bumps twice on a reclaim (reaper, then claim).
- Mechanic (incident) claims deferred: no incident procedures exist yet.
- Draining cells are not excluded from claims yet.
- No schema migration.
