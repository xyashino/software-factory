---
scope: factory/cell-server
summary: Add sf cell server CLI, local slot commands and multi-PC fixes
why: Operator drives local Cell Server from sf; two PCs need FACTORY_HOST and fresh origin before worktrees
date: 2026-11-20
tags: [cli, cell-server, cells, git, multi-pc]
---

- `sf cell server start|stop|status [--json]`: detached `apps/cell-server`, pid in `$XDG_DATA_HOME/sf/cell-server.pid`, log `cell-server.log`, health poll 10 s, refuses if already answering.
- `sf cell server factory add|ls|use|rm`: saved Factory targets in Cell Server; `add` takes `--join-token`, `--supervisor-token`, `--default`.
- `sf cell server config get [key]|set <key> <value>`: five settings keys; unknown key is an argument error; value parsed as boolean, number or string.
- `sf cell create [--repo] [--name] [--count] [--lines a,b] [--factory] [--json]`, `sf cell list --local`, `sf cell rm <id>`: local slots through Cell Server HTTP.
- `sf cell stop [<id>] [--all] [--force]`: `--all` and ids of local slots go to Cell Server; other ids go to Factory. `--id` kept as alias.
- `sf cell list` without `--local` and `sf cell start` keep Factory behavior; `start` reads `CELL_NAME` when `--name` is absent.
- `CELL_SERVER_URL` overrides default `http://127.0.0.1:7071`; Ports gain `cellServer` and `cellServerPidFile`.
- Compiled `sf` dispatches `__cell-server` like `__server`, running the cell-server source embedded at build.
- `sf server start` passes `FACTORY_HOST` to factory-server only when set in the environment.
- `git worktreeAdd` runs `git fetch origin` first when `origin` remote exists; fetch failure throws `git fetch origin failed`.
- Open: fetch does not move local base branch; worktree still starts from local `main`.
- Open: `sf cell start` does not consume `CELL_SESSION_TOKEN`; factory-cell still needs `FACTORY_JOIN_TOKEN`.
- Open: server start health probe uses `FACTORY_URL`, not `FACTORY_PORT`; a server on the default port can mask a failed start.
