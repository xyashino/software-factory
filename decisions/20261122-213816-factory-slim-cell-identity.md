---
scope: factory
summary: HQ stores no Cells, Cells authenticate by Factory credential
why: A Cell id is random per run and the Factory daemon owns it. HQ needs only the Factory credential and x-cell-id, so no Cell table, token or status is kept.
date: 2026-11-22
tags: [factory, cell, hq, identity, migration, relay]
---

- Cell id `cell-<8 hex>` picked by the Factory daemon per run, sent as `x-cell-id` on every Cell request. Never stored in HQ, never reused.
- Routes `claims`, `heartbeats`, `jobs/:id/transitions`, `incidents/:id/resolve` accept only `factory:worker`. No Cell token kind, no `cell:*` scope.
- Claim body carries `projectId`, `allowedLines`, `runners`. `hello`, `enroll`, `drain`, `leave`, `GET /cells`, `DELETE /cells/:id` removed from HQ.
- Jobs record `claimed_by_cell_id` and `claimed_by_factory_id`. Job history keeps the cell id after the Cell is gone.
- Orders pin to a Factory (`pinned_factory_id`). Another Factory claims only when the pinned one is silent for `LEASE_TTL_MS`.
- Silent Factory: active jobs lost, orders unpinned. `POST /factories/cells/:id/gone` loses that Cell's job only if the caller Factory claimed it.
- Factory heartbeat carries `projects: [{projectId, desired, running}]`, stored on `factories.projects_json`, shown by `GET /factories`.
- Migrations `0005_cell_identity_add` (add columns, backfill) and `0006_cell_identity_drop` (rebuild tables, drop `cells`, Cell tokens, cell columns).
- `unavailable_line_cells_json` renamed `unavailable_line_factories_json`, reset to `[]` in 0006 (old cell ids have no Factory meaning).
- sf: relay forwards with the Factory credential and `x-cell-id`, no enroll, no per-Cell session swap. 401 from HQ stops that Cell.
- sf: Cell start only under the Factory daemon (`FACTORY_CELL_ID` set). Cell state file, `sf cell revoke`, `cell list` HQ merge removed.
- `sf cell list|stop` act on the local daemon only. Stop = kill first, HQ gone second.
- Known gap: `sf service install --cell` still writes standalone Cell units that now refuse to start. Follow-up needed.
- Known gap: drain code (`drain` signal, `leave` route in sf) is dead code, removal is `cell-drain-removal`.
