---
status: queued
priority: high
line: feature
type: chore
factory: v2
---

# add-gitignore-cell-dir: Ignore the Cell run directory

Cell writes `.cell/` (prompts, state, logs, evidence) into each worktree. Git must not track it.

- Add `.cell/` to the root `.gitignore`, next to `.worktrees/` and `.factory-local/`.
- Change nothing else.
