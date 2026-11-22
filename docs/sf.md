# `sf` CLI — plan

One binary: `sf`. It is the only CLI (the old `factory` CLI, `apps/cli`, was removed) and serves the Supervisor (you),
the Cell daemon (each machine that runs work), and the Operator and Mechanic verbs (agents inside a job).

## 0. Install and quickstart

`bun run build:sf` compiles `apps/sf/dist/sf` (server, init templates and SQL migrations embedded) and
builds the web UI. `scripts/install.sh` copies them under `$PREFIX` (default `/usr/local`):

```bash
bun install && bun run build:sf
sudo scripts/install.sh               # bin/sf + share/sf/web
PREFIX=$HOME/.local scripts/install.sh   # no sudo; then SF_WEB_DIR=$HOME/.local/share/sf/web
```

`sf web start` finds the web UI in `$SF_WEB_DIR`, then `/usr/local/share/sf/web`, then `/usr/share/sf/web`.
State lives in `$XDG_DATA_HOME/sf` (default `~/.local/share/sf`): `factory.db`, `web.pid`, server files.

Quickstart in any git repository (proved by `apps/sf/test/blackbox/standalone-external-repo.test.ts`):

```bash
cd path/to/repo
sf init                                   # .factory/ + .gitignore entries
sf server start
sf server token create --save             # .factory-local/supervisor.token
sf project add my-project --repo <url>
sf web start                              # http://127.0.0.1:4321
sf token create --kind cell_join --name worker-1
FACTORY_JOIN_TOKEN=<token> sf cell start --name worker-1
sf todos import && sf queue
sf web stop && sf server stop
```

Source of truth for server behaviour: [`factory.md`](./factory.md),
especially §3 (Cell lifecycle) and §11 (agent reporting). Operator CLI spec:
[`operator.md`](./operator.md).

## 1. Command tree

| Group | Command | Who runs it | Server endpoint |
| :---- | :------ | :---------- | :-------------- |
| init | `sf init` | Supervisor, in a repo | none (writes `.factory/`, `.gitignore`) |
| project | `sf project add <id> --repo <url>` | Supervisor | `POST /api/v1/projects` |
| project | `sf project ls` | Supervisor | `GET /api/v1/projects` |
| token | `sf token create --kind cell_join --name <n>` | Supervisor | `POST /api/v1/tokens` |
| server | `sf server start` | Supervisor | none (spawns the embedded server) |
| server | `sf server stop` | Supervisor | none (signals the pid file) |
| server | `sf server token create [--save]` | Supervisor | none (admin path in server) |
| web | `sf web start \| stop \| status` | Supervisor | none (runs the installed web UI, pid in `web.pid`) |
| cell | `sf cell start [--name <slug>]` | Supervisor, on a Cell machine | `enroll` once, then `hello`, `claims`, `heartbeats`, `jobs/{id}/transitions` |
| cell | `sf cell list` | Supervisor | `GET /api/v1/cells` |
| cell | `sf cell scale N` | Supervisor, inside a repo | daemon `PUT /scale` |
| cell | `sf cell revoke --id <id>` | Supervisor | `DELETE /api/v1/cells/{id}` |
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
[`factory.md` §11.6](./factory.md).

## 2. Layout

The layout follows [`engineering.md`](./engineering.md):
`domain -> contracts -> application (ports + procedures) -> adapters -> bootstrap -> tests`.
Each command is a procedure. Adapters are the only code that does I/O.

```text
apps/sf/
├── README.md
├── src/
│   ├── cli.ts                      # entrypoint: citty root, registers adapters/cli groups
│   ├── config.ts                   # env and timing constants (FACTORY_URL, waitMs 25000, 10s heartbeat)
│   ├── domain/                     # pure, no I/O, no clock
│   │   ├── common/                 # brand.ts (CellId, JobId, OrderId, IncidentId), time.ts
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
│   │   ├── core/                   # procedure factory: access ('supervisor' | 'cell' | 'job'), schema, handler
│   │   ├── ports/                  # server.port, clock.port, fs.port, git.port, runner.port,
│   │   │                           # process.port, operator-endpoint.port, token-store.port
│   │   └── procedures/
│   │       ├── server/             # start, stop, token-create
│   │       ├── cell/               # enroll, hello, claim-loop, run-job, drain, revoke, list
│   │       ├── todos/              # import, export
│   │       ├── queue/              # list, actions
│   │       ├── incidents/          # list, resolve
│   │       ├── work-orders/        # show, transition
│   │       ├── watch/              # SSE
│   │       └── operator/           # done, verdict, block, context, read, incident
│   ├── adapters/
│   │   ├── cli/                    # citty commands; each one maps args -> procedure input
│   │   ├── http/                   # server client (supervisor token, cell token), retries via commandId
│   │   ├── fs/                     # .factory-local/cell.json (0600), pid file, .cell/ files
│   │   ├── git/                    # worktree, checkpoint commit, push
│   │   ├── process/                # spawn factory server, spawn runner
│   │   ├── runners/                # claude, codex, cursor, antigravity, opencode (one file each)
│   │   ├── operator-endpoint/      # loopback listener per job (Hono, like `apps/factory`)
│   │   └── memory/                 # clock, in-memory waiters for tests
│   └── bootstrap/
│       ├── context.ts              # builds the port set for supervisor, cell, or operator mode
│       └── run.ts                  # runs one procedure with its context
└── test/
    ├── blackbox/                   # run commands against a fake server (app.request-style)
    ├── support/                    # fake server, fake runner, fake git, fake clock
    └── unit/                       # domain and contracts only
```

Rules carried over from `apps/factory`:

- `domain/` imports nothing from `application/`, `adapters/` or `bootstrap/`.
- `application/procedures/` imports ports, never adapters. An adapter is picked in `bootstrap/`.
- `contracts/` is the only place wire shapes are declared. The server, the CLI and the operator use
  the same files, or a shared package later (§7).
- The operator verbs have their own procedures. `sf operator` never reads `.factory/` or the
  supervisor token.
- No barrel files. Imports name the concrete file (`coding-no-barrel-export`).

## 3. How a Cell works under the hood

The Cell is the only process that talks to the server. Agents never do.

1. **Enroll (once).** `sf cell start` reads `.factory/config.json` for `project` and
   `FACTORY_JOIN_TOKEN` (`sf_join_`). It calls `POST /api/v1/cells/enroll` and stores the returned
   `sf_cell_` token in `.factory-local/cell.json` (mode `0600`). The join token is not used again.
2. **Hello.** `POST /api/v1/cells/hello` with `projectId`, `allowedLines` (from the local
   `.factory/lines/`), `runners`, and `localWorktrees`. If a Job is still held, the reply carries
   `resumedJob`.
3. **Claim loop.** `POST /api/v1/cells/claims` with `waitMs: 25000`. An empty reply means no work;
   loop again.
4. **Check the Line.** If `.factory/lines/<line>.yml` is missing or invalid, send
   `transitions { action: line_unavailable }`. The reply may carry the next Job.
5. **Check the worktree.** For `stepIndex > 0`, check `<repo>/.worktrees/<slug>/` and the prior
   `.cell/<step-id>/` files. If any are missing, send `worktree_missing` and start again from step 0.
6. **Start the Job.** Send `transitions { action: start, epoch, lineSnapshot }`. The server
   materializes the steps.
7. **Run the station.** Open the per-job loopback endpoint (see §5), set `FACTORY_OPERATOR_URL` and
   `FACTORY_CYCLE_TOKEN`, start the runner (one of the five in §8), and write
   `.cell/<step-id>/state.json`.
8. **Heartbeat.** Every 10 s, `POST /api/v1/cells/heartbeats`. Read `signals` in the reply, such as
   `abort`. If 4 heartbeats in a row fail (45 s), abort the runner. The lease is 60 s.
9. **Finish the station.** The agent's `done`, `verdict`, or `block` (§5) reaches the Cell. The Cell
   checks local facts (required files, git state), then sends the matching transition. The reply
   carries `nextJob`, so the same Cell keeps going without another claim.
10. **Deliver.** The `deliver` station pushes `factory/<slug>` and publishes the PR. The Cell then
    removes the worktree and sends `complete` with the commit sha.
11. **Failure.** If a Cell crashes, its lease expires and the Work order returns to `queued`. The same
    Cell resumes its warm worktree on reconnect, or another Cell takes over at the same step.

### Stop and revoke

- `sf cell stop --id` **drains**. The Cell takes no new claims. It finishes or hands over its
  current Job, then exits.
- `sf cell revoke --id` calls `DELETE`. The server unpins the Cell's orders and releases its Job.
  Use it only for a Cell you will not bring back.

Gap: the server has no drain or leave endpoint. Until one exists, `stop` can only finish the current
Job or let the lease expire. See §8.

## 4. Operator endpoint

- The Cell opens `127.0.0.1` on an OS-assigned port when a Job starts, and closes it when the Job
  ends (`apps/factory` PLAN §11.2).
- The token is random, per Job, held only in Cell memory.
- The Cell maps the token to `{ jobId, role, incidentId?, epoch }`, and refuses verbs the role
  cannot use.
- `sf operator ...` is the client. It reads `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`
  and never reads `.factory/` or the supervisor config. It runs in the agent's shell, so it gets no
  factory credentials.

## 5. Supervisor side

- `sf server start` runs the server embedded in the `sf` binary, and writes a pid file. The discovery
  address comes from `FACTORY_URL` (default `http://127.0.0.1:7070`).
- `sf server stop` signals only the server process, through its pid file. It does not stop, drain
  or revoke Cells. See §8, decision 4.
- The supervisor token (`sf_sup_`) comes from `FACTORY_TOKEN`, `.factory-local/supervisor.token` (written by
  `sf server token create --save`) or `~/.config/factory/token`. It is never printed.
- Every command maps to one endpoint from §1. No command reads the database directly.
- Output is one human-readable table by default, and `--json` for scripts.

## 6. Exit codes

| Code | Meaning |
| :--- | :------ |
| `0` | Success |
| `1` | Server refused (`400`, `401`, `403`, `409`, `500`) |
| `2` | Bad arguments, missing environment variable, or unreadable file. Nothing is sent |
| `3` | Server or Cell unreachable |

## 7. Shared contracts

The server, the CLI, the Cell and the operator all parse the same request and reply shapes. During
implementation, each app keeps its own copy of the schemas. A later step moves them into one shared
package. Names and scope are in [`plans/contracts-plan.md`](./plans/contracts-plan.md): `@repo/factory-contracts`. `@repo/cell-contracts` went with `apps/cell`. No naming rule forbids the `factory-` prefix. The server's [`engineering.md`](./engineering.md) would need an explicit exception when that happens.

## 8. Decisions and open questions

Decided:

1. **Name.** `sf cell`. Not `call`.
2. **One binary, named `sf`.**
   The Cell daemon (`sf cell start`) lives in `apps/sf/src/application/procedures/cell/`, with helpers
   in `apps/sf/src/cell/`. The Factory daemon (`sf factory start|stop|status`) is one per PC, listens on
   `127.0.0.1:7072` (`SF_FACTORY_PORT`) and runs the Cell count per project. `sf cell scale|list` call it.
   `apps/cell` and `sf cell server` are removed.
3. **Coexistence.** The new approach is built alongside the current implementation, which stays until
   cut-over. The new one is cleaner, so nothing is migrated from the old code.
4. **`server stop` does not stop Cells.** It stops only the server process. Cells keep running and
   retry their requests with the same `commandId`. If the server stays down past the self-fence window
   (45 s), a Cell aborts its runner, and its Job is lost once the lease ends (`apps/factory` PLAN §3.7).
   `sf server start` brings the server back, and Cells resume.
5. **Cell token storage.** Not important for now. Keep the simplest option that works.
6. **Runners in v2.0.** All five ship: `claude`, `codex`, `cursor`, `antigravity`, `opencode`. They match
   the adapters in the legacy `registry.ts` runner registry.

Open:

1. **Drain.** The server needs a `leave` or `drain` endpoint, so `cell stop` can hand over a Job
   cleanly instead of waiting for the lease to expire.
2. **Operator verbs.** The verbs in [`operator.md`](./operator.md) §3 are the target. `answer`, `context`
   and `tell` stay open, as in [`factory.md` §11.6](./factory.md).

## 9. Not in this plan

- The Operator's runner integration (Herdr, panes, headless). That is part of the Cell's runner
  adapters, to be planned separately.
- Web UI internals. `sf web start` only runs the installed build; the SSE stream (`sf watch`) is the CLI live view.
