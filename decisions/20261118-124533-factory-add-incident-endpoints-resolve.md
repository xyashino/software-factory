---
scope: factory/server
summary: Incident list and resolve endpoints with mechanic job dispatch
why: Supervisors and the mechanic Cell need HTTP to triage and resolve blocked orders, per PLAN.md 4 and 9.
date: 2026-11-18
tags: [factory, incidents, mechanic, http]
---

- New `GET /api/v1/incidents` (`supervisor:read`): filters `projectId` (required), `orderId`, `reason`, `status`.
- New `POST /api/v1/incidents/:id/resolve`: accepts `supervisor:write` or `cell:worker`, applies one of the five `resolveIncident` rules.
- Cell resolution requires the caller to hold the active `mechanic` job for that incident with a matching epoch. It marks that job `passed` and frees the cell.
- Supervisor resolution cancels any open mechanic job for the incident and frees its cell if it was claimed.
- Step blocks, worktree blocks and `line_unavailable` now call `triageIncident`: the incident gets triage status and owner, and mechanic runs are counted on the order.
- A mechanic run creates a `mechanic` job pinned to the blocked order's cell. `claimNext` claims it before work orders, through the same claim endpoint.
- `line_unavailable` incidents route to the supervisor. Before this they were opened as mechanic-owned `open`.
- Resolving rewrites the work order, step states and attempt caps, and records `state_transitions` for work order, job and incident.
- `anyScopedProcedure` accepts a token holding any listed scope. `releaseCell` and `settle` moved to `order-writes.ts`.
- Incident reason and status constants moved to `domain/incidents/incident-rules.ts`, so contracts can import them.
- Two existing black-box tests updated: incident status `open` to `triaging`, and line-unavailable owner `mechanic` to `supervisor`.
- 17 new black-box tests in `incidents-resolve.test.ts`: 205 tests pass, types and lint clean.
