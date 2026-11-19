---
scope: factory
summary: Add git worktree, checkpoint commit, push and PR publish for a Job
why: The Cell must own the git work for a Job, and the server never calls GitHub.
date: 2026-11-19
tags: [factory, cli, cell, git, delivery]
---

- Step 0 of a Job creates `<repo>/.worktrees/<slug>` on `factory/<slug>` from the Job's `baseBranch`. It writes `.cell/worktree.json` and adds `.cell/` to the worktree's `info/exclude`.
- A worktree that already exists is reused. The branch is not recreated.
- A failed worktree create or exclude sends `fail` with `workspace failed`. The worktree is kept.
- Checkpoint after a station with reported files: stage only those paths minus `.cell/`, commit with `.cell/<step>/commit.txt` or a default message, push `factory/<slug>`, and record the HEAD sha as `commitSha` on `complete`.
- The dry run is a status check: the reported paths must be clean after the commit. It does not run the next station's checks.
- A failed checkpoint sends `fail` with `checkpoint failed`.
- Deliver station: push `factory/<slug>`, publish the PR with `gh`, remove the worktree with `--force`, then send `complete` with `commitSha`.
- Any push, `gh` or remove failure sends `fail` with `delivery failed`. The worktree is kept. The server maps a deliver station's `fail` to `delivery_failed`.
- `gh` runs from the worktree with the environment as configured on the Cell. No token argument.
- The PR body comes from `.factory/templates/pr/body.md`. The title is the first line of `commit.txt`.
- Git and `gh` are reached through `GitPort` and `PrPort`. Application code never imports `adapters/`.
- `fs.writeText` and `git` are wired in `bootstrap/context.ts`.
