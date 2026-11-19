---
scope: repo
summary: Git ignores the Cell run directory .cell/
why: Cell writes prompts, state, logs and evidence into each worktree; they must never be tracked.
date: 2026-11-19
tags: [repo, git, cell]
---

- Root `.gitignore` adds `.cell/` next to `.worktrees/` and `.factory-local/`.
- Ignore now lives in the repo, not only in a local `.git/info/exclude`.
