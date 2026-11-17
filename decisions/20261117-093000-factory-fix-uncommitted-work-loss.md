---
scope: factory
summary: Fix retries wiping uncommitted work; scope rich-commit to the change
why: A retry rolled the worktree back to a pre-cycle snapshot and wiped a completed Station's work; rich-commit read an unrelated HEAD and failed every gate.
date: 2026-11-17
tags: [factory, cell, workspace, snapshots, nitpick]
---

- A write Station rerun rolls the worktree back to its pre-cycle snapshot only when it takes over a Cycle that did not finish.
  - Only `restart` and `resume` causes roll back. A `retry` after a verdict or gate failure keeps the uncommitted work, since the previous Cycle completed.
- Before any rollback, the uncommitted tree is saved under `refs/software-factory/<todoId>/preserved/<cycleId>`, so a rollback never discards work without a copy.
- `nitpick --check` without `--range` or `--commit-msg` checks the commits in `origin/main..HEAD`, the commits the change adds, instead of always checking `HEAD`.
