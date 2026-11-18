# `factory` CLI — plan

One binary. Its name is `factory-2` while the new flow runs alongside the current `factory`
(`apps/cli`). Commands below are written as `factory <command>`; read them as `factory-2 <command>`
until cut-over (not planned yet; the Supervisor checks the flow manually first). It serves the Supervisor (you), the Cell daemon (each machine that runs
work), and the Operator and Mechanic verbs (agents inside a job).

Source of truth for server behaviour: [`apps/factory-server/docs/PLAN.md`](../../factory-server/docs/PLAN.md),
especially §3 (Cell lifecycle) and §11 (agent reporting). Operator CLI spec:
[`apps/operator/docs/PLAN.md`](../../operator/docs/PLAN.md).

## 1. Command tree

| Group | Command | Who runs it | Server endpoint |
| :---- | :------ | :---------- | :-------------- |
| server | `factory server start` | Supervisor | none (spawns `apps/factory-server`) |
| server | `factory server stop` | Supervisor | none (signals the pid file) |
| server | `factory server token create` | Supervisor | none (admin path in server) |
| cell | `factory cell start` | Supervisor, on a Cell machine | `enroll` once, then `hello`, `claims`, `heartbeats`, `jobs/{id}/transitions` |
| cell | `factory cell list` | Supervisor | `GET /api/v1/cells` |
| cell | `factory cell stop --id <id>` | Supervisor | drain (§3) |
| cell | `factory cell revoke --id <id>` | Supervisor | `DELETE /api/v1/cells/{id}` |
| todos | `factory todos import` | Supervisor | `POST /api/v1/queue/import` |
| todos | `factory todos export` | Supervisor | `GET /api/v1/queue/export` |
| queue | `factory queue` | Supervisor | `GET /api/v1/work-orders`, `GET /api/v1/order-plans` |
| queue | `factory queue pause \| unpause \| reprioritise \| reset \| cancel` | Supervisor | `POST /api/v1/queue/actions` |
| incident | `factory incident list` | Supervisor | `GET /api/v1/incidents` |
| incident | `factory incident resolve <id> --action ...` | Supervisor | `POST /api/v1/incidents/{id}/resolve` |
| order | `factory order show <id>` | Supervisor | `GET /api/v1/work-orders/{id}` |
| order | `factory order resume \| reopen \| cancel <id>` | Supervisor | `POST /api/v1/work-orders/{id}/transitions` |
| watch | `factory watch` | Supervisor | `GET /api/v1/stream` (SSE) |
| operator | `factory operator done \| verdict \| block \| context` | Agent in a station job | none (talks to its own Cell, §5) |
| operator | `factory operator read \| incident` | Agent in a Mechanic job | `incidents/{id}/resolve` through its Cell |

Open verbs (`answer`, `context` for the Operator, `tell`) follow the decisions in
[`apps/factory-server/docs/PLAN.md` §11.6](../../factory-server/docs/PLAN.md).

## 2. Layout

The layout follows `.tmp/omino-api` and `apps/factory-server/docs/BE_RULES.md`:
`domain -> contracts -> application (ports + procedures) -> adapters -> bootstrap -> tests`.
Each command is a procedure. Adapters are the only code that does I/O.

```text
apps/factory/
├── docs/PLAN.md
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
│   │   ├── process/                # spawn factory-server, spawn runner
│   │   ├── runners/                # claude, codex, cursor, antigravity, opencode (one file each)
│   │   ├── operator-endpoint/      # loopback listener per job (Hono, like factory-server)
│   │   └── memory/                 # clock, in-memory waiters for tests
│   └── bootstrap/
│       ├── context.ts              # builds the port set for supervisor, cell, or operator mode
│       └── run.ts                  # runs one procedure with its context
└── test/
    ├── blackbox/                   # run commands against a fake server (app.request-style)
    ├── support/                    # fake server, fake runner, fake git, fake clock
    └── unit/                       # domain and contracts only
```

Rules carried over from factory-server:

- `domain/` imports nothing from `application/`, `adapters/` or `bootstrap/`.
- `application/procedures/` imports ports, never adapters. An adapter is picked in `bootstrap/`.
- `contracts/` is the only place wire shapes are declared. The server, the CLI and the operator use
  the same files, or a shared package later (§7).
- The operator verbs have their own procedures. `factory operator` never reads `.factory/` or the
  supervisor token.
- No barrel files. `.tmp/omino-api` has `index.ts` re-exports; this repo's rules forbid them, so
  imports name the concrete file.

## 3. How a Cell works under the hood

The Cell is the only process that talks to the server. Agents never do.

1. **Enroll (once).** `factory cell start` reads `.factory/config.json` for `project` and
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

- `factory cell stop --id` **drains**. The Cell takes no new claims. It finishes or hands over its
  current Job, then exits.
- `factory cell revoke --id` calls `DELETE`. The server unpins the Cell's orders and releases its Job.
  Use it only for a Cell you will not bring back.

Gap: the server has no drain or leave endpoint. Until one exists, `stop` can only finish the current
Job or let the lease expire. See §8.

## 4. Operator endpoint

- The Cell opens `127.0.0.1` on an OS-assigned port when a Job starts, and closes it when the Job
  ends (factory-server §11.2).
- The token is random, per Job, held only in Cell memory.
- The Cell maps the token to `{ jobId, role, incidentId?, epoch }`, and refuses verbs the role
  cannot use.
- `factory operator ...` is the client. It reads `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`
  and never reads `.factory/` or the supervisor config. It runs in the agent's shell, so it gets no
  factory credentials.

## 5. Supervisor side

- `factory server start` finds the server binary, starts it, and writes a pid file. The discovery
  address comes from `FACTORY_URL` (default `http://127.0.0.1:7070`).
- `factory server stop` signals only the server process, through its pid file. It does not stop, drain
  or revoke Cells. See §8, decision 4.
- The supervisor token (`sf_sup_`) comes from `FACTORY_TOKEN` or `~/.config/factory/token`. It is
  never printed.
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
package (name not yet chosen, and it must not start with `factory-`, because the operator boundary
rule forbids that prefix). The server's BE_RULES need an explicit exception when that happens.

## 8. Decisions and open questions

Decided:

1. **Name.** `factory cell`. Not `call`.
2. **One binary, named `factory-2`.** Cut-over (rename to `factory`) is not planned yet.
   The Cell daemon lives in `apps/factory/src/cell`. `apps/cell` is not used by the new
   approach. This reverses the earlier plan to keep it separate.
3. **Coexistence.** The new approach is built alongside the current implementation, which stays until
   cut-over. The new one is cleaner, so nothing is migrated from the old code.
4. **`server stop` does not stop Cells.** It stops only the server process. Cells keep running and
   retry their requests with the same `commandId`. If the server stays down past the self-fence window
   (45 s), a Cell aborts its runner, and its Job is lost once the lease ends (factory-server §3.7).
   `factory server start` brings the server back, and Cells resume.
5. **Cell token storage.** Not important for now. Keep the simplest option that works.
6. **Runners in v2.0.** All five ship: `claude`, `codex`, `cursor`, `antigravity`, `opencode`. They match
   the adapters in `apps/cell/src/adapters/runners/registry.ts`.

Open:

1. **Drain.** The server needs a `leave` or `drain` endpoint, so `cell stop` can hand over a Job
   cleanly instead of waiting for the lease to expire.
2. **Operator verbs.** The verbs in `apps/operator/docs/PLAN.md` §3 are the target. `answer`, `context`
   and `tell` stay open, as in factory-server §11.6.

## 9. Not in this plan

- The Operator's runner integration (Herdr, panes, headless). That is part of the Cell's runner
  adapters, to be planned separately.
- Web UI. The SSE stream (`factory watch`) is the only live view.
