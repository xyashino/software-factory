---
status: todo
priority: high
depends_on: [v2-09-factory-http-command-loop]
workflow: feature
---

# v2-10: Server — intake, event feed, admin and end-to-end flow

## Objective

Complete the `factory-server` core: todos flow in from git, PR state flows back, the CLI and Cells read
the event feed over the Unix socket, and admin operations cover backup and move. A scripted fake Cell
connects to the server over the socket and proves a Work order goes from todo to delivered through the
socket client.

## Read first

- `docs/PLAN.md` F0, F1, `docs/CORE.md` §5.2 (`CreateOrder`, `UpdateSpec`, `Cancel`, `RecordPrState`)
- `docs/PROTOCOL.md` §2–3 (local socket transport, feed, admin), §11
- `docs/STORAGE.md` §1, §4 (`intake` table), §6, §7
- `docs/ROADMAP.md` M4 and M9 (todo filter)

## Scope (ROADMAP items)

`factory-m4-intake`, `factory-m4-feed`, `factory-m4-admin`, `factory-m4-e2e-fake-cell`.

## Deliverables

1. Runtime intake: bare mirror per project, poll + runtime `sync` operation; parse todos with
   `factory-definitions`; `CreateOrder` / `UpdateSpec` / `Cancel` (only before the first claim);
   spec-drift diagnostics; only todos with `factory: v2` while the cut-over flag is on.
2. Runtime PR state polling for delivered Work orders → `RecordPrState`.
3. Runtime event feed: an async stream from `global_seq`, served by `factory-server` over the socket and
   consumed by the socket client for `factory status --watch` and `factory log -f`.
4. Runtime admin operations `backup | export | import | rebuild-projections`, exposed as local
   `factory admin ...` commands. Import appends `ExpireLease` for Work orders that had an active job.
5. Scripted fake Cell and fixture repo. The fake Cell connects to a `factory-server` on a temp
   socket and runs the flow through the socket client, not in-process.

## Acceptance criteria

- E2E: a `feature` Work order goes from a todo file in a fixture repo to `delivered` through every
  Station, with the fake Cell connected over the socket and no network listener.
- E2E: killing and restarting the server mid-Work-order loses nothing.
- Export → import into an empty database reproduces events, blobs and projections.
- `pnpm turbo check-types lint test` green.
