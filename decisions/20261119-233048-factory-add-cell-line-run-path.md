---
scope: factory
summary: Run the fast and feature Lines end to end on the v2 Cell
why: The v2 Cell could not run a repo Line; every claim ended line_unavailable and no step had a prompt, operator endpoint or gate
date: 2026-11-19
tags: [v2, cell, line, smoke]
---

- `factory-server`: run jobs carry `lineName` and `task` (slug, title, type, description) in `payload`; shape is `stepJobPayloadDto`.
- `domain/line/parse-line.ts` reads the repo Line format.
  - Runner, model and profile come from `operators.<name>`; inspection `exec` and `workspace.setup.exec` are kept.
  - A top-level `deliver` block becomes the last `deliver` station; `wireSnapshotOf` sends the server only the fields it stores.
- `domain/line/operator-prompt.ts`: renders `.factory/operators/<profile>.md` into `.cell/<station>/prompt.md`, with `.cell/task.md` as input.
  - `factory-operator` in the profile becomes `bun <cli> operator`; a station with no profile gets a short default prompt.
- `adapters/operator-endpoint/loopback.ts`: per-job `Bun.serve` on `127.0.0.1:0`, wired in `bootstrap/context.ts`.
- `run-job.procedure.ts`:
  - `.cell/` dirs are named by station id; server step ids are only known after `start`.
  - `state.json` is written on complete, so the next step's prior-file check passes.
  - Workspace setup runs after the worktree is created; inspection stations run their `exec` in the worktree.
  - Both run under a heartbeat so the lease holds.
- Checkpoint commits every worktree change when a station reports only `.cell/` files; commit and push use `--no-verify`, as the gate runs `ci:verify`.
- Line `feature`:
  - Inputs `<station>.<artifact>` resolve to `.cell/<station>/<file>`; their text, the gate result, later-station feedback and the diff against base go into `{{context}}`.
  - A verdict fail or gate fail writes `.cell/<station>/feedback.md`, so the retried build sees it; a pass clears it.
  - Operator `permission`, `timeout` and deliver `requireAdr` (exactly one new `decisions/` file) are enforced.
- Herdr panes: a `headless: false` operator runs its TUI (`claude <prompt>`, `agy -i <prompt>`) in a Herdr tab of the Cell workspace.
  - A pane that fails to open falls back to headless once; `.cell/<station>/runner.json` records the mode and reason.
  - A pane step's tab closes once its verb arrives; closing it ends that run's wait. Antigravity folder trust is pre-accepted like Claude's.
  - The Cell workspace opens in the repo root; its first tab is `logs`, following `.factory-local/cell.log` (one line per transition, plus the run mode).
  - Log lines are coloured like the legacy `factory log -f`: dim clock, step actions blue, failures red, delivery green.
- `factory-web-demo`: test files run one at a time; two of them `astro build` into the same `dist/` and raced under load.
- Smoke: `factory-workflow-smoke` (Line `fast`) and `factory-feature-smoke` (Line `feature`, every operator in a pane) imported, run by the Cell, delivered as PRs.
- Not in this change: `workspace.sync`, inspection timeouts, `herdr agent` metadata and question handling from `factory-herdr-runtime`.
