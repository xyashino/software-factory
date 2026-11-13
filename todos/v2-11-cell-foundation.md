---
status: todo
priority: high
depends_on: [v2-10-factory-intake-stream-admin-e2e]
workflow: feature
---

# v2-11: Cell foundation — adapters, Factory client, loops, workspace, Inspections

## Objective

A `factory-cell` that joins a Factory, keeps leases alive, self-fences, prepares workspaces and
runs Inspection Stations end to end.

## Read first

- `docs/PROTOCOL.md` §1–2, §3.2, §3.5, §4, §5, §6, §9 (directories, `run_inspection`)
- `docs/STRUCTURE.md` §1 (`apps/cell`), §6 (adapter and `gate.ts` rows), `docs/RULES.md` §3–4
- v1: `packages/software-factory/src/adapters/{herdr,git,github,system,runners}`,
  `src/supervisor/gate.ts`

## Scope (ROADMAP items)

`factory-m5-adapters-port`, `factory-m5-client-loops`, `factory-m5-workspace`,
`factory-m5-inspection`.

## Deliverables

1. Adapters ported with their tests into `apps/cell/src/adapters/` (runner code only under
   `adapters/runners/<runner>.ts`).
2. `factory-client.ts`: typed client from `factory-core/contracts`, content-derived command ids,
   retry with backoff until the self-fence deadline, 401 → re-join.
3. `main.ts`: config (`~/.config/factory-cell/config.toml`), join + credential storage, `hello`,
   claim loop per free slot, one shared heartbeat loop, self-fence at 45 s.
4. `workspace/`: bare mirror, worktree per `todoId` at `base`, `sync` + `setup` cache keyed by
   commit, LRU eviction, `.cell/` in the mirror's `info/exclude`, `ReportWorkspaceFailed`.
5. `jobs/run-inspection.ts`: commands with timeout, full log blob, 2 KiB ANSI-stripped tail,
   `ReportInspection`; read-only check (dirty tree → `FailCycle{crashed}`).

## Acceptance criteria

- Tests against the v2-10 Factory in-process: join, claim, heartbeat, Inspection job reported.
- Self-fence test: heartbeats blocked → job stopped before the lease expires.
- `apps/cell` does not import `factory-db` or `factory-definitions` (lint).
- `pnpm turbo check-types lint test` green.
