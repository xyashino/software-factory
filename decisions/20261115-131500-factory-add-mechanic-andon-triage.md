---
scope: factory
summary: Mechanic triages each Andon and records an incident
why: Every Andon waited for the Supervisor. The Mechanic now triages it first, records an auditable incident, and escalates when its budget is spent.
date: 2026-11-15
tags: [v2, mechanic, andon, incidents, triage, cell]
---

- The Mechanic is an actor `{ kind: 'mechanic', name }` on every event it causes (R5); it runs only the commands CORE §14.3 allows.
- New command `RecordIncident` (Mechanic only) and event `incident_recorded`; `WorkOrderState.incidents` keeps the history.
  - One incident per Andon: a second `RecordIncident` for the same Andon is refused.
  - A `repair` names each changed file or config with a commit sha or blob ref.
- The Mechanic's `Resume` is refused until the incident of the open Andon exists (CORE I12).
- `Answer`, `Nudge` and `Cancel` accept the Mechanic; `Reopen` and `Reprioritise` stay Supervisor-only.
- Every new Andon starts with `triage: 'mechanic'`; `nextJob` returns a `mechanic` job while budget is left and no incident exists.
  - The budget is `MECHANIC_BUDGET = 2` per Work order; `mechanicRuns` counts claimed Mechanic jobs, lost ones included.
  - `escalate`, or a spent budget (`EscalateAndon` by the factory), moves the Andon to `triage: 'supervisor'` with an incident attached.
- The Supervisor's `Resume` and `Cancel` record their own incident when the Andon has none, and `Resume` waits while a Mechanic job runs.
- The Cell runs a `mechanic` job in a Herdr pane with the incident prompt, in a repair checkout, never a Work order worktree.
  - Its socket takes `incident` and `escalate` only; follow-ups are `Resume`, `Cancel` or `Nudge` under the `mechanic` actor.
  - A pane that exits or times out with no incident submits nothing, so the lease lapses and the reaper counts the run.
- `factory show` and `factory log` render incidents.
- Not in this change: the distributed `factory-m10` scenarios and live intervention (stall alerts, `Answer`).
