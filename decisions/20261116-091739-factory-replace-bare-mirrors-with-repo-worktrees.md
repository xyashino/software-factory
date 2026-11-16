---
scope: factory/cell
summary: Cell makes worktrees in repo/.worktrees instead of bare mirrors
why: Mirrors duplicate the repo and hide worktrees from git worktree list
date: 2026-11-16
tags: [cell, workspace, worktree, git]
---

- The Cell no longer clones or fetches bare mirrors under `<cellDataDir>/mirrors` or `repos/`; it creates neither directory.
- Job worktrees are detached `git worktree add --detach` entries under `<repo>/.worktrees/<dir>`, made from the repo's own `.git`, so `git worktree list` shows them.
- Each prepare runs `git fetch --prune origin` in the repo; base and tip reads use `refs/remotes/origin/*`. The repo's checked-out branch is never checked out, reset or moved.
- One repo lock (flock on `<repo>/.factory-local/locks/git.lock`, polled without blocking) covers fetch, worktree add and reset, prune and eviction across concurrent Cell instances.
- Each worktree has an in-use lease (flock on `.factory-local/locks/worktree-<hash>.lock`, taken without waiting) held from prepare until the job releases it; eviction skips leased worktrees.
- `.cell/`, `.worktrees/` and `.factory-local/` are added once to the repo's common `info/exclude`, so the checkout and every worktree stay clean without a `.gitignore` entry.
- Plan jobs fetch origin under the repo lock and read `refs/remotes/origin/*`; their pushes keep the job's repo url.
- Legacy `mirrors/`, `repos/` and `worktrees/` under the data directory are neither read nor removed; they are cleaned by hand.
