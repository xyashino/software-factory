---
scope: factory/server
summary: Pure incident triage routing and five resolution transitions
why: Incident state must be decided by pure rules before any DB or HTTP wiring, per PLAN.md 4.1-4.3.
date: 2026-11-18
tags: [factory, incidents, triage, resolutions, domain]
---

- New `domain/incidents/incident-rules.ts`: pure functions, no DB, no IO.
  - Reuses `OrderStep` and `UnprocessableTransition` from `orders/job-transitions`, and `WorkOrderState` from `orders/order-state`.
- `triageIncident(reason, workOrder)`:
  - `line_unavailable`, spent mechanic budget (`MAX_MECHANIC_RUNS`), or no pinned cell go to `supervisor` with no job.
  - Otherwise `mechanic`: `mechanicRuns` +1 and a job pinned to `pinnedCellId`.
- `resolveIncident(incident, workOrder, resolution)`, for `open`, `triaging` or `escalated` incidents only:
  - `retry_step`: raises the step's `maxAttempts` by 1 (attempts used are kept), clears unavailable cells, `currentStepIndex` = step, order `queued`.
  - `restart_from_step`: requires `0 <= stepIndex <= failedStepIndex`, rewinds, resets attempts from that step, order `queued`.
  - `restart_from_scratch`: step 0, clears `worktreeResets`, `staleBase` and unavailable cells, resets all attempts, order `queued`, `workspaceMode: 'fresh'`.
  - `escalate`: incident `escalated`, owner `supervisor`, order stays `blocked`.
  - `cancel`: incident and order `cancelled`, `pinnedCellId` cleared.
- Pinned cell is kept on the retry and restart resolutions; the Cell wipes the worktree on claim.
- Incident reason and status unions are duplicated in the domain, not imported from `db/schema/incidents.ts`, to keep layering.
