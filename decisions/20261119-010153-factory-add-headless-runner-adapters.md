---
scope: factory
summary: Add five headless runner adapters behind the cell runner port
why: Cells need one adapter per agent CLI so a Line can name the runner for a station.
date: 2026-11-19
tags: [factory, cli, cell, runners]
---

- `RUNNER_NAMES` is exactly `claude, codex, cursor, antigravity, opencode`. `getRunner(name)` returns `undefined` for an unknown name.
- Adapter interface: `name`, `buildCommand(spec)` returns argv, `checkInstalled(probe)` asks `which` for the binary. Herdr fields, `startArgs` and `parseUsage` are not ported.
- `spec` is `{ promptFile, model?, permission }`. The argv tells the agent to read the prompt file. `--model` or `-m` is omitted when the Line gives no model.
- Headless process: `cwd` is the worktree. Env is process env plus `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`. stdout and stderr append to `.cell/<step-id>/step.log`.
- Abort sends SIGTERM, then SIGKILL after 5 s. Behavior change: `apps/cell` sent SIGTERM only.
- Line stations take `runner:`. A station with no runner, a runner not installed, or an unknown runner sends `line_unavailable` and no `start`.
- `cell start` sends the installed runners in `hello`. It refuses only when none is installed; before, it always refused.
- Application code reaches runners through `RunnerCatalogPort`. It never imports `adapters/`.
- `opencode` headless uses `opencode run`. The old adapter had no headless mode, so this flag set is unverified against the real CLI.
- The prompt file `.cell/<step-id>/prompt.md` is expected in the worktree. This change does not generate it.
- No import from `apps/cell`. A boundary test enforces it.
