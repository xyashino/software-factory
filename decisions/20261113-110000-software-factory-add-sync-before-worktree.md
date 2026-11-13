---
scope: software-factory
summary: Hard-sync repo root to origin/main before each worktree
why: Local main must never hold changes; resetting it before the worktree exists makes every task start from origin/main
date: 2026-11-13
tags: [software-factory, workflow, git]
---

- Workflows gain an optional `sync` block (`timeout`, `exec`), run in the repo root before `createWorktree`
- Shipped workflows set it to `git fetch origin` and `git reset --hard origin/main`, timeout 2m
- A failing or timed-out sync records `setup_finished { ok: false }` and creates no worktree
- `setup` is unchanged and runs only inside the worktree after creation
- Sync logs go to `.evidences/<task>/sync-<index>.log`
- Reconcile tolerates a missing worktree after a crash during sync; sync is idempotent so it reruns
- No guard that the root is on `main`: the reset hits whatever branch is checked out there
