---
status: todo
priority: high
depends_on: [v2-14-clis]
workflow: feature
---

# v2-11: Worker foundation — socket client, loops, workspace, Inspections

## Objective

A `factory-worker` that uses a transport-neutral FactoryClient, keeps leases alive, self-fences,
prepares workspaces and runs Inspection Stations end to end. In v2.0 the Worker is a client of the
running `factory-server` over the Unix socket. It is not in-process with the runtime and never opens the
database. The remote TCP client is added in `v2-18`.

## Read first

- `docs/PROTOCOL.md` §1–2, §3.2, §3.5, §4, §5, §6, §9 (socket and remote transports, directories, `run_inspection`)
- `docs/STRUCTURE.md` §2–3 (`apps/worker` socket client, `factory-server`)
- `docs/STRUCTURE.md` §1 (`apps/worker`), §6 (adapter and `gate.ts` rows), `docs/RULES.md` §3–4
- v1: `packages/software-factory/src/adapters/{herdr,git,github,system,runners}`,
  `src/supervisor/gate.ts`

## Scope (ROADMAP items)

`factory-m5-adapters-port`, `factory-m5-client-loops`, `factory-m5-workspace`,
`factory-m5-inspection`.

## Deliverables

1. Adapters ported with their tests into `apps/worker/src/adapters/` (runner code only under
   `adapters/runners/<runner>.ts`).
2. `factory-client.ts`: transport-neutral typed client from shared contracts, with the socket adapter
   (`SocketFactoryClient`) that talks to `factory-server` over `$FACTORY_DATA_DIR/factory.sock`;
   content-derived command ids; retry with backoff. The socket adapter must not open `factory-db`
   directly. The remote TCP adapter (v2-18) implements the same contract.
3. `main.ts`: config (`~/.config/factory-worker/config.toml`), join + credential storage, `hello`,
   claim loop per free slot, one shared heartbeat loop, self-fence at 45 s. One Worker process runs N
   slots by default.
4. `workspace/`: bare mirror, worktree per `todoId` at `base`, `sync` + `setup` cache keyed by
   commit, LRU eviction, `.worker/` in the mirror's `info/exclude`, `ReportWorkspaceFailed`.
5. `jobs/run-inspection.ts`: commands with timeout, full log blob, 2 KiB ANSI-stripped tail,
   `ReportInspection`; read-only check (dirty tree → `FailCycle{crashed}`).

## Acceptance criteria

- Tests start `factory-server` on a temp socket and cover initialization, claim, heartbeat, and an
  Inspection job reported over the socket; no network listener is started.
- Self-fence test: heartbeats blocked → job stopped before the lease expires.
- `apps/worker` does not import `factory-db` or `factory-definitions` (lint), and does not import the
  runtime library (lint).
- `pnpm turbo check-types lint test` green.
