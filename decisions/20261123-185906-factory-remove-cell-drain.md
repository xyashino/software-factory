---
scope: factory
summary: Remove Cell drain, force and leave, stop means gone
why: Stop means delete. Drain and handover were dead after cell-identity-slim, and kept two exits and a superseded path.
date: 2026-11-23
supersedes: 20261119-013847-factory-add-cell-drain-leave
tags: [factory, cell, sf, cleanup]
---

- Claim reply carries no `signals`. Heartbeat reply `signals` is `['abort']` only (`cells.contract.ts`).
- sf Cell loop has two exits: heartbeat `abort` ends the running job, and the process signal (SIGINT/SIGTERM) stops the runner. Neither calls HQ.
- Removed: `drain-signal.ts`, `drain-policy.ts`, `leave.procedure.ts`, `StartOutcome` (`superseded`), `DrainState` on the Cell runtime.
- Removed: `POST /relay/api/v1/cells/leave` from the relay allowlist.
- Runner still alive after an abort: job fails, `startCell` throws `Refused`, the Cell stops claiming. No handover.
- Migration `0001_cell_drain_leave` stays: applied migrations are history. Its columns and statuses are gone with the `cells` table (`0006`).
- Supersedes drain and force ADRs `20261119-013847` and `20261121-175500`.
