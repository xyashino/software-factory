---
scope: factory/cell
summary: Re-adopt live Herdr Operator panes after factory-cell restarts
why: v2 lost live panes on restart and closed them on Cell stop; v1 reconcile re-attached them
date: 2026-11-16
tags: [cell, herdr, operator, reconcile, session, restart]
---

- A pane station writes `<cellDataDir>/cycles/<dir>/session.json` once its Herdr pane opens, and again when cycle state changes.
  - Holds job, cycle, epoch, pane name, tab id, operator port and token, worktree and cycle state. Written atomically, mode 0600.
- Cell stop keeps the pane and its session. Only a definitive end (done, handover, block, fail, release) or a stale lease closes the pane and deletes the session.
- Startup `reconcileSessions` runs before the claim loop and the first heartbeat:
  - pane `gone`: session discarded.
  - heartbeat answers `ok` for the job: the station is adopted and runs in the background.
  - heartbeat answers stale or the job is not held: pane closed, session deleted.
  - port taken or adoption throws: pane closed, session deleted, error reported through `onError`.
- Adoption binds the port and token the pane was launched with: `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN` are fixed in the pane's env.
- No server change: job ids are fresh per claim, so an `ok` heartbeat proves the same claim and epoch and extends the lease.
- Not restored: an `ask` still waiting at the old endpoint (its HTTP call died with it); the Herdr workspace map after restart, so deliver's `closeTask` is a no-op.
- Headless stations are not adopted: no pane outlives the Cell process.
