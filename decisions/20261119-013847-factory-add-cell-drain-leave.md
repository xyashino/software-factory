---
scope: factory
summary: Add cell drain and leave routes to factory-server
why: Stop a cell cleanly so its Job is handed over now, not after lease expiry.
date: 2026-11-19
tags: [factory, server, cell]
---

- `POST /api/v1/cells/{id}/drain` (`supervisor:write`): cell becomes `draining`, `force` stored. Optional `commandId` recorded on the transition.
- Draining cell gets no claims. Heartbeat signals `drain`, plus `force` when requested.
- Drain never releases a Job. Repeat drain returns the same state and writes no row.
- `POST /api/v1/cells/leave` (`cell:worker`): cell id comes from the token, never the body.
- Leave with a live Job at the given `epoch` and `jobId`: Job `ready` with `reuse`, order `queued`, `pinnedCellId` kept, epoch +1 on both. Cell `left`.
- Leave with no Job: cell `left`, pins cleared.
- Stale epoch returns `409 stale-lease-epoch` with no writes. Missing `jobId` while holding a Job returns `409 conflict`.
- Leave `commandId` replay returns the stored reply and writes no rows.
- Claim path resumes a `ready` run_operator Job at the order's current step before inserting a new one.
- `left` cells get no claims and count as unreachable for order pins.
- `hello` revives a `left` cell to `online` and writes one transition row.
- Migration `0001_cell_drain_leave` adds `cells.drain_force`. `left` added to cell statuses.
- Only run_operator Jobs can be handed over. Other kinds get `409` and wait for lease expiry.
