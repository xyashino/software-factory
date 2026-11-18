---
scope: factory
summary: Cell heartbeats with epoch fence, cell list and revoke
why: A late cell must not keep a lost lease, and supervisors need a list and a revoke path.
date: 2026-11-18
tags: [factory, cells, leases, revoke]
---

- `POST /api/v1/cells/heartbeats` (scope `cell:worker`) runs the lazy reaper, then fences on job `cell_id`, `epoch` and status `claimed|running|cancelled`.
- Fence miss returns `409 stale-lease-epoch`. Revoked cell returns 403.
- Heartbeat on `claimed|running` sets `lease_expires_at = now + LEASE_TTL_MS` and stamps `cells.last_heartbeat_at`.
- Cancelled job is fenceable so the cell still hears `abort`. Its lease is not extended.
- Heartbeat returns `signals: ['abort']` when the job is cancelled or its order is `paused` or `cancelled`, else `[]`.
- `GET /api/v1/cells` (scope `supervisor:read`) runs the reaper, then lists every cell with status, active job and lease.
- `DELETE /api/v1/cells/:id` (scope `supervisor:write`) sets the cell `revoked`, stamps `revoked_at`, clears its active job and revokes its session tokens.
- Revoke marks the active job `lost`, re-queues its order with `epoch + 1` and supervisor actor, and unpins every order pinned to the cell.
- Revoke is idempotent on an already revoked cell. Unknown cell returns 404.
- Reaper and revoke share `loseJob` in `application/orders/job-loss.ts`. Reaper keeps the system actor.
- Revoked session tokens fail auth first with 401, so a revoked cell cannot claim or heartbeat.
- `paused` abort signal is reached only by direct state today: the API pauses queued orders only.
- No schema migration.
