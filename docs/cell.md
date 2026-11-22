# Cell

Terms: [glossary](./README.md#glossary). Protocol and timing: [factory.md §3](./factory.md). Command tree: [sf.md](./sf.md).

## Role

- Cell = replaceable machine process. Connects out to Factory. Claims Jobs, runs them, reports transitions.
- Factory owns state. Cell holds lease only while it works. Disconnect → lease expires → Job goes to another Cell or same Cell on reconnect.
- Agents never call Factory. Agent talks to its Cell over loopback ([operator endpoint](#operator-endpoint)).
- Two names in code: **Cell daemon** (`sf cell start`) does the work. **Factory daemon** (`sf factory start`) runs one per PC and supervises the Cell daemons on it.

## Which code runs what

| Piece | Code | Runs as | Talks to |
| :--- | :--- | :--- | :--- |
| Cell daemon | `apps/sf/src/application/procedures/cell/*`, helpers `apps/sf/src/cell/*`, CLI `apps/sf/src/adapters/cli/cell.command.ts` | `sf cell start`, one per Cell, cwd = repo root | Factory `/api/v1/cells/*`, `/api/v1/jobs/*`; loopback operator endpoint |
| Factory daemon | `apps/sf/src/daemon/*`, CLI `apps/sf/src/adapters/cli/factory.command.ts` | detached `sf factory start`, `127.0.0.1:7072` | Factory `/api/v1/tokens`, `/api/v1/projects` (supervisor token); spawns and kills Cell daemons |
| Factory daemon client | `apps/sf/src/application/procedures/cell/factory-cells.ts`, `apps/sf/src/adapters/http/factory-daemon.adapter.ts` | inside `sf cell scale|list` | Factory daemon loopback API |

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
| `GET /cells` | `{ cells: [{ cellId, name, repoRoot, pid }] }` |
| `POST /cells` `{ repoRoot, name?, lines? }` | `201` cell record |
| `DELETE /cells/:cellId` | `{ cellId }`, or `404` |

Errors: `{ code, type, message }`. `400` argument, `409` refused (name taken, project not registered), `503` Factory unreachable.

Cell supervision (`apps/sf/src/daemon/supervisor.ts`):

- Cell id = random UUID, memory only. Names: `hostname`, `hostname-2`, … against live Cells.
- Create: daemon checks `.factory/config.json` in the repo, checks the project on Factory, mints a `cell_join` token per Cell, spawns `sf cell start --name <name>` with cwd = repo root and env `FACTORY_URL`, `FACTORY_TOKEN`, `FACTORY_JOIN_TOKEN`, `CELL_LINES` (if set), `SF_FACTORY_PID` = daemon pid.
- Kill: SIGTERM, wait 10 s, SIGKILL, wait until the pid is gone. Resolves only after exit.
- A dead Cell drops from `GET /cells` on the next call.
- Parent watch: each Cell checks once per second that its parent is still the daemon (`SF_FACTORY_PID`). If not, it aborts, and exits after a 1 s grace if a claim is still waiting. A `kill -9` of the daemon therefore takes its Cells down within about 2 s.
- Stop/SIGTERM of the daemon kills all Cells first, then removes the pid file and exits.
- The daemon keeps no state on disk except the pid file. Logs: Cell output in `$XDG_DATA_HOME/sf/cells/<cellId>.log`.
- Only the daemon holds the HQ credential. The CLI mints nothing for Cells.

`sf cell scale|list` call the daemon. Daemon down → `factory not running: run "sf factory start"`.

- `cell scale N [--lines a,b] [--json]`: N Cells for the repo project. Project = `.factory/config.json` of the nearest ancestor; none → refused. No `--project`. Project not on HQ → refused with `sf project add <id> --repo <url>`. One repo path per project per Factory.
- `cell list [--json]`: per project: repo, desired, running, Cell id + state (`idle`|`running`), `crash loop` flag.
- Count lives in memory. Daemon restart or HQ loss → 0. Scale up refused while HQ is not connected.
- Scale down: idle first, then read-only stations, then newest writing station.
- Exit not requested → respawn after 1, 2, 4 ... 30 s. 5 exits in 60 s → `crash loop`, no respawn until `scale` again.
- Cell reports `idle` (claim wait) and `running` (station) to `POST /cells/:id/activity`. Best-effort.
- `cell create|stop|rm` are removed: exit 2 with `use "sf cell scale N"`.
- `slots.json` and the old per-slot files are ignored. No migration.

## Cell daemon: start to Job

`sf cell start`, in repo root (`apps/sf/src/application/procedures/cell/start.procedure.ts`):

1. Resolve project from `.factory/config.json`. Refuse if no runner installed (`claude`, `codex`, `cursor`, `antigravity`, `opencode`).
2. Lines = `.factory/lines/*.yml`, filtered by `CELL_LINES`. None → error.
3. Session = `.factory-local/cells/<name>.json`. Missing → enroll with `FACTORY_JOIN_TOKEN`, or mint `cell_join` from supervisor token. Session holds `cellId` + `sf_cell_` token.
4. `POST /api/v1/cells/hello`: projectId, lines, runners.
5. Claim loop: `POST /api/v1/cells/claims`, `waitMs` 25 s. Empty reply → claim again.
6. Run Job station by station. Reply `nextJob` continues without re-claim. Details: [factory.md §3](./factory.md).
7. Heartbeat every 10 s (`POST /api/v1/cells/heartbeats`). Reply `signals` drive the loop:
   - `abort`, or 4 failed beats in a row → abort runner.
   - `drain` → finish or hand over via `POST /api/v1/cells/leave`, take no new claims.
   - `force` → stop now.
   - Superseded → exit without handover.
8. With `SF_FACTORY_PID` set (started by the Factory daemon): exit when the parent changes.

Timing constants live in `apps/sf/src/config.ts` (`HEARTBEAT_INTERVAL_MS`, `LEASE_TTL_MS`, `SELF_FENCE_MS`).

## Operator endpoint

- Per Job, Cell opens `Bun.serve` on `127.0.0.1`, port 0 (OS-picked). Closes when Job ends (`adapters/operator-endpoint/loopback.ts`).
- Token `FACTORY_CYCLE_TOKEN`: 16 random bytes, hex. New per run. Held in Cell memory.
- Agent env: `FACTORY_OPERATOR_URL`, `FACTORY_CYCLE_TOKEN`.
- Body > 1 MiB rejected. Non-JSON → 400 `invalid`. Unknown verb → 400.
- Verbs, roles, exit codes: [operator.md](./operator.md). Client: `sf operator`.

## Settings and env

- Factory daemon port: `SF_FACTORY_PORT` (default `7072`).
- Daemon child env: `FACTORY_URL`, `FACTORY_TOKEN` (inherited from the start command's connection), `FACTORY_JOIN_TOKEN`, `CELL_LINES`, `SF_FACTORY_PID`. Tokens are never logged.
- Shared config `$XDG_CONFIG_HOME/sf/config.json`: connection targets, read by `sf`.

## Local data

| Path | Written by | Content |
| :--- | :--- | :--- |
| `$XDG_DATA_HOME/sf/factory.pid` | `sf factory start` | Factory daemon pid. Removed on stop |
| `$XDG_DATA_HOME/sf/factory.log` | Factory daemon | Daemon stdout/stderr |
| `$XDG_DATA_HOME/sf/cells/<cellId>.log` | Factory daemon child | Cell daemon output |
| `$XDG_DATA_HOME/sf/cells/slots.json`, `<slotId>.pid`, `<slotId>.log` | old `sf cell create` (removed) | Ignored since the Factory daemon. Removable |
| `$XDG_CONFIG_HOME/sf/config.json` | user / `sf` | Shared factory targets |
| `<repo>/.factory-local/cells/<name>.json` | Cell daemon | Session `{cellId, sessionToken}`. Mode 0600 |
| `<repo>/.factory-local/cells/<name>.pid` | Cell daemon | Claims name; second start with same name refused |
| `<repo>/.worktrees/<order-slug>/` | Cell daemon | Job worktree. Deleted after `deliver` |
| `<worktree>/.cell/<station-id>/` | Cell daemon, operator | Prompt, state, step log, runner info. Git-excluded. See [factory.md §2.3](./factory.md) |

Legacy `.factory-local/cell.json` moves to `cells/<hostname>.json` on first start (`migrateLegacyCellState`).

## Open

- Cell daemon started by hand (tmux, systemd) has no parent watch. Only daemon-started Cells exit with the daemon.
- `sf setup --cell` and `sf cell scale` need a running Factory daemon.
- The Factory daemon does not start on boot. `sf service` does not manage it yet.
