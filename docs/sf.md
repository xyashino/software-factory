# `sf` CLI

One binary: `sf`. It is the only CLI (the old `factory` CLI, `apps/cli`, was removed) and serves the Supervisor (you),
the Cell daemon (each machine that runs work), and the Operator and Mechanic verbs (agents inside a job).

Names used here follow the [glossary](./README.md#glossary): **HQ** is the external server, **Factory** is the local daemon, **Cell** is the worker.

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
sf hq token admin create --save           # .factory-local/supervisor.token
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

| Group    | Command                                                        | Who runs it                   | Server endpoint                                                             |
| :------- | :------------------------------------------------------------- | :---------------------------- | :-------------------------------------------------------------------------- |
| init     | `sf init`                                                      | Supervisor, in a repo         | none (writes `.factory/`, `.gitignore`)                                     |
| project  | `sf project add <id> --repo <url>`                             | Supervisor                    | `POST /api/v1/projects`                                                     |
| project  | `sf project ls`                                                | Supervisor                    | `GET /api/v1/projects`                                                      |
| hq       | `sf hq start`                                                  | Supervisor                    | none (spawns the embedded HQ server)                                        |
| hq       | `sf hq stop`                                                   | Supervisor                    | none (signals the pid file)                                                 |
| hq       | `sf hq token admin create [--save] [--global]`                 | Supervisor                    | none (admin path in HQ)                                                     |
| hq       | `sf hq token create --kind factory_join --name <n>`            | Supervisor                    | `POST /api/v1/tokens`                                                       |
| factory  | `sf factory connect <url> --token <join\|->`                   | Supervisor, once per PC       | `POST /api/v1/factories/enroll`                                             |
| factory  | `sf factory start \| stop \| status`                           | Supervisor, on a Cell machine | Factory daemon `127.0.0.1:7072`                                             |
| web      | `sf web start \| stop \| status`                               | Supervisor                    | none (runs the installed web UI, pid in `web.pid`)                          |
| cell     | `sf cell scale N [--repo <path>] [--lines <names>]`            | Supervisor, on a Cell machine | Factory daemon `PUT /scale` (converges Cells to N)                          |
| cell     | `sf cell start [--name <slug>]`                                | Factory daemon child only     | `claims`, `heartbeats`, `jobs/{id}/transitions` through the relay           |
| cell     | `sf cell list`                                                 | Supervisor                    | Factory daemon `GET /scale` (local only)                                    |
| cell     | `sf cell create\|stop\|rm`                                     | removed                       | exit 2, `use "sf cell scale N"`                                             |
| todos    | `sf todos import`                                              | Supervisor                    | `POST /api/v1/queue/import`                                                 |
| todos    | `sf todos export`                                              | Supervisor                    | `GET /api/v1/queue/export`                                                  |
| queue    | `sf queue`                                                     | Supervisor                    | `GET /api/v1/work-orders`, `GET /api/v1/order-plans`                        |
| queue    | `sf queue pause \| unpause \| reprioritise \| reset \| cancel` | Supervisor                    | `POST /api/v1/queue/actions`                                                |
| plan     | `sf plan list`                                                 | Supervisor                    | `GET /api/v1/order-plans`                                                   |
| plan     | `sf plan show <slug>`                                          | Supervisor                    | `GET /api/v1/order-plans`                                                   |
| plan     | `sf plan activate \| retry <slug>`                             | Supervisor                    | `GET /api/v1/order-plans`, then `POST /api/v1/order-plans/{id}/transitions` |
| plan     | `sf plan reset <slug> --yes`                                   | Supervisor                    | `GET /api/v1/order-plans`, then `POST /api/v1/order-plans/{id}/transitions` |
| incident | `sf incident list`                                             | Supervisor                    | `GET /api/v1/incidents`                                                     |
| incident | `sf incident resolve <id> --action ...`                        | Supervisor                    | `POST /api/v1/incidents/{id}/resolve`                                       |
| order    | `sf order show <id>`                                           | Supervisor                    | `GET /api/v1/work-orders/{id}`                                              |
| order    | `sf order resume \| reopen \| cancel <id>`                     | Supervisor                    | `POST /api/v1/work-orders/{id}/transitions`                                 |
| order    | `sf order test [--line <name>] [--slug <slug>]`                | Supervisor                    | `POST /api/v1/work-orders` (smoke-test chore, no `todos/` file)             |
| watch    | `sf watch`                                                     | Supervisor                    | `GET /api/v1/stream` (SSE)                                                  |
| operator | `sf operator done \| verdict \| block \| context`              | Agent in a station job        | none (talks to its own Cell, §5)                                            |
| operator | `sf operator read \| incident`                                 | Agent in a Mechanic job       | `incidents/{id}/resolve` through its Cell                                   |

Open verbs (`answer`, `context` for the Operator, `tell`) follow the decisions in
[`hq.md` §11.6](./hq.md).

### Deprecated names

The old top-level names still work. Each prints one line to stderr and then behaves exactly as before (same stdout, same exit code):

| Old                         | New                            |
| :-------------------------- | :----------------------------- |
| `sf server start`           | `sf hq start`                  |
| `sf server stop`            | `sf hq stop`                   |
| `sf server token create`    | `sf hq token admin create`     |
| `sf connect <url>`          | `sf hq connect <url>`          |
| `sf target ls \| use \| rm` | `sf hq target ls \| use \| rm` |
| `sf token create`           | `sf hq token create`           |

Message: `deprecated: use "sf hq <sub>"`.

## HQ connection

`sf` reads the HQ address and the supervisor token from one resolver, in this order:

| Setting | Order (first set wins)                                                                                           | Old name (fallback) |
| :------ | :--------------------------------------------------------------------------------------------------------------- | :------------------ |
| URL     | `HQ_URL`, then the active saved target, then `http://127.0.0.1:7070`                                             | `FACTORY_URL`       |
| Token   | `HQ_TOKEN`, then `.factory-local/supervisor.token`, then the active saved target, then `~/.config/factory/token` | `FACTORY_TOKEN`     |

Old names are read silently when the `HQ_*` name is unset. `HQ_*` wins when both are set. Token values are never printed.

HQ server settings are `HQ_PORT`, `HQ_HOST`, `HQ_DB_PATH` and `HQ_DATA_DIR`. Old `FACTORY_PORT`, `FACTORY_HOST`, `FACTORY_DB_PATH` and `FACTORY_DATA_DIR` still work as fallback, as do `FACTORY_URL` and `FACTORY_TOKEN` above. `FACTORY_JOIN_TOKEN` keeps its name. Old names stay until removed later.

## 2. Layout

The layout follows [`engineering.md`](./engineering.md):
`domain -> contracts -> application (ports + procedures) -> adapters -> bootstrap -> tests`.
Each command is a procedure. Adapters are the only code that does I/O.

```text
apps/sf/
├── src/
│   ├── cli.ts                      # entrypoint: citty root, registers adapters/cli groups
│   ├── config.ts                   # paths, ports, env names, timing (25 s claim wait, 10 s heartbeat, 45 s self-fence)
│   ├── domain/                     # pure, no I/O: access, cell, common, connection, factory, git,
│   │                               # init, line, repo-config, service, todo, exit-codes
│   ├── contracts/                  # operator.contract.ts (HQ contracts: @repo/hq-contracts)
│   ├── application/
│   │   ├── core/                   # procedure factory: access ('supervisor' | 'cell' | 'job'), schema, handler
│   │   ├── ports/                  # hq, hq-link, factory, factory-credential, git, pr,
│   │   │                           # process, runner, operator-endpoint, fs, clock, ...
│   │   └── procedures/             # one folder per command group: cell, connection, doctor, factory,
│   │                               # hq, incidents, init, operator, plans, projects, queue, setup,
│   │                               # todos, tokens, watch, web, work-orders
│   ├── adapters/
│   │   ├── cli/                    # citty commands; hq.command.ts mounts HQ, legacy.command.ts holds deprecated names
│   │   ├── http/                   # HQ client, HQ link client, Factory daemon client, SSE client
│   │   ├── fs/                     # Factory credential (0600), connection store, pid files, .cell/ files
│   │   ├── git/                    # git.ts (worktree, commit, reset, push), gh.ts (PR publish)
│   │   ├── process/                # spawn HQ, Factory daemon, runners
│   │   ├── runners/                # claude, codex, cursor, antigravity, opencode, copilot; herdr panes
│   │   ├── operator-endpoint/      # loopback listener per job
│   │   └── operator-client/        # `sf operator` client
│   ├── factory/                    # Factory daemon: supervisor, scaler, relay, hq-link, routes
│   ├── cell/                       # Cell helpers (heartbeat)
│   └── bootstrap/                  # context.ts (port set), hq-env.ts (HQ_* with FACTORY_* fallback),
│                                   # run.ts, entry-dispatch.ts (HQ or Factory daemon entry)
└── test/                           # blackbox/, support/, unit/
```

Rules carried over from `apps/hq`:

- `domain/` imports nothing from `application/`, `adapters/` or `bootstrap/`.
- `application/procedures/` imports ports, never adapters. An adapter is picked in `bootstrap/`.
- Wire shapes live in contracts only: `@repo/hq-contracts` for HQ, `src/contracts/` for the
  operator endpoint (§7).
- The operator verbs have their own procedures. `sf operator` never reads `.factory/` or the
  supervisor token.
- No barrel files. Imports name the concrete file (`coding-no-barrel-export`).

## 3. How a Cell works under the hood

Only the Factory daemon talks to HQ. The Cell talks to the Factory relay. Agents talk to their Cell.

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
   `.cell/<step-id>/` files. Complete: hard reset to the order `headCommitSha`, clean, resume.
   Worktree or files missing: send `worktree_missing` and start again from step 0.
6. **Start the Job.** Send `transitions { action: start, epoch, lineSnapshot }`. HQ
   materializes the steps.
7. **Run the station.** Open the per-job loopback endpoint (see §5), set `FACTORY_OPERATOR_URL` and
   `FACTORY_CYCLE_TOKEN`, start the runner (one of the six in §8), and write
   `.cell/<step-id>/state.json`.
8. **Heartbeat.** Every 10 s, `POST {relay}/api/v1/cells/heartbeats`. Read `signals` in the reply, such
   as `abort`. If 4 heartbeats in a row fail (about 40 s), abort the runner. The lease is 60 s.
9. **Finish the station.** The agent's `done`, `verdict`, or `block` (§5) reaches the Cell. The Cell
   checks local facts (required files, git state), then sends the matching transition. The reply
   carries `nextJob`, so the same Cell keeps going without another claim.
10. **Deliver.** The `deliver` station pushes `factory/<slug>` and publishes the PR. The Cell then
    removes the worktree and sends `complete` with the commit sha.
11. **Failure.** If a Cell crashes, the Factory reports it gone (or the lease expires) and the Work
    order returns to `queued`, pinned to that Factory. A new Cell on the same PC resumes the worktree
    at the same step. Only the builder station commits; other stations write only `.cell/` files.

### Stop

- Scale down kills the Cell process (SIGTERM, then SIGKILL) and only then tells HQ the
  Cell is gone. HQ requeues its Job at once, or when the lease expires if HQ is unreachable.
- There is no revoke. A stopped Cell leaves no row in HQ.

### Production lines

Line definitions (`.factory/lines/<line>.yml`) define the stations, operators, and delivery rules for work orders. Tasks specify their line in work order frontmatter (`line: <name>` in `todos/*.md`). Cells claim jobs matching their available runners and allowed lines (`sf cell scale N --lines <names>` or `CELL_LINES`).

| Line       | Runner / Model                                                | Stations                                                                            | Description                                                                                                                                                                |
| :--------- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gemini`   | `antigravity` (`gemini-3.8-flash-medium`)                     | `build` → `quality-gate` → `deliver` (mechanic: `antigravity`)                      | Production line running with the Gemini runner (`antigravity`). Direct builder with quality gate inspection and delivery. Requires `antigravity` CLI available in `$PATH`. |
| `fast`     | `claude` (`haiku`)                                            | `build` → `quality-gate` → `deliver` (mechanic: `antigravity`)                      | Fast direct builder build with quality gate and direct delivery (for chores, docs, style).                                                                                 |
| `feature`  | `claude` (`sonnet`)                                           | `plan` → `build` → `quality-gate` → `audit` → `deliver` (mechanic: `claude`)        | Full feature line: upfront plan, build, quality-gate, audit, and delivery.                                                                                                 |
| `standard` | `claude` (`haiku`), `antigravity` (`gemini-3.8-flash-medium`) | `build` → `quality-gate` → `audit` (`doctor`) → `deliver` (mechanic: `antigravity`) | Direct builder build with quality gate and doctor audit (bypasses planning).                                                                                               |

To run tasks on the `gemini` line:

1. Ensure the Gemini runner (`antigravity`) is installed on the worker host.
2. Set `line: gemini` in the task work order (`todos/<name>.md`).
3. Scale Cells for the project: `sf cell scale 1 --lines gemini` (or allow all lines by omitting `--lines`).

## 4. Operator endpoint

- The Cell opens `127.0.0.1` on an OS-assigned port when a Job starts, and closes it when the Job
  ends ([`hq.md` §11.2](./hq.md)).
- The token is random, per Job, held only in Cell memory.
- The Cell maps the token to `{ jobId, role, incidentId?, epoch }`, and refuses verbs the role
  cannot use.
- `sf operator ...` is the client. It reads `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`
  and never reads `.factory/` or the supervisor config. It runs in the agent's shell, so it gets no
  HQ credentials.

## 5. Supervisor side

- `sf hq start` runs HQ embedded in the `sf` binary, and writes a pid file. Address and token: see
  [HQ connection](#hq-connection).
- `sf hq stop` signals only the HQ process, through its pid file. It does not stop Cells. See §8, decision 4.
- The supervisor token (`sf_sup_`) is written by `sf hq token admin create --save`. It is never printed.
- Every command maps to one endpoint from §1. No command reads the database directly.
- Output is one human-readable table by default, and `--json` for scripts.

## 6. Exit codes

| Code | Meaning                                                                          |
| :--- | :------------------------------------------------------------------------------- |
| `0`  | Success                                                                          |
| `1`  | HQ refused (`400`, `401`, `403`, `409`, `500`)                                   |
| `2`  | Bad arguments, missing environment variable, or unreadable file. Nothing is sent |
| `3`  | HQ or Cell unreachable                                                           |

## 7. Shared contracts

HQ, the CLI, the Factory daemon and the web UI parse the same HQ request and reply shapes from
`@repo/hq-contracts` (`packages/hq-contracts`). The operator endpoint contract is local to
`apps/sf/src/contracts/operator.contract.ts`.

## 8. Decisions and open questions

Decided:

1. **Name.** `sf cell`. Not `call`.
2. **One binary, named `sf`.**
   The Cell daemon (`sf cell start`) lives in `apps/sf/src/application/procedures/cell/`, with helpers
   in `apps/sf/src/cell/`. The Factory daemon (`sf factory start|stop|status`) is one per PC, listens on
   `127.0.0.1:7072` (`SF_FACTORY_PORT`) and spawns and kills Cell daemons. `sf cell scale|list`
   call it.
3. **`hq stop` does not stop Cells.** It stops only the HQ process. If HQ stays down past the
   self-fence window (45 s), the Factory kills its Cells, and their Jobs are requeued when HQ reaps
   the leases ([`hq.md` §3.7](./hq.md)). `sf hq start` brings HQ back; `sf cell scale N`
   starts Cells again.
4. **No Cell token.** Cells hold only a local bearer from their Factory. The Factory credential is
   the only HQ credential on a PC (`$XDG_CONFIG_HOME/sf/factory.json`, `0600`).
5. **Runners.** Six ship: `claude`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`. The `antigravity` runner drives the `gemini` line and the doctor station in `standard`.

Open:

1. **Operator verbs.** The verbs in [`operator.md`](./operator.md) §3 are the target. `answer`, `context`
   and `tell` stay open, as in [`hq.md` §11.6](./hq.md).

## 9. Not in this plan

- The Operator's runner integration (Herdr, panes, headless). That is part of the Cell's runner
  adapters, to be planned separately.
- Web UI internals. `sf web start` only runs the installed build; the SSE stream (`sf watch`) is the CLI live view.
- Factory daemon internals: [cell.md](./cell.md#factory-daemon).
