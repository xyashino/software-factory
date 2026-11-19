---
scope: factory
summary: Add Mechanic payload, line timeout and repair dir for the Cell
why: A Mechanic job had no incident data, and the Cell had no timeout or repair dir to run it in
date: 2026-11-19
tags: [v2, mechanic, cell, herdr]
---

- `apps/factory-server/src/application/orders/incident-writes.ts`: a Mechanic job's payload carries `lineName` and the incident `reason` and `detail`. `transition-job.procedure.ts` passes them in.
- `apps/factory/src/domain/line/parse-line.ts`: `mechanicTimeoutMs` reads `mechanic.timeout` from the line (e.g. `40m`), default 30 minutes.
- `apps/factory/src/adapters/fs/repair-dir.ts`: `repairDirOf` gives `<cellDataDir>/repairs/<sha256(jobId)[:16]>`; `prepareRepairDir` writes `prompt.md` and an executable `bin/factory-operator` shim.
- Not in this change:
  - the `mechanic` dispatch in `run-job`, and the Mechanic run itself
  - routing of the `incident` and `escalate` verbs to resolve-incident
  - the todo's verdict, block and handover verbs, which the operator CLI does not give a Mechanic
