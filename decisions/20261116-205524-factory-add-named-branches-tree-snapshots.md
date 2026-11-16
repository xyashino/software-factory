---
scope: factory/cell
summary: Use named factory/<todoId> branches and ref-backed tree snapshots
why: Detached worktrees lost the branch identity and exact read-only checks v1 had; snapshots restore a crashed write Cycle
date: 2026-11-16
---

- workspace: `fresh` placement checks out `.worktrees/<todoId>` on `job.repo.branch` (`git worktree add -B`), never detached
- workspace: `-B` resets a local branch an evicted worktree left behind; no branch-exists error on re-placement
- workspace: `reuse` fails at the `worktree` stage when the worktree is not on the Work order branch
- snapshots: new `workspace/snapshots.ts` ports v1 `withWorktreeTree` (temporary `GIT_INDEX_FILE`, `write-tree`, `commit-tree`)
- snapshots: refs `refs/software-factory/<todoId>/<stationId>/<cycleId>`; `HEAD`, branch and worktree index never move
- snapshots: `.cell/` is dropped from the temporary index; ignored files stay out of the tree
- read-only check: `differsFromSnapshot` (exact tree equality, fails closed) replaces the fingerprint in operator and inspection
- restart: a crashed write Cycle on a reused worktree restores its station's newest snapshot when HEAD has not moved
- deliver: after `ReportDelivery` finished, snapshot refs of the Work order are deleted (best effort)
- removed `workspace/snapshot.ts` (fingerprint) and its test; `snapshots.test.ts` replaces it
- kept `adapters/git/git.adapter.ts` unwired; deleting it is a follow-up
- order cancel has no Cell hook; snapshot ref cleanup on cancel not added
