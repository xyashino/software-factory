---
scope: factory
summary: Unify Cell workspace prepare and skip pinned-base fetch
why: One workspace path per Cell avoids duplicate mirrors, locks and fetches
date: 2026-11-15
tags: [cell, workspace, git, fetch, worktree, perf]
---

- One `prepareWorkspace` in `apps/cell/src/workspace/prepare.ts` serves `run_operator_station`, `run_inspection`, `deliver` and mechanic repair.
  - `apps/cell/src/workspace.ts` is removed.
  - `run-job.ts` builds the operator station's shell and claim the same way `run-inspection.ts` does, with the same `inUse` release.
- Layout: one bare mirror per repo URL at `mirrors/<hash>.git`; one worktree per `workspace.dir` at `worktrees/<mirror>/<dir>`.
  - Jobs of one Work order on one Cell share that worktree.
  - `node_modules`, `.turbo` and build output are reused, and setup runs once per commit.
- The worktree is detached at the base commit. The legacy `factory/<todo>` local branch is not created: a mirror fetch writes `refs/heads/*`, and a branch checked out in a worktree would clash with it.
- Locking: `withMirrorLock` in `workspace/mirror.ts` serializes clone, fetch, worktree add and prune, and eviction per mirror path. `sync` and `setup` run outside the lock.
- Claims: a worktree joins `inUse` as soon as it is placed and leaves it when its Job ends or fails. LRU eviction never removes a claimed worktree.
- Fetch rule: `ensureMirror` skips `git fetch` when `job.base` is a pinned commit and the mirror already holds it (`git cat-file -e <sha>^{commit}`).
  - A branch base always fetches.
  - `deliver` always fetches (`alwaysFetch`), because its push lease reads the remote tip from the mirror.
  - Plan jobs always fetch.
- A first clone goes to a temporary name and is renamed into place.
- Mirror config: `remote.origin.mirror` is set to `false` so checkpoints can push explicit refspecs.
  - The fetch mapping stays the mirror's own, so plan and deliver read the same refs as before.
- `lines/{fast,standard,feature}.yml` drop `workspace.sync` (the duplicate `git fetch origin`). `workspace.setup` stays.
- Upgrade: the legacy `repos/`, `worktrees/<dirOf(orderId)>` and `.cell/prepared` marker are orphaned, not migrated. Remove them by hand. Setup runs once more on the first job after upgrade.
