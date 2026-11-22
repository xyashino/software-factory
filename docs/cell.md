# Cell

Terms: [glossary](./README.md#glossary). Protocol and timing: [factory.md §3](./factory.md). Command tree: [sf.md](./sf.md).

## Role

- Cell = replaceable machine process. Connects out to Factory. Claims Jobs, runs them, reports transitions.
- Factory owns state. Cell holds lease only while it works. Disconnect → lease expires → Job goes to another Cell or same Cell on reconnect.
- Agents never call Factory. Agent talks to its Cell over loopback ([operator endpoint](#operator-endpoint)).
- Two processes named "Cell" in code: **Cell daemon** (`sf cell start`) does the work. **cell-server** (`apps/cell`) supervises Cell daemons on one machine.

## Which code runs what

| Piece | Code | Runs as | Talks to |
| :--- | :--- | :--- | :--- |
| Cell daemon | `apps/sf/src/application/procedures/cell/*`, helpers `apps/sf/src/cell/*`, CLI `apps/sf/src/adapters/cli/cell.command.ts` | `sf cell start`, one per Cell, cwd = repo root | Factory `/api/v1/cells/*`, `/api/v1/jobs/*`; loopback operator endpoint |
| cell-server | `apps/cell/src` (`@repo/cell`), entry `apps/cell/src/index.ts` | detached Bun process, started by `sf cell server start`, default `127.0.0.1:7071` | Factory (`enroll`, `tokens`, `projects`); spawns Cell daemons; own SQLite |
| Local slots | `apps/sf/src/application/procedures/cell/local-*.ts`, `apps/sf/src/adapters/fs/local-slot-store.ts` | `sf cell create` spawns detached `sf cell start --name` | `slots.json` only |
| cell-server client | `apps/sf/src/adapters/cli/cell-server.command.ts`, `apps/sf/src/application/procedures/cell-server/` | inside `sf` | cell-server `health`, `settings`, `factories` |

Two launch paths, not shared:

- **Direct**: `sf cell create`. Slot list in `slots.json`. cell-server never sees these.
- **Managed**: `sf cell server start` → cell-server → `sf cell start` children. Slots live in cell-server SQLite.

Gap: `sf` calls no `/api/v1/cells` route on cell-server. Managed slot create/start/stop/remove is HTTP-only until an `sf` verb exists.

## Slots (cell-server)

Slot = row in `cells` table: `slotId` (UUID), `name`, `factoryId`, `repoRoot`, `cellId`, `sessionToken`, `logPath`, `desiredState`, `runtimeStatus`, `pid`, `lastError`. Unique on `(repoRoot, name)`.

- Desired state: `running` | `stopped`. Set by user intent.
- Runtime status: `starting` | `running` | `stopping` | `stopped` | `failed`. Set by supervisor.
- Names: first slot = hostname, then `host-2`, `host-3`, … (`allocateSlotNames`).
- Count: 1 … `max_local_cells` (default 4, max 64).

Transitions (`application/procedures/cells/slot-runtime.ts`, `adapters/supervisor/cell-supervisor.adapter.ts`):

- **create**: enroll one Cell per slot at Factory, insert row `stopped/stopped`, then start.
- **start**: desired `running`, status `starting`, spawn child. Spawn ok → `running` + pid. Spawn throws → `failed`.
- **child exit while wanted**: status `failed` with `lastError` (`worker exited with code N`). Relaunch after `restart_backoff_ms × 2^attempt`, capped at 60 s. Relaunch ok → `running`.
- **stop**: desired `stopped`. Only `starting`/`running` get killed: SIGTERM, wait 10 s, then SIGKILL. `force` skips SIGTERM.
- **remove**: only when status is not `starting`/`running`/`stopping`.
- **boot**: restart every row with desired `running`. **shutdown** (SIGTERM/SIGINT): SIGTERM all children.

## Cell daemon: start to Job

`sf cell start`, in repo root (`apps/sf/src/application/procedures/cell/start.procedure.ts`):

1. Resolve project from `.factory/config.json`. Refuse if no runner installed (`claude`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot`).
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

Timing constants live in `apps/sf/src/config.ts` (`HEARTBEAT_INTERVAL_MS`, `LEASE_TTL_MS`, `SELF_FENCE_MS`).

## Operator endpoint

- Per Job, Cell opens `Bun.serve` on `127.0.0.1`, port 0 (OS-picked). Closes when Job ends (`adapters/operator-endpoint/loopback.ts`).
- Token `FACTORY_CYCLE_TOKEN`: 16 random bytes, hex. New per run. Held in Cell memory.
- Agent env: `FACTORY_OPERATOR_URL`, `FACTORY_CYCLE_TOKEN`.
- Body > 1 MiB rejected. Non-JSON → 400 `invalid`. Unknown verb → 400.
- Verbs, roles, exit codes: [operator.md](./operator.md). Client: `sf operator`.

## cell-server: workspace, enroll, spawn

Create (`application/procedures/cells/create-cells.procedure.ts`):

1. `projectId` given → list projects on Factory with supervisor token. Ensure workspace clone at `$XDG_DATA_HOME/sf/workspaces/<projectId>`. Refuse dir that is not a clone of the project URL, or has uncommitted changes.
2. `repoRoot` (or workspace) must contain `.factory/config.json` and `.factory/lines/*.yml`.
3. Join credential: request `joinToken` → factory join token → mint from supervisor token. None → 400.
4. Per name: `POST /api/v1/cells/enroll`. Insert row with session token and log path `$XDG_DATA_HOME/sf/cells/<slotId>.log`.
5. Start child: `sf cell start` (must be on `PATH`), cwd = `repoRoot`, stdout/stderr → log file.

Child env set by cell-server (`cell-supervisor.adapter.ts`): `FACTORY_URL`, `CELL_NAME`, `CELL_SESSION_TOKEN`, `CELL_LOG_PATH`, `HERDR_ENABLED`.

Gap, from code: `sf cell start` reads only `CELL_NAME`, `FACTORY_URL` (via connection config), `FACTORY_JOIN_TOKEN`, `CELL_LINES`. `CELL_SESSION_TOKEN`, `CELL_LOG_PATH`, `HERDR_ENABLED` are set but unread. Child session comes from `.factory-local/cells/<name>.json` or inherited join/supervisor credentials, not from the row's token. Not verified end to end.

## Settings and factory profiles

- Machine: `CELL_SERVER_HOST` (default `127.0.0.1`), `CELL_SERVER_PORT` (default `7071`). `sf` reads `CELL_SERVER_URL` for the same address.
- Preferences (`settings` table; `sf cell server config get|set`):

| Key | Default | Range / values |
| :--- | :--- | :--- |
| `herdr_enabled` | `false` | bool. Passed to child as `HERDR_ENABLED` |
| `default_runner` | `claude` | `claude`, `codex`, `cursor`, `antigravity`, `opencode`, `copilot` |
| `restart_backoff_ms` | `1000` | 0 … 600000 |
| `max_local_cells` | `4` | 0 … 64 |
| `git_fetch_on_worktree` | `true` | bool. Stored; no reader found in code |

- Factory profiles (`factories` table; `sf cell server factory add|ls|use|rm`): name, url, join token, supervisor token, one default. Default used when a create omits `factory`.
- Shared config `$XDG_CONFIG_HOME/sf/config.json`: `current` + `targets` (name → url, token). Read at boot; target synced as default factory. `CELL_SERVER_FACTORY` picks a target by name. Unknown name → boot error.
- Tokens are stored plain in cell-server SQLite (file mode 0600).

## Local data

| Path | Written by | Content |
| :--- | :--- | :--- |
| `$XDG_DATA_HOME/sf/cell-server.db` | cell-server | `factories`, `cells`, `settings`. WAL. Mode 0600. Holds tokens |
| `$XDG_DATA_HOME/sf/cell-server.log` | `sf cell server start` | cell-server stdout/stderr |
| `$XDG_DATA_HOME/sf/cells/<slotId>.log` | cell-server child | Cell daemon output for a managed slot |
| `$XDG_DATA_HOME/sf/cells/slots.json`, `<slotId>.pid`, `<slotId>.log` | `sf cell create` | Local slot list and per-slot files |
| `$XDG_DATA_HOME/sf/workspaces/<projectId>` | cell-server | Git clone of the project |
| `$XDG_CONFIG_HOME/sf/config.json` | user / `sf` | Shared factory targets |
| `<repo>/.factory-local/cells/<name>.json` | Cell daemon | Session `{cellId, sessionToken}`. Mode 0600 |
| `<repo>/.factory-local/cells/<name>.pid` | Cell daemon | Claims name; second start with same name refused |
| `<repo>/.worktrees/<order-slug>/` | Cell daemon | Job worktree. Deleted after `deliver` |
| `<worktree>/.cell/<station-id>/` | Cell daemon, operator | Prompt, state, step log, runner info. Git-excluded. See [factory.md §2.3](./factory.md) |

Legacy `.factory-local/cell.json` moves to `cells/<hostname>.json` on first start (`migrateLegacyCellState`).

## Open

- No `sf` verb for managed slots. HTTP only.
- Child env contract: session token and log path set but unread (see above).
- Two slot stores (cell-server SQLite vs `slots.json`) do not know each other.
- `git_fetch_on_worktree` has no reader.
- [architecture.md](./architecture.md) says `sf` calls cell-server for projects and cells. Code: `sf` calls only health, settings, factories.
