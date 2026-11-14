# Roadmap

v1 builds v2. The milestone tables below list **work items** (`factory-<milestone>-<slug>`). Items
are grouped into larger todos in `todos/` (v1 format: `status`, `priority`, `depends_on`,
`workflow`), each a complete, testable slice targeting only v2 paths (see [Todo files](#todo-files)).
v1's quality gate (`pnpm check-types`, `pnpm lint`, `pnpm test`) runs on the whole repo, so v1
stays green throughout.

v1 treats a `depends_on` entry whose todo file is absent as satisfied, so all todo files must exist
before v1 starts picking them, and a dependency is named by its exact file name.

## Todo files

| Todo                                      | Depends on | Work items                                                                                             |
| :---------------------------------------- | :--------- | :----------------------------------------------------------------------------------------------------- |
| `v2-01-workspace-skeleton`                | —          | all of M0                                                                                              |
| `v2-02-core-events-state`                 | 01         | `factory-m1-ids-result`, `-events`, `-ports`, `-state-evolve`                                          |
| `v2-03-core-decide-next-job`              | 02         | `factory-m1-decide`, `-next-job`, `-context`                                                           |
| `v2-04-core-harness-scenarios-properties` | 03         | `factory-m1-harness`, `-scenarios`, `-properties`                                                      |
| `v2-05-definitions`                       | 02         | `factory-m2-definitions-port`, `-line-v2`, `-todo-parse`                                               |
| `v2-06-queue-selection`                   | 02         | `factory-m2-queue`                                                                                     |
| `v2-07-storage-event-store`               | 04         | `factory-m3-contract`, `-tx-spike`, `-sqlite`, `-projection`                                           |
| `v2-08-storage-leases-blobs-export`       | 07         | `factory-m3-leases-blobs`, `-export`                                                                   |
| `v2-09-factory-http-command-loop`         | 05, 06, 08 | `factory-m4-runtime`, `-claim-reaper`, `-prompts`, `-socket`; single-writer lock (core server)         |
| `v2-10-factory-intake-stream-admin-e2e`   | 09         | Server intake/feed/admin; end-to-end flow through the socket client                                    |
| `v2-11-worker-foundation`                 | 14         | `factory-m5-adapters-port`, socket `-client-loops`, `-workspace`, `-inspection`                        |
| `v2-12-worker-operator-stations`          | 11         | `factory-m5-headless-station`, `-operator-socket`, `-pane-runtime`, `-leave`, `-operator-cli`          |
| `v2-13-worker-delivery`                   | 12         | `factory-m5-deliver` + the M5 end-to-end run                                                           |
| `v2-14-clis`                              | 10         | `factory-m6-cli` (supervisor `factory` over the socket, one-shot fallback, `factory run`)              |
| `v2-15-distributed-hardening`             | 13, 14, 18 | all of M7                                                                                              |
| `v2-18-remote-http-adapter`               | 14         | M4R: optional TCP HTTP/SSE listener on the same server, remote Cells and CLI, remote admin, remote e2e |
| `v2-16-portability`                       | 15         | all of M8                                                                                              |
| `v2-17-cut-over`                          | 16         | M9 preparation (the v1/v2 todo split); the trial itself is run by the Supervisor                       |

M10 gets its todos when it is specified.

The server over a local Unix socket is the core of v2.0: `factory-server` owns the database and listens
on `factory.sock`. No milestone before M7 needs a network listener. The optional TCP HTTP/SSE listener on
the same server (M4R) comes after the local CLI and Cell are proven, before the distributed hardening of M7.

**Implementation order** (the todo dependencies enforce it; v1 picks todos in this order):

1. v2-09 server core: runtime, writer lock, Unix socket
2. v2-10 server intake, feed, admin, and an end-to-end run through the socket with a fake Cell
3. v2-14 supervisor CLI, so the server can be driven and inspected from a real command line
4. v2-11 Cell foundation: socket client, loops, workspace, Inspections
5. v2-12 Operator stations, checkpoints, Operator socket, `factory-operator`, leaving
6. v2-13 delivery and the first real end-to-end run
7. v2-15 distributed hardening, after the optional v2-18 remote adapter

```mermaid
flowchart LR
  M0[M0 skeleton] --> M1[M1 core domain]
  M1 --> M2[M2 definitions + queue]
  M1 --> M3[M3 storage]
  M2 --> M4[M4 Core server and local socket]
  M3 --> M4
  M4 --> M6[M6 Supervisor CLI]
  M6 --> M5[M5 Cell]
  M6 --> M4R[M4R Remote adapter, optional]
  M5 --> M7[M7 distributed hardening]
  M4R --> M7
  M7 --> M8[M8 portability]
  M8 --> M9[M9 cut-over]
  M9 --> M10[M10 Mechanic]
```

`factory-m6-cli` needs only M4. `factory-m5-operator-cli` needs `factory-m5-operator-socket`.

## M0. Workspace skeleton

| Todo                    | Depends on             | Scope                                                                                                                                                                                                           |
| :---------------------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m0-adr`        | —                      | `decisions/` entry: v2 architecture, link to `docs/`                                                                                                                                                            |
| `factory-m0-workspace`  | `factory-m0-adr`       | `apps/*` in the workspace; empty `factory-core`, `factory-runtime`, `factory-db`, `factory-definitions`, `apps/{server,cell,cli,operator-cli}` with `check-types`, `lint`, `test` scripts and a smoke test each |
| `factory-m0-boundaries` | `factory-m0-workspace` | Dependency rules of STRUCTURE §3–4, purity test, `no-restricted-imports`                                                                                                                                        |
| `factory-m0-catalog`    | `factory-m0-workspace` | Add `hono`, `fast-check` to the catalog with decision entries                                                                                                                                                   |

**Done when:** `pnpm turbo check-types lint test` is green; a test import of `@repo/software-factory`
from a v2 package fails lint; `bun:sqlite` imported in core fails lint.

## M1. Core domain

| Todo                      | Depends on                                  | Scope                                                                                                                                                      |
| :------------------------ | :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m1-ids-result`   | M0                                          | `ids.ts`, `result.ts`                                                                                                                                      |
| `factory-m1-events`       | `factory-m1-ids-result`                     | Event catalogue + envelope + zod; machine-independence schema test (I2)                                                                                    |
| `factory-m1-ports`        | `factory-m1-events`                         | `ports/` interfaces (`EventStore`, `BlobStore`, `LeaseStore`, `Clock`, `Ids`)                                                                              |
| `factory-m1-state-evolve` | `factory-m1-events`                         | `state.ts`, `evolve.ts`, `status.ts`, `projection.ts`                                                                                                      |
| `factory-m1-decide`       | `factory-m1-state-evolve`                   | `commands.ts`, `decide.ts`, every row of CORE §5.2 and every error                                                                                         |
| `factory-m1-next-job`     | `factory-m1-state-evolve`                   | `next-job.ts`, every row of CORE §6                                                                                                                        |
| `factory-m1-context`      | `factory-m1-next-job`                       | `context.ts` (CORE §7)                                                                                                                                     |
| `factory-m1-harness`      | `factory-m1-decide`, `factory-m1-ports`     | `testing/`: given/when/then harness, Line builder, fakes                                                                                                   |
| `factory-m1-scenarios`    | `factory-m1-harness`, `factory-m1-next-job` | Rewrite every v1 scenario; add Andon → resume for each `AndonReason`, `restart_from`, `reopen`, lost → restart, handover, question abandoned then answered |
| `factory-m1-properties`   | `factory-m1-scenarios`                      | fast-check generators; I1, I3–I9, I11                                                                                                                      |

**Done when:** all invariants green with ≥ 10 000 generated runs; every v1 scenario name has a v2
counterpart or a written reason it no longer applies.

## M2. Definitions and queue

| Todo                          | Depends on                    | Scope                                                                                                                                                                         |
| :---------------------------- | :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m2-definitions-port` | M0                            | Copy v1 definitions, roles → `operators/`, templates, workflows → `lines/` into `factory-definitions`; tests pass                                                             |
| `factory-m2-line-v2`          | `factory-m2-definitions-port` | Schema v2 (`sync`/`setup` become per-job workspace preparation, not a phase; Station `requires`; `maxRestarts`, `maxLostRestarts`), runtime prompt templates, snapshot + hash |
| `factory-m2-queue`            | M1                            | `core/queue/select.ts` (CORE §8) with ordering, capability and dependency tests                                                                                               |
| `factory-m2-todo-parse`       | `factory-m2-definitions-port` | Todo frontmatter parsing ported from v1 `pick-todo.ts` into `factory-definitions`, `OrderId` derivation, the missing-dependency rule, diagnostics                             |

**Done when:** `factory check` logic (as a function) validates the shipped definitions; snapshot hash
is stable across machines (fixture test).

## M3. Storage

| Todo                      | Depends on              | Scope                                                                                                |
| :------------------------ | :---------------------- | :--------------------------------------------------------------------------------------------------- |
| `factory-m3-contract`     | M1                      | Store contract suite in `core/testing` (append, conflict, replay, feed, leases, blobs, transactions) |
| `factory-m3-tx-spike`     | `factory-m3-contract`   | Prove the write mutex over `bun:sqlite` (STORAGE §3.1): concurrent appenders, slow transaction body  |
| `factory-m3-sqlite`       | `factory-m3-tx-spike`   | `factory-db`: migrations `0001_init.sql`, event store, append transaction (STORAGE §3)               |
| `factory-m3-projection`   | `factory-m3-sqlite`     | `orders` projection writes + rebuild + identical-rebuild test                                        |
| `factory-m3-leases-blobs` | `factory-m3-sqlite`     | Lease store, blob store, sweep                                                                       |
| `factory-m3-export`       | `factory-m3-projection` | Export/import file format (STORAGE §7.3), round-trip test                                            |

**Done when:** fake and SQLite pass the same contract suite, including 2 concurrent appenders.

## M4. Core server and local socket

| Todo                      | Depends on                                | Scope                                                                                                                                                 |
| :------------------------ | :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m4-runtime`      | M2, M3                                    | `factory-runtime`: compose stores and definitions; application API and command loop over core ports; writer-lock requirement                          |
| `factory-m4-claim-reaper` | `factory-m4-runtime`, M2                  | Runtime claim, lease, heartbeat, reaper and boot-grace use cases and lifecycle loops                                                                  |
| `factory-m4-prompts`      | `factory-m4-runtime`, M2                  | Port v1 prompt rendering to runtime; relative paths, blobs and runtime prompts into the `Job`                                                         |
| `factory-m4-intake`       | `factory-m4-runtime`, M2                  | Runtime intake: git mirror, todos → `CreateOrder` / `UpdateSpec` / `Cancel`, PR state polling, v2 todo filter (M9)                                    |
| `factory-m4-socket`       | `factory-m4-runtime`                      | `apps/server` Unix socket listener at `$FACTORY_DATA_DIR/factory.sock` (0600), contract-typed routes, and the socket client used by tests and the CLI |
| `factory-m4-feed`         | `factory-m4-runtime`                      | Runtime event feed from `global_seq`, consumed by `status --watch` and `log -f` over the socket                                                       |
| `factory-m4-admin`        | `factory-m4-runtime`, `factory-m3-export` | Local admin operations: `backup \| export \| import \| rebuild-projections`                                                                           |
| `factory-m4-e2e-local`    | all above                                 | A scripted fake Cell connects to a server on a temp socket and drives a `feature` Work order to delivered through the socket client                   |

**Done when:** the local e2e test passes with no network listener (socket only); killing and restarting
the server mid-Work-order loses nothing; a second server is refused by the lock.

## M4R. Remote HTTP adapter (optional)

Delivered in `v2-18`, after M6. Nothing in M5 to M6 depends on it.

| Todo                        | Depends on                | Scope                                                                                                                                                                                      |
| :-------------------------- | :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m4-http`           | M4, M6                    | Optional TCP listener on the same `factory-server`: Hono HTTP over the runtime, remote auth, `admin token create`, error mapping, supervisor/Cell/blob routes; reuses the socket contracts |
| `factory-m4-stream`         | `factory-m4-http`         | Remote `/v1/stream` SSE adapter over the runtime event feed                                                                                                                                |
| `factory-m4-remote-clients` | `factory-m4-http`, M5, M6 | Remote `FactoryClient` for the CLI and the remote Cell client; config-selected, local stays the default                                                                                    |
| `factory-m4-remote-admin`   | `factory-m4-http`         | Remote `factory-server admin ...` entrypoints against the remote runtime's own database                                                                                                    |
| `factory-m4-e2e-remote`     | all above                 | The same scenario as `factory-m4-e2e-local` through HTTP; asserts equivalent events and projections                                                                                        |

**Done when:** remote e2e matches local e2e; local mode still starts no TCP listener.

## M5. Cell

| Todo                          | Depends on                    | Scope                                                                                                                        |
| :---------------------------- | :---------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `factory-m5-adapters-port`    | M0                            | Port v1 adapters (herdr, git, github, process, runners) with tests                                                           |
| `factory-m5-client-loops`     | M4                            | Cell socket client to `factory-server`; hello, claim/heartbeat loops, idempotency ids, self-fence (remote TCP client in M4R) |
| `factory-m5-workspace`        | `factory-m5-adapters-port`    | Mirror, worktree at base, sync/setup cache, LRU, `.cell/` excluded                                                           |
| `factory-m5-inspection`       | `factory-m5-workspace`        | `run-inspection.ts`                                                                                                          |
| `factory-m5-headless-station` | `factory-m5-workspace`        | `run-operator-station.ts` for headless runners first (no Herdr), checkpoint procedure (PROTOCOL §8.2)                        |
| `factory-m5-operator-socket`  | `factory-m5-headless-station` | Unix socket, Cycle tokens, local validation, blob upload                                                                     |
| `factory-m5-pane-runtime`     | `factory-m5-operator-socket`  | Herdr panes + `core/cycle` watch + signals + question hold                                                                   |
| `factory-m5-leave`            | `factory-m5-pane-runtime`     | `SIGTERM` handling: Handover request, `HandOverCycle`, `ReleaseJob` fallback                                                 |
| `factory-m5-operator-cli`     | `factory-m5-operator-socket`  | `factory-operator` verbs (`done`, `verdict`, `ask`, `tell`, `block`, `context`); startup < 100 ms test                       |
| `factory-m5-deliver`          | `factory-m5-workspace`        | Squash, rebase, PR create-or-find                                                                                            |

**Done when:** a real fixture repo Work order is delivered end to end with a scripted fake runner,
and once manually with a real runner. Cells connect to the server over the Unix socket; no Cell
opens the database and no network listener is needed.

## M6. Supervisor CLI

| Todo             | Depends on | Scope                                                                                                                                                                                           |
| :--------------- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m6-cli` | M4         | `factory` commands over the socket client; `factory run` starts the server; one-shot fallback via `factory-server --once`; config, coloured board and Traveler rendering (`NO_COLOR` respected) |

## M7. Distributed hardening (R2, R3, R8)

| Todo                      | Depends on           | Scope                                                                                                                                   |
| :------------------------ | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `factory-m7-harness`      | M6, M4R              | Test harness: one Factory, N Cell processes over HTTP, fake runner, a TCP proxy that can drop or delay traffic                          |
| `factory-m7-takeover`     | `factory-m7-harness` | `kill -9` a Cell mid-Cycle → another Cell restarts the Station; no double work                                                          |
| `factory-m7-partition`    | `factory-m7-harness` | Partition a Cell → self-fence, stale epoch rejected, no push from the fenced Cell                                                       |
| `factory-m7-duplicates`   | `factory-m7-harness` | Drop responses → retries produce no duplicate events, continuation job delivered once                                                   |
| `factory-m7-andon-resume` | `factory-m7-harness` | Operator blocks on Cell A; A takes another Work order at once; resume runs on Cell B from the WIP checkpoint, passed Stations not rerun |
| `factory-m7-leave`        | `factory-m7-harness` | `SIGTERM` a Cell mid-Cycle → Handover; Cell B continues from the WIP without the Supervisor                                             |
| `factory-m7-race`         | `factory-m7-harness` | 10 Cells, 50 Work orders, Cells joining and leaving: every Work order delivered exactly once                                            |

**Done when:** all of the above run in CI, repeated 20× without a flake.

## M8. Portability (R1)

| Todo                      | Depends on              | Scope                                                                                                   |
| :------------------------ | :---------------------- | :------------------------------------------------------------------------------------------------------ |
| `factory-m8-backup`       | M4                      | Litestream example in `deploy/`, restore runbook                                                        |
| `factory-m8-move`         | `factory-m8-backup`, M7 | Test: export from Factory A mid-run, import into Factory B, Cells re-joined, every Work order completes |
| `factory-m8-git-recovery` | M7                      | `order_recovered` (CORE amendment) + rebuild from git (STORAGE §8)                                      |

## M9. Cut-over

- v1 and v2 never take the same todo. During the trial, v2's intake only takes todos with
  `factory: v2` in their frontmatter; v1 skips those (a one-line filter in v1's `pick-todo.ts`,
  the only v1 edit this plan makes, with its own `decisions/` entry).
- Run v2 against this repository in parallel with v1 for one week on non-critical todos.
- Exit criteria: no lost or duplicated Work order; every Andon resumed successfully; board parity
  with v1.
- Then: v2 takes every todo, v1 is frozen (kept for reference), `sf` scripts point at `factory`.

## M10. Mechanic (triage and live intervention)

Reintroduce v1's on-call operator as the **Mechanic**, a separate module: handles Andon triage
(`incident` sub-entity with its own budget, deciding whether to `Resume`, `Cancel` or escalate to
the Supervisor), answers `question_asked` when it can, and can intervene mid-Cycle on repeated stall
alerts (`Nudge` with sanitized pane-tail context, or `Cancel` / escalation) without editing the
worktree (`decisions/20261113-230000`, `20261114-112011`). Specified in CORE when M10 starts;
nothing before M10 depends on it.

## Requirement coverage

| Requirement              | Proven by                                                                                                                             |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| R1 portable queue        | `factory-m3-export`, `factory-m8-move`, `factory-m8-git-recovery`, I1–I2                                                              |
| R2 no double work        | `factory-m3-contract` (concurrency), `factory-m7-takeover`, `factory-m7-partition`, `factory-m7-duplicates`, `factory-m7-race`, I4–I5 |
| R3 non-blocking Andons   | `factory-m1-scenarios` (Andon → resume), `factory-m7-andon-resume`, I6–I7, I9                                                         |
| R4 deterministic control | `factory-m0-boundaries` (purity), I1, I9                                                                                              |
| R5 auditable             | prompt blobs in `cycle_started`, `nudged` events, `factory log`                                                                       |
| R6 runner-agnostic       | `factory-m5-adapters-port`                                                                                                            |
| R7 declarative Lines     | `factory-m2-*`                                                                                                                        |
| R8 replaceable Cells     | `factory-m5-leave`, `factory-m7-leave`, `factory-m7-race`, I11                                                                        |
