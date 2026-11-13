---
scope: docs
summary: Adopt factory nomenclature in code and docs, and fix core, fencing and ephemeral-Cell design issues in v2 docs
why: Align domain terms with the automated factory model (Factory, Cell, Line, Station, Operator, Work order, Cycle, Andon, Handover, Traveler) and resolve state-machine, git-fencing and ephemeral-Cell gaps before M0/M1
date: 2026-11-13
tags: [v2, nomenclature, core, architecture]
---

- The factory vocabulary is used in **both** the docs and the code (types, events, endpoints, binaries, env vars); `docs/README.md` maps each term to its code name
  - **Factory** (`factory-server`, `apps/server`) vs lowercase **factory** for the whole system
  - **Cell** (`factory-cell`, `apps/cell`, `CellId`), **Line** (`lines/`), **Station** (`StationId`), **Inspection** (`run_inspection`)
  - **Operator**: AI specialist profile (`operators/`); **Supervisor**: the person using `factory`; v1's on-call operator becomes the **Line lead** (M10)
  - **Work order** (`OrderId`, `WorkOrderState`), **Cycle** (`CycleId`), **Andon** (`andon_raised`), **Handover**, **Traveler**
- Binaries: `factory`, `factory-server`, `factory-cell`, `factory-operator`; env vars `FACTORY_*`; Cell scratch dir `.cell/`; todos `factory-<milestone>-<slug>`
- Core fixes
  - `delivery_failed` raises an Andon instead of looping `deliver`
  - `resumed{retry_station}` is defined per Andon reason; `restart_from` sets a `pendingResume` so the old Cycle cannot re-raise the Andon
  - Workspace-failure Andon checked before every job row; pure (2 consecutive failures), distinct-Cell preference left to `avoidCells` cooldown
  - `lostRestartsUsed` separate from `restartsUsed`, both reset on pass
  - Late `usage_recorded` and answers to abandoned questions accepted
  - New `reopened` (rework after delivery), `nudged`, `cycle_handed_over` events
- Protocol fixes
  - Pool enrollment: `/v1/cell/join` with join tokens; Cells keep their credential
  - Git fencing: dry-run the command before every push, then `--force-with-lease` against the freshly fetched tip; WIP refs under `factory-wip/`
  - Continuation claimed in the same transaction as the command
  - Content-derived command ids; Cell leaving on purpose hands over instead of raising an Andon
