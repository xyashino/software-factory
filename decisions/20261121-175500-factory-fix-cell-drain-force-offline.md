---
scope: factory
summary: Drain upgrades to force and warns when Cell offline
why: A later --force was ignored and a drain on an offline Cell never arrived, with no warning.
date: 2026-11-21
tags: [factory, cell, drain]
---

- `POST /api/v1/cells/{id}/drain` with `force: true` on a `draining` Cell sets stored `drainForce` true. Reply `force` reflects it. No transition is written.
- Drain on an `offline` Cell still records `draining`, and the reply carries `offline: true`.
- Drain reply contract gains `offline` in the factory and sf copies (`cells.contract.ts`).
- `commandId` replay is unchanged: a replayed `commandId` returns stored state, no upgrade. `sf cell stop` sends no `commandId`.
- Deliverable statuses: `online`, `busy`, `draining`. `offline`, `left`, `revoked` never get a heartbeat signal.
- `sf cell stop` prints `cell <id> draining: leaves after the current station; use --force to abort it now`, or `cell <id> draining (force): current station is aborted at the next heartbeat`.
- Offline Cell: `sf cell stop` also warns on stderr that no heartbeat will deliver the drain, and names `sf cell revoke`.
