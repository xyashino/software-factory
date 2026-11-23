---
scope: factory
summary: Local Factory daemon replaces cell-server and slots.json
why: one daemon per PC owns Cell processes; cell-server and slots.json duplicated state and needed a second server
date: 2026-11-22
supersedes: 20261121-143000-factory-unify-single-machine-cells
tags: [factory, cell, daemon]
---

- `sf factory start|stop|status`: one detached daemon per PC, `Bun.serve` on `127.0.0.1:$SF_FACTORY_PORT` (default `7072`). Loopback only.
- Pid file `$XDG_DATA_HOME/sf/factory.pid`, daemon log `factory.log`, Cell logs `cells/<cellId>.log`. No other disk state.
- Start refuses when the pid file names a live process (`factory already running, pid N`) or another process answers on the port. Start waits up to 10 s for `/health` to answer with the spawned pid.
- `status` is running only when `/health` answers with the pid from the pid file. A foreign listener is reported `healthy: false`.
- `stop` SIGTERMs the daemon, which kills all Cells (SIGTERM, 10 s, SIGKILL) before exit. Waits up to 30 s.
- Loopback API: `GET /health` `{pid}`, `GET /cells`, `POST /cells` `{repoRoot, name?, lines?}`, `DELETE /cells/:cellId`. Errors `{code, type, message}`.
- Cell ids are random UUIDs in memory. Names are `hostname`, `hostname-2`, ... unique among live Cells.
- Daemon checks `.factory/config.json` in the repo, validates the project on Factory and mints the `cell_join` token. Only the daemon holds the HQ credential.
- Cell child env adds `SF_FACTORY_PID`. `sf cell start` polls its parent once per second and exits when the parent pid changes, so a killed daemon takes its Cells down.
- `sf cell create|list|stop|rm` call the daemon. Daemon down fails with `factory not running: run "sf factory start"`.
- `cell create` drops `--project`. `--name` still needs count 1.
- `cell rm <id>` kills and removes a daemon Cell. `cell stop <id>` does the same for daemon Cells, otherwise drains an HQ Cell as before.
- Removed: `apps/cell`, `packages/cell-contracts`, `sf cell server`, `CELL_SERVER_*` env and markers, `slots.json` and per-slot files (ignored, no migration), `sf cell create --project`.
