---
scope: factory/server
summary: Job line_unavailable transition re-dispatches the order over HTTP
why: A Cell that cannot run a line must hand its job to another eligible order at once, per PLAN.md 3.2 and BE_RULES.md 198.
date: 2026-11-18
tags: [factory, jobs, transitions, incidents, http]
---

- `POST /api/v1/jobs/:id/transitions` takes `line_unavailable` with `lineName` and `detail`, scoped to `cell:worker`.
  - Same `commandId` replay and `epoch` fence as the other actions.
- Allowed on a `claimed` or `running` job: job `line_unavailable`, its bound step back to `pending`, cell released.
- The cell id is appended to order `unavailable_line_cells_json`; order `active_job_id`, `active_cell_id` and `pinned_cell_id` cleared.
- Order goes `queued` when another online, busy or draining cell on the project allows the line and is not in that list.
  - Otherwise order goes `line_unavailable` and a `line_unavailable` Incident opens.
- The same cell then claims through the shared `claimNext` rules, returned inline as `nextJob`, or `null` when nothing is eligible.
- A `plan_branch` job has no order, so it is refused with `409 conflict`.
