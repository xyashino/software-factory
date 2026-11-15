---
status: todo
priority: medium
depends_on: [v2-fix-inspection-tail-sanitization]
workflow: feature
factory: v2
---

# v2-24-mechanic: Mechanic (Andon triage and workflow repair)

## Objective

Every Andon starts the **Mechanic**, an on-call Operator that triages it. The Mechanic may repair the
workflow so the Work order can go on, but it must record an **incident** that says what went wrong
and how it was resolved. Without the incident record, no repair counts.

## Read first

- `docs/ROADMAP.md` M10 (the Mechanic is specified in CORE when M10 starts)
- `docs/CORE.md` §4.3 (Andon), §5 (commands), §9 (watch), §12 (Order Plan, for the plan Andons)
- `docs/PROTOCOL.md` §4 (job kinds), §7 (signals: nudge, answer), §9 (Herdr panes)
- `docs/OPEN-QUESTIONS.md` Q14, Q18 (who triages, who may be asked)
- `decisions/20261113-230000-factory-mechanic-andon-triage.md`, `decisions/20261114-112011-factory-mechanic-live-step-intervention.md`
- v1 on-call operator: `packages/software-factory/src/supervisor/operator.ts`, prompt
  `packages/software-factory/templates/prompts/incident.md`

## Deliverables

1. **Spec in CORE (M10 section):** the `mechanic` job kind, when `nextJob` picks it (an open Andon
   with the Mechanic budget left), its events, and its budget per Work order.
2. **Incident record:** an `incident` entity on the Work order's Traveler, written by the Mechanic
   before it finishes. It holds: the Andon it triaged, what went wrong (its diagnosis), the action
   taken (`resume`, `cancel`, `nudge`, escalation, or a workflow repair), what it changed (file or
   config, with the commit or blob ref), and the outcome. It is visible in `factory show` and
   `factory log`.
3. **Authority:** the Mechanic may `Resume`, `Cancel`, `Nudge` and escalate to the Supervisor. It may
   repair the workflow: Line, Operator and Cell configuration, and runner settings. It may **not**
   edit the Work order's own worktree code. A repair that changes a Line is applied to new Work
   orders only (the Line is pinned, CORE §4.4).
4. **Mechanic job in the Cell:** runs the Mechanic in a Herdr pane with the incident prompt (v1
   `incident.md`), the same way a Station Operator runs (PROTOCOL §9), and submits its result through
   the operator CLI.
5. **Known case, handled without a human:** a pane start stopped by the folder-trust screen
   (`blocked during startup`). The Cell confirms it and retries (done in v2 Cell); the Mechanic
   records the incident when it has to do it itself.
6. **Escalation:** when the Mechanic cannot resolve the Andon or its budget is spent, the Andon
   goes to the Supervisor with the incident attached.

## Out of scope

- Editing code in a Work order's worktree (that is a new Cycle, not a Mechanic repair).
- Automatic restack of Order Plans (CORE §12.8).

## Acceptance criteria

- [ ] Every Andon raised after this lands has exactly one incident record, written before the Andon
      is cleared, and no Andon is cleared without one.
- [ ] An incident holds the diagnosis, the action, the change (with its ref) and the outcome, and is
      shown by `factory show` and `factory log`.
- [ ] The Mechanic cannot change a Work order's worktree; a test proves it is refused.
- [ ] The trust-screen case ends with a recorded incident and the Work order running again, with no
      Supervisor action.
- [ ] Budget spent: the Andon goes to the Supervisor, with the incident attached.
- [ ] `pnpm turbo check-types lint test` green; the distributed suite still green.
