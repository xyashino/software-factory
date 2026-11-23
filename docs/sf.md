# `sf` CLI — plan

One binary: `sf`. It is the only CLI (the old `factory` CLI, `apps/cli`, was removed) and serves the Supervisor (you),
the Cell daemon (each machine that runs work), and the Operator and Mechanic verbs (agents inside a job).

Names used here follow the [glossary](./README.md#glossary): **HQ** is the external server, **Factory** is the local daemon (`sf factory`), **Cell** is the worker.

## 0. Install and quickstart

`bun run build:sf` compiles `apps/sf/dist/sf` (HQ server, init templates and SQL migrations embedded) and
builds the web UI. `scripts/install.sh` copies them under `$PREFIX` (default `/usr/local`):

```bash
bun install && bun run build:sf
sudo scripts/install.sh               # bin/sf + share/sf/web
PREFIX=$HOME/.local scripts/install.sh   # no sudo; then SF_WEB_DIR=$HOME/.local/share/sf/web
```

`sf web start` finds the web UI in `$SF_WEB_DIR`, then `/usr/local/share/sf/web`, then `/usr/share/sf/web`.
State lives in `$XDG_DATA_HOME/sf` (default `~/.local/share/sf`): `hq.db`, `web.pid`, HQ server files. An existing `factory.db` is opened when `hq.db` is absent; it is never renamed.

Quickstart in any git repository (proved by `apps/sf/test/blackbox/standalone-external-repo.test.ts`):

```bash
cd path/to/repo
sf init                                   # .factory/ + .gitignore entries
sf hq start
sf hq token admin create --save           # .factory-local/operator.token
sf project add my-project --repo <url>
sf web start                              # http://127.0.0.1:4321
sf factory connect <hq-url> --token <factory_join>        # once per PC
sf cell scale 2 --repo ~/code/my-project                  # Cells start under the Factory daemon
sf todos import && sf queue
sf web stop && sf hq stop
```

Source of truth for server behaviour: [`hq.md`](./hq.md),
especially §3 (Cell lifecycle) and §11 (agent reporting). Operator CLI spec:
[`operator.md`](./operator.md).

## 1. Command tree

| Group | Command | Who runs it | Server endpoint |
| :---- | :------ | :---------- | :-------------- |
| init | `sf init` | Supervisor, in a repo | none (writes `.factory/`, `.gitignore`) |
| project | `sf project add <id> --repo <url>` | Supervisor | `POST /api/v1/projects` |
| project | `sf project ls` | Supervisor | `GET /api/v1/projects` |
| hq | `sf hq start` | Supervisor | none (spawns the embedded server) |
| hq | `sf hq stop` | Supervisor | none (signals the pid file) |
| hq | `sf hq token create --kind factory_join --name <n>` | Supervisor | `POST /api/v1/tokens` |
| hq | `sf hq token admin create [--save]` | Supervisor | none (admin path in server) |
| web | `sf web start \| stop \| status` | Supervisor | none (runs the installed web UI, pid in `web.pid`) |
| cell | `sf cell scale N [--repo <path>]` | Supervisor, on a Cell machine | Factory daemon `PUT /scale` (converges Cells to N) |
| cell | `sf cell start [--name <slug>]` | Factory daemon child only | `claims`, `heartbeats`, `jobs/{id}/transitions` through the relay |
| cell | `sf cell create\|stop\|rm` | removed | exit 2, `use "sf cell scale N"` |
| cell | `sf cell list` | Supervisor | Factory daemon `GET /scale` |
| todos | `sf todos import` | Supervisor | `POST /api/v1/queue/import` |
| todos | `sf todos export` | Supervisor | `GET /api/v1/queue/export` |
| queue | `sf queue` | Supervisor | `GET /api/v1/work-orders`, `GET /api/v1/order-plans` |
| queue | `sf queue pause \| unpause \| reprioritise \| reset \| cancel` | Supervisor | `POST /api/v1/queue/actions` |
| incident | `sf incident list` | Supervisor | `GET /api/v1/incidents` |
| incident | `sf incident resolve <id> --action ...` | Supervisor | `POST /api/v1/incidents/{id}/resolve` |
| order | `sf order show <id>` | Supervisor | `GET /api/v1/work-orders/{id}` |
| order | `sf order resume \| reopen \| cancel <id>` | Supervisor | `POST /api/v1/work-orders/{id}/transitions` |
| watch | `sf watch` | Supervisor | `GET /api/v1/stream` (SSE) |
| operator | `sf operator done \| verdict \| block \| context` | Agent in a station job | none (talks to its own Cell, §5) |
| operator | `sf operator read \| incident` | Agent in a Mechanic job | `incidents/{id}/resolve` through its Cell |

Open verbs (`answer`, `context` for the Operator, `tell`) follow the decisions in
[`hq.md` §11.6](./hq.md).

### Deprecated names

The old top-level names still work. Each prints one line to stderr and then behaves exactly as before (same stdout, same exit code):

| Old | New |
| :--- | :--- |
| `sf server start` | `sf hq start` |
| `sf server stop` | `sf hq stop` |
| `sf server token create` | `sf hq token admin create` |
| `sf connect <url>` | `sf hq connect <url>` |
| `sf target ls \| use \| rm` | `sf hq target ls \| use \| rm` |
| `sf token create` | `sf hq token create` |

Message: `deprecated: use "sf hq <sub>"`.

## HQ connection

`sf` reads the HQ address and the operator token from one resolver, in this order:

| Setting | Order (first set wins) | Old name (fallback) |
| :--- | :--- | :--- |
| URL | `HQ_URL`, then the active saved target, then `http://127.0.0.1:7070` | `FACTORY_URL` |
| Token | `HQ_TOKEN`, then `.factory-local/operator.token` (or, when that file is missing, the legacy `.factory-local/supervisor.token`), then the active saved target, then `~/.config/factory/token` | `FACTORY_TOKEN` |

Old names are read silently when the `HQ_*` name is unset. `HQ_*` wins when both are set. Token values are never printed.

HQ server settings are `HQ_PORT`, `HQ_HOST`, `HQ_DB_PATH` and `HQ_DATA_DIR`. Old `FACTORY_PORT`, `FACTORY_HOST`, `FACTORY_DB_PATH` and `FACTORY_DATA_DIR` still work as fallback, as do `FACTORY_URL` and `FACTORY_TOKEN` above. `FACTORY_JOIN_TOKEN` keeps its name. Old names stay until removed later.

## 2. Layout

The layout follows [`engineering.md`](./engineering.md):
`domain -> contracts -> application (ports + procedures) -> adapters -> bootstrap -> tests`.
Each command is a procedure. Adapters are the only code that does I/O.

```text
apps/sf/
├── README.md
├── src/
│   ├── cli.ts                      # entrypoint: citty root, registers adapters/cli groups
│   ├── config.ts                   # env and timing constants (HQ URL default, waitMs 25000, 10s heartbeat)
│   ├── domain/                     # pure, no I/O, no clock
│   │   ├── common/                 # brand.ts (CellId, JobId, OrderId, IncidentId), time.ts
│   │   ├── connection/             # HQ URL and token resolution (HQ_* with FACTORY_* fallback)
│   │   ├── repo-config/            # parse .factory/config.json (project, rules, skills)
│   │   ├── line/                   # parse .factory/lines/<name>.yml -> lineSnapshot
│   │   ├── operator/               # verb model: done, verdict, block, read, incident actions
│   │   └── exit-codes.ts           # 0 ok, 1 refused, 2 bad args, 3 unreachable
│   ├── contracts/                  # Zod schemas: one file per route group and per operator verb
│   │   ├── cells.contract.ts
│   │   ├── jobs.contract.ts
│   │   ├── queue.contract.ts
│   │   ├── incidents.contract.ts
│   │   ├── work-orders.contract.ts
│   │   ├── operator.contract.ts
│   │   └── common.ts
│   ├── application/
│   │   ├── core/                   # procedure factory: access ('operator' | 'cell' | 'job'), schema, handler
│   │   ├── ports/                  # server.port, clock.port, fs.port, git.port, runner.port,
│   │   │                           # process.port, operator-endpoint.port, token-store.port
│   │   └── procedures/
│   │       ├── server/             # start, stop, token-create
│   │       ├── cell/               # start, claim-loop, run-job, factory-cells
│   │       ├── todos/              # import, export
│   │       ├── queue/              # list, actions
│   │       ├── incidents/          # list, resolve
│   │       ├── work-orders/        # show, transition
│   │       ├── watch/              # SSE
│   │       └── operator/           # done, verdict, block, context, read, incident
│   ├── adapters/
│   │   ├── cli/                    # citty commands; each one maps args -> procedure input
│   │   │                           # hq.command.ts mounts the HQ group; legacy.command.ts holds the deprecated names
│   │   ├── http/                   # server client (operator token, cell token), retries via commandId
│   │   ├── fs/                     # .factory-local/cell.json (0600), pid file, .cell/ files
│   │   ├── git/                    # worktree, checkpoint commit, push
│   │   ├── process/                # spawn factory server, spawn runner
│   │   ├── runners/                # claude, codex, cursor, antigravity, opencode, copilot (one file each)
│   │   ├── operator-endpoint/      # loopback listener per job (Hono, like `apps/hq`)
│   │   └── memory/                 # clock, in-memory waiters for tests
│   └── bootstrap/
│       ├── context.ts              # builds the port set for operator or cell mode
│       ├── hq-env.ts               # reads HQ_* with the FACTORY_* fallback and its one-time warning
│       └── run.ts                  # runs one procedure with its context
└── test/
    ├── blackbox/                   # run commands against a fake server (app.request-style)
    ├── support/                    # fake server, fake runner, fake git, fake clock
    └── unit/                       # domain and contracts only
```

Rules carried over from `apps/hq`:

- `domain/` imports nothing from `application/`, `adapters/` or `bootstrap/`.
- `application/procedures/` imports ports, never adapters. An adapter is picked in `bootstrap/`.
- `contracts/` is the only place wire shapes are declared. The server, the CLI and the operator use
  the same files, or a shared package later (§7).
- The operator verbs have their own procedures. `sf operator` never reads `.factory/` or the
  operator token.
- No barrel files. Imports name the concrete file (`coding-no-barrel-export`).

## 3. How a Cell works under the hood

The Cell is the only process that talks to HQ. Agents never do.

1. **Identity.** The Factory daemon gives the Cell its id (`FACTORY_CELL_ID`, `cell-<8 hex>`) and a
   local bearer (`HQ_TOKEN`). There is no enroll and no session file. HQ never stores a Cell.
2. **Project and lines.** `sf cell start` reads `.factory/config.json` for `project` and
   `.factory/lines/` for `allowedLines` (filtered by `CELL_LINES`).
3. **Claim loop.** `POST {relay}/api/v1/cells/claims` with `{ waitMs: 25000, projectId,
   allowedLines, runners }`. The relay adds the Factory credential and `x-cell-id`. An empty reply
   means no work; loop again.
4. **Check the Line.** If `.factory/lines/<line>.yml` is missing or invalid, send
   `transitions { action: line_unavailable }`. The reply may carry the next Job.
5. **Check the worktree.** For `stepIndex > 0`, check `<repo>/.worktrees/<slug>/` and the prior
   `.cell/<step-id>/` files. If any are missing, send `worktree_missing` and start again from step 0.
6. **Start the Job.** Send `transitions { action: start, epoch, lineSnapshot }`. HQ
   materializes the steps.
7. **Run the station.** Open the per-job loopback endpoint (see §5), set `FACTORY_OPERATOR_URL` and
   `FACTORY_CYCLE_TOKEN`, start the runner (one of the six in §8), and write
   `.cell/<step-id>/state.json`.
8. **Heartbeat.** Every 10 s, `POST {relay}/api/v1/cells/heartbeats`. Read `signals` in the reply, such
   as `abort`. If 4 heartbeats in a row fail (45 s), abort the runner. The lease is 60 s.
9. **Finish the station.** The agent's `done`, `verdict`, or `block` (§5) reaches the Cell. The Cell
   checks local facts (required files, git state), then sends the matching transition. The reply
   carries `nextJob`, so the same Cell keeps going without another claim.
10. **Deliver.** The `deliver` station pushes `factory/<slug>` and publishes the PR. The Cell then
    removes the worktree and sends `complete` with the commit sha.
11. **Failure.** If a Cell crashes, its lease expires and the Work order returns to `queued`. The same
    Cell resumes its warm worktree on reconnect, or another Cell takes over at the same step.

### Stop

- Scale down kills the Cell process (SIGTERM, then SIGKILL) and only then tells HQ the
  Cell is gone. HQ requeues its Job at once, or when the lease expires if HQ is unreachable.
- There is no revoke. A stopped Cell leaves no row in HQ.

## 4. Operator endpoint

- The Cell opens `127.0.0.1` on an OS-assigned port when a Job starts, and closes it when the Job
  ends ([`hq.md`](./hq.md) §11.2).
- The token is random, per Job, held only in Cell memory.
- The Cell maps the token to `{ jobId, role, incidentId?, epoch }`, and refuses verbs the role
  cannot use.
- `sf operator ...` is the client. It reads `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`
  and never reads `.factory/` or the supervisor config. It runs in the agent's shell, so it gets no
  HQ credentials.

## 5. Supervisor side

- `sf hq start` runs the server embedded in the `sf` binary, and writes a pid file. The discovery
  address comes from `HQ_URL` (default `http://127.0.0.1:7070`).
- `sf hq stop` signals only the server process, through its pid file. It does not stop or revoke Cells. See §8, decision 4.
- The operator token (`sf_op_`; `sf_sup_` tokens minted before the rename still work) comes from `HQ_TOKEN`, `.factory-local/operator.token` (written by
  `sf hq token admin create --save`; a legacy `.factory-local/supervisor.token` is read when it is the only one and never moved) or `~/.config/factory/token`. It is never printed.
- Every command maps to one endpoint from §1. No command reads the database directly.
- Output is one human-readable table by default, and `--json` for scripts.

## 6. Exit codes

| Code | Meaning |
| :--- | :------ |
| `0` | Success |
| `1` | HQ refused (`400`, `401`, `403`, `409`, `500`) |
| `2` | Bad arguments, missing environment variable, or unreadable file. Nothing is sent |
| `3` | HQ or Cell unreachable |

## 7. Shared contracts

Request and reply shapes for HQ live in `@repo/hq-contracts` (`packages/hq-contracts`). `@repo/cell-contracts` went with `apps/cell`.

## 8. Decisions and open questions

Decided:

1. **Name.** `sf cell`. Not `call`.
2. **One binary, named `sf`.**
   The Cell daemon (`sf cell start`) lives in `apps/sf/src/application/procedures/cell/`, with helpers
   in `apps/sf/src/cell/`. The Factory daemon (`sf factory start|stop|status`) is one per PC, listens on
   `127.0.0.1:7072` (`SF_FACTORY_PORT`) and spawns, lists and kills Cell daemons. `sf cell scale|list`
   call it. `apps/cell` and `sf cell server` are removed.
3. **Coexistence.** The new approach is built alongside the current implementation, which stays until
   cut-over. The new one is cleaner, so nothing is migrated from the old code.
4. **`hq stop` does not stop Cells.** It stops only the HQ server process. Cells keep running and
   retry their requests with the same `commandId`. If HQ stays down past the self-fence window
   (45 s), a Cell aborts its runner, and its Job is lost once the lease ends ([`hq.md`](./hq.md) §3.7).
   `sf hq start` brings HQ back, and Cells resume.
5. **Cell token storage.** Not important for now. Keep the simplest option that works.
6. **Runners in v2.0.** All six ship: `claude`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`. They match
   the adapters in the legacy `registry.ts` runner registry.

Open:

1. **Operator verbs.** The verbs in [`operator.md`](./operator.md) §3 are the target. `answer`, `context`
   and `tell` stay open, as in [`hq.md` §11.6](./hq.md).

## 9. Not in this plan

- The Operator's runner integration (Herdr, panes, headless). That is part of the Cell's runner
  adapters, to be planned separately.
- Web UI internals. `sf web start` only runs the installed build; the SSE stream (`sf watch`) is the CLI live view.
- `sf factory ...` (the local Factory daemon commands). Planned separately.
