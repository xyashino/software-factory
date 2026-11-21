---
scope: software-factory/cell
summary: Abort kills the runner tree and waits for exit
why: Herdr tab close left the agent alive, so a second runner could start in the same worktree
date: 2026-11-21
tags: [cell, runner, abort]
---

- `RunnerPort.abort` resolves `true` only once the run's processes are gone, `false` when they outlive the limit.
- Herdr: launcher writes its pid; abort snapshots the process tree (`ps`), sends SIGTERM, waits 10s, then SIGKILL and waits 5s, then closes the tab.
- Headless: child spawned in its own process group; abort signals the group, SIGKILL after 5s.
- `run-job` stops the runner on every end path (abort, timeout, drain-force, TUI verb) and awaits the result.
- Runner still alive after abort: job fails with `runner still alive after abort, Cell left without claiming`, Cell leaves, no claim.
- Windows headless keeps child-only kill.
