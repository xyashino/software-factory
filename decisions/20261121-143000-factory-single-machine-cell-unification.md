---
scope: factory
summary: Local cells run from root sf through active connection, no cell-server needed
why: single machine ran two servers with separate DBs and duplicate factory targets; cell-server spawned a stale factory-cell binary
date: 2026-11-21
tags: [cell, cli, connection]
---

- `sf cell create|list|stop|rm` work with only `factory-server`: they use the active connection (`FACTORY_URL`/`FACTORY_TOKEN`, global config, repo token) and no `:7071` listener.
- Local slots live in `$XDG_DATA_HOME/sf/cells/`: `slots.json` (mode `0600`, atomic write, corrupt file refused), per-slot `<slotId>.pid` and `<slotId>.log`.
- `create [--count N] [--name slug] [--lines a,b] [--repo path] [--json]`: mints a `cell_join` token per slot, spawns detached `sf cell start --name <slot>` in the repo with `FACTORY_URL`, `FACTORY_TOKEN`, `FACTORY_JOIN_TOKEN`, `CELL_LINES`. `--name` refused with count > 1 or when a live slot holds it. Names allocated as `hostname`, `hostname-2`, ...
- `cell start` honours `CELL_LINES` (filter of line files); unset means all lines.
- `list` merges Factory cells with local pid by cell name (new `pid` column); `--here` (alias `--local`) reads only `slots.json`. A pid shows only while the worker is alive.
- `stop <id>` matches local slot id or name first, otherwise drains a Factory cell as before. Local stop sends SIGTERM and waits up to 10 s; `--force` first drains the matching Factory cell with `force: true`. Slot becomes `stopped`, pid `null`. `stop --all` stops every running slot.
- `rm <id>` refuses while the worker pid is alive; removes entry, `.pid` and `.log`.
- `--factory` dropped from `create`: local ops use the single active connection (`sf target use` picks it).
- Remote `cell-server`: supervisor spawns `sf cell start` (was `factory-cell`); on start it syncs the shared config target (`$XDG_CONFIG_HOME/sf/config.json`, or `CELL_SERVER_FACTORY`) into its factories table as default.
- Dead remote-cell wrappers removed from the factory (`procedures/cell-server/cells.procedure.ts`); `sf cell server ...` unchanged.
