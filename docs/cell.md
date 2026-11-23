# Cell

Terms: [glossary](./README.md#glossary). Protocol and timing: [hq.md §3](./hq.md). Command tree: [sf.md](./sf.md).

## Role

- Cell = disposable worker process. One Job at a time, runs inside a repo. Random id `cell-<8 hex>`, picked by the Factory daemon per run, never stored in HQ.
- HQ never talks to a Cell. A Cell talks only to its Factory daemon on `127.0.0.1`. The daemon relays to HQ with the Factory credential and adds `x-cell-id`.
- Stop means delete. A gone Cell leaves no row in HQ. Its Job is requeued after the Factory kills the process.
- Agents never call Factory. Agent talks to its Cell over loopback ([operator endpoint](#operator-endpoint)).
- Two names in code: **Cell daemon** (`sf cell start`) does the work. **Factory daemon** (`sf factory start`) runs one per PC and supervises the Cell daemons on it.

## Which code runs what

| Piece | Code | Runs as | Talks to |
| :--- | :--- | :--- | :--- |
| Cell daemon | `apps/sf/src/application/procedures/cell/*`, helpers `apps/sf/src/cell/*`, CLI `apps/sf/src/adapters/cli/cell.command.ts` | `sf cell start`, one per Cell, cwd = repo root, started by the Factory daemon | Factory daemon `/relay/api/v1/*`; loopback operator endpoint |
| Factory daemon | `apps/sf/src/factory/*`, CLI `apps/sf/src/adapters/cli/factory.command.ts` | detached `sf factory start`, `127.0.0.1:7072` | HQ `/api/v1/factories/*`, `/api/v1/cells/*` (Factory credential); spawns and kills Cell daemons |
| Factory daemon client | `apps/sf/src/application/procedures/cell/factory-cells.ts`, `apps/sf/src/adapters/http/factory.adapter.ts` | inside `sf cell scale|list` | Factory daemon loopback API |

## Factory daemon

Start, stop, status (`apps/sf/src/application/procedures/factory/*`):

- `sf factory start`: refuses if the pid file names a live process (`factory already running, pid N`) or another process answers on the port. Spawns `sf __factory-daemon` detached, cwd `$XDG_DATA_HOME/sf`, log `factory.log`. Writes pid file `factory.pid`. Polls `/health` up to 10 s until the answer carries the spawned pid.
- `sf factory stop`: SIGTERM the pid, waits up to 30 s, removes the pid file. Not running → `factory not running`.
- `sf factory status [--json]`: `running` only when the pid file pid is alive and `/health` answers with that pid. `healthy` is false for a foreign listener. Exit 0 running, 1 not.
- Port: `SF_FACTORY_PORT`, default `7072`. Listens on `127.0.0.1` only.
- Loopback API, used by `sf` only:

| Route | Reply |
| :--- | :--- |
| `GET /health` | `{ pid }` |
| `GET /status` | `{ pid, hq, url, factoryId, cells }` (`hq` = link state to HQ) |
| `GET /scale` | `{ projects: [{ projectId, repoRoot, desired, running, crashLoop, cells }] }` |
| `PUT /scale` `{ repoRoot, count, lines? }` | `{ projectId }` |
| `POST /cells/:cellId/activity` `{ state, writes, since }` | `{ cellId }`, or `404`. Sent by the Cell; drives scale-down order |
| `ALL /relay/*` | Cell traffic, see below |

Errors: `{ code, type, message }`. `400` argument, `409` refused (no `.factory/config.json`, project scaled from another repo path, Factory not connected, HQ unreachable or rejected), `503` relay could not reach HQ.

Cell supervision (`apps/sf/src/factory/supervisor.ts`):

- Cell id = `cell-` + 8 random hex, memory only, one per run, never reused. Names: `hostname`, `hostname-2`, … against live Cells.
- Scale up: daemon checks `.factory/config.json` in the repo, takes the project from it, spawns `sf cell start --name <name>` with cwd = repo root and env `HQ_URL` (relay), `HQ_TOKEN` (local bearer for this Cell), `FACTORY_CELL_ID`, `CELL_LINES` (if set), `SF_FACTORY_PID` = daemon pid.
- Kill: SIGTERM, wait 10 s, SIGKILL, wait until the pid is gone. Resolves only after exit. Then the daemon calls HQ `POST /api/v1/factories/cells/:id/gone` (failure ignored: HQ requeues the Job when its lease expires).
- Relay (`apps/sf/src/factory/relay.ts`): accepts only `claims`, `heartbeats`, `jobs/:id/transitions`, `incidents/:id/resolve`. Forwards with the Factory credential and `x-cell-id`. A local bearer unknown or dead → `401`. HQ answers `401` → the daemon stops that Cell and returns `401`.
- Heartbeat to HQ every 10 s carries `projects: [{ projectId, desired, running }]` (display only).
- Parent watch: each Cell checks once per second that its parent is still the daemon (`SF_FACTORY_PID`). If not, it aborts, and exits after a 1 s grace if a claim is still waiting. A `kill -9` of the daemon therefore takes its Cells down within about 2 s.
- Self-fence: 45 s without an HQ answer → the daemon kills all Cells. HQ reaps a silent Factory after 60 s.
- Stop/SIGTERM of the daemon kills all Cells first, then removes the pid file and exits.
- The daemon keeps no state on disk except the pid file. Logs: Cell output in `$XDG_DATA_HOME/sf/cells/<cellId>.log`.
- Only the daemon holds the HQ credential. The Cell holds only its local bearer.

`sf cell scale|list` call the daemon. Daemon down → `factory not running: run "sf factory start"`.

- `cell scale N [--repo path] [--lines a,b] [--json]`: desired Cells for the repo project, converged by the daemon (`PUT /scale`). No `--project`: the project comes from the repo config. Count lives in memory; restart or HQ loss resets to 0.
- `cell list [--json]`: the daemon's Cells, local only (`GET /scale`).
- `cell list` shows per project repo: desired, running, Cell id and state, `crash loop` flag.
- Scale down order: idle Cells, then read-only stations, then writing stations, newest Cell first. Kill is confirmed before HQ gets the gone call.
- `cell create|stop|rm` are removed: exit 2 with `use "sf cell scale N"`.

## Cell daemon: start to Job

`sf cell start`, in repo root, only under the Factory daemon (`apps/sf/src/application/procedures/cell/start.procedure.ts`). Run by hand → refused.

1. Resolve project from `.factory/config.json`. Refuse if no runner installed (`claude`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`).
2. Lines = `.factory/lines/*.yml`, filtered by `CELL_LINES`. None → error.
3. Cell id from `FACTORY_CELL_ID`, bearer from `HQ_TOKEN`. No enroll, no session file.
4. Claim loop: `POST /relay/api/v1/cells/claims` with `{ waitMs, projectId, allowedLines, runners }`, `waitMs` 25 s. Empty reply → claim again.
5. Run Job station by station. Reply `nextJob` continues without re-claim. Details: [hq.md §3](./hq.md).
6. Heartbeat every 10 s (`POST /relay/api/v1/cells/heartbeats`). Reply `signals` drive the loop:
   - `abort`, or 4 failed beats in a row → abort runner.
7. With `SF_FACTORY_PID` set (started by the Factory daemon): exit when the parent changes.

Timing constants live in `apps/sf/src/config.ts` (`HEARTBEAT_INTERVAL_MS`, `LEASE_TTL_MS`, `SELF_FENCE_MS`).

## Operator endpoint

- Per Job, Cell opens `Bun.serve` on `127.0.0.1`, port 0 (OS-picked). Closes when Job ends (`adapters/operator-endpoint/loopback.ts`).
- Token `FACTORY_CYCLE_TOKEN`: 16 random bytes, hex. New per run. Held in Cell memory.
- Agent env: `FACTORY_OPERATOR_URL`, `FACTORY_CYCLE_TOKEN`.
- Body > 1 MiB rejected. Non-JSON → 400 `invalid`. Unknown verb → 400.
- Verbs, roles, exit codes: [operator.md](./operator.md). Client: `sf operator`.

## Settings and env

- Factory daemon port: `SF_FACTORY_PORT` (default `7072`).
- Daemon child env: `HQ_URL` (relay), `HQ_TOKEN` (local bearer), `FACTORY_CELL_ID`, `CELL_LINES`, `SF_FACTORY_PID`. Tokens are never logged.
- Shared config `$XDG_CONFIG_HOME/sf/config.json`: connection targets, read by `sf`.

## Local data

| Path | Written by | Content |
| :--- | :--- | :--- |
| `$XDG_DATA_HOME/sf/factory.pid` | `sf factory start` | Factory daemon pid. Removed on stop |
| `$XDG_DATA_HOME/sf/factory.log` | Factory daemon | Daemon stdout/stderr |
| `$XDG_DATA_HOME/sf/cells/<cellId>.log` | Factory daemon child | Cell daemon output |
| `$XDG_CONFIG_HOME/sf/config.json` | user / `sf` | Shared factory targets |
| `<repo>/.factory-local/cells/<name>.pid` | Cell daemon | Claims name; second start with same name refused |
| `<repo>/.worktrees/<order-slug>/` | Cell daemon | Job worktree. Deleted after `deliver` |
| `<worktree>/.cell/<station-id>/` | Cell daemon, operator | Prompt, state, step log, runner info. Git-excluded. See [hq.md §2.3](./hq.md) |

## Open

- Cell daemon started by hand has no Factory daemon to relay through. It refuses to start.
- `sf setup --cell` and `sf cell scale` need a running Factory daemon.
- The Factory daemon does not start on boot. `sf service` does not manage it yet.
- Gaps against the design: [hq-factory-cell-plan.md](./hq-factory-cell-plan.md#gaps).
