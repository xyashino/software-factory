---
status: todo
priority: high
depends_on: [v2-09-factory-http-command-loop]
workflow: feature
---

# v2-10: Factory — intake, event stream, admin, end-to-end with a fake Cell

## Objective

Finish the Factory: todos flow in from git, PR state flows back, the event stream feeds the CLI,
admin commands cover backup and moves, and a scripted fake Cell proves a Work order goes from todo
to delivered over HTTP only.

## Read first

- `docs/PLAN.md` F1, `docs/CORE.md` §5.2 (`CreateOrder`, `UpdateSpec`, `Cancel`, `RecordPrState`)
- `docs/PROTOCOL.md` §3.1 (`/v1/stream`, `/v1/intake/sync`, export), §11
- `docs/STORAGE.md` §4 (`intake` table), §6, §7, `docs/ROADMAP.md` M4 and M9 (todo filter)

## Scope (ROADMAP items)

`factory-m4-intake`, `factory-m4-stream`, `factory-m4-admin`, `factory-m4-e2e-fake-cell`.

## Deliverables

1. Intake: bare mirror per project, poll + `/v1/intake/sync`; parse todos with
   `factory-definitions`; `CreateOrder` / `UpdateSpec` / `Cancel` (only before the first claim);
   spec-drift diagnostics; only todos with `factory: v2` while the cut-over flag is on.
2. PR state polling for delivered Work orders → `RecordPrState`.
3. `/v1/stream` SSE from the event feed with `Last-Event-ID` = `globalSeq`.
4. `factory-server admin backup | export | import | rebuild-projections`; import appends
   `ExpireLease` for Work orders that had an active job; `/v1/admin/export`.
5. A scripted fake Cell (test helper) that joins, claims and reports through HTTP only.

## Acceptance criteria

- E2E: a `feature` Work order goes from a todo file in a fixture repo to `delivered` with the fake
  Cell, through every Station.
- E2E: killing and restarting the Factory mid-Work-order loses nothing.
- `pnpm turbo check-types lint test` green.
