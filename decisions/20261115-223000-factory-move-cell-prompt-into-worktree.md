---
scope: factory/cell
summary: Move cycle prompt.md into the worktree's .cell/
why: Operators read prompts from the worktree; sockets stay short
date: 2026-11-15
tags: [cell, operator, mechanic, prompt, worktree, unix-socket]
---

- Operator station `prompt.md` now lives at `<worktree>/.cell/cycles/<cycleDirName>/prompt.md`. The kickoff points there, and the file is removed when the Cycle ends.
- Mechanic `prompt.md` lives at `<worktree>/.cell/repair/<jobId>/prompt.md` when the worktree is prepared. It falls back to `<dataDir>/repairs/<hash>/` only when workspace preparation fails.
- `op.sock`, `bin/`, `stdout.log` and `stderr.log` stay in the short `<dataDir>/cycles/<cycleDirName>/` or `<dataDir>/repairs/<hash>/` dirs, so the socket path stays under the ~108-byte `sun_path` limit.
- `.cell/` is already git-excluded and survives `git clean -fd -e .cell/`, so the prompt never shows in `git status` or commits.
- The scripted Operator takes its scratch dir from `FACTORY_OPERATOR_SOCKET`, not from the prompt path.
