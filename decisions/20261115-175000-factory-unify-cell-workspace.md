---
scope: factory
summary: one Cell workspace per Work order, fetch only when needed
why: stations, inspections and delivery kept separate mirrors and worktrees, so each cloned and installed again, and fetched redundantly
date: 2026-11-15
tags: [cell, workspace, perf]
---

- One `prepareWorkspace` (`apps/cell/src/workspace/prepare.ts`) serves `run_operator_station`, `run_inspection` and `deliver` through `prepareJobWorkspace`. The old `apps/cell/src/workspace.ts` is gone.
- Layout: one bare mirror per repo URL, one worktree per Work order.
  - Mirror at `mirrors/<sha256(url)[:16]>.git`.
  - Worktree at `worktrees/<mirror>/<workspace.dir>`, detached at the base commit.
  - Jobs of one Work order on one Cell share that worktree, so `node_modules` and build output are reused.
- The whole preparation holds `withMirrorLock` for its mirror.
  - The first clone runs under a temporary name and is renamed into place, so a killed clone leaves no half mirror.
- The fetch is skipped when a pinned `base` is already in the mirror (`git cat-file -e <sha>^{commit}`).
  - Delivery always fetches: it reads the branch tip (push lease) and the base branch (rebase) from the mirror.
- The mirror keeps the `+refs/*:refs/*` fetch mapping, so `refs/heads` holds the remote's branches.
  - `remote.origin.mirror` is `false`, so checkpoints can push explicit refspecs.
- `sync` no longer runs `git fetch origin` in the shipped lines (`ensureMirror` already fetches). `setup` runs once per commit per worktree, marked by `.cell/cache-<commit>`.
- The Operator worktree is detached: no local `factory/<todo>` branch. Checkpoints push the remote branch explicitly.
- The old `repos/<projectId>.git`, `worktrees/<dir>` and `.cell/prepared` layout is no longer read. A Cell does not migrate it; the old directories can be deleted.
