---
scope: factory
summary: Allow several Cells on one machine, each with own state and log
why: Two terminals on one PC shared one cell.json, one cellId and one log, so the second Cell reused the first one's session
date: 2026-11-20
tags: [cell, multi-cell, lock, herdr]
---

- Per-name files under `.factory-local/cells/`: `<name>.json` (session, 0600), `<name>.log` (job log), `<name>.pid` (lock).
- `sf cell start --name <slug>`: claims the lock; a live holder makes it exit 1 with `cell <name> already running`.
- No `--name`: tries `<hostname>`, then `<hostname>-2`, `-3`, ...; a stale lock (holder not alive) is reclaimed.
- Lock is created with `wx` (exclusive), released in `finally`; SIGKILL leaves a stale file that the next start reclaims.
- Legacy `.factory-local/cell.json` moves to `cells/<hostname>.json` when that slot is free and the target does not exist.
- `buildContext(cellName?)` scopes the Cell state and Herdr log tail by name; operator and supervisor modes default to the hostname.
- `CellRuntime` and `StartInput` carry `logPath`; `run-job` no longer reads a hardcoded log path.
- `startCell` mints a `cell_join` token from the supervisor secret when no `FACTORY_JOIN_TOKEN` is given; without a secret it refuses as before.
- Server unchanged: distinct names already give distinct `cellId`.
- `pidFile` port gains `acquire`; `createPidFile(fileName, isAlive)` takes an optional liveness check.
- Tests: unit pid lock, cell slot and migration, per-name paths; in-process mint and refuse branches; blackbox CLI for `--name` refusal, next slot and two named cells in one repo.
- Limit: two concurrent starts that race on the same stale lock could both claim it; a live-holder check narrows but does not close that window.
