---
status: todo
priority: medium
depends_on:
  - v1-parity-04-enforce-delivery-adr-gate
line: feature
factory: v2
plan: v1-ux-parity
type: refactor
---

# v1-parity-05-named-branches-and-tree-snapshots: Use named `factory/<todoId>` worktree branches and `refs/software-factory/` tree snapshots instead of detached HEAD

## 🎯 Objective

Replace `detached HEAD` worktrees in `apps/cell/src/workspace/` with named local branches (`factory/<todoId>`), and adopt v1's `GIT_INDEX_FILE` + `write-tree` / `commit-tree` snapshot mechanism (`refs/software-factory/<todoId>/<stationId>/<cycleId>`) for instant pre-cycle snapshots, exact read-only mutation checks, clean retry rollbacks, and post-delivery ref cleanup.

---

## 🌐 Context & Problem Statement

In v1 (`packages/software-factory/src/adapters/git/git.adapter.ts`):
- `createWorktree` checked out `.worktrees/<taskId>` directly onto the named branch `factory/<taskId>` (`git worktree add -b factory/<taskId> <path> <base>`, re-attaching if `refs/heads/factory/<taskId>` or `origin/factory/<taskId>` already existed).
- `snapshot` / `differsFromSnapshot` / `restore` / `deleteSnapshotRefs` used an isolated temporary `GIT_INDEX_FILE` (`withWorktreeTree`) to capture full working-tree + untracked-file state under `refs/software-factory/<taskId>/<stepId>/<attemptId>` without touching `HEAD`, polluting `refs/heads/*`, or pushing anything to `origin`.

In v2 (`apps/cell/src/workspace/worktree.ts`), `ensureWorktree` always checks out `--detach`, making local worktrees anonymous commits and losing v1's zero-overhead tree snapshot, rollback, and exact `differsFromSnapshot` guarantees.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/cell/src/workspace/worktree.ts` (`ensureWorktree`, `removeWorktree`)
  - `apps/cell/src/workspace/prepare.ts` & `apps/cell/src/workspace/lru.ts`
  - `apps/cell/src/workspace/snapshots.ts` (new module porting v1 `withWorktreeTree`, `snapshot`, `differsFromSnapshot`, `restore`, `deleteSnapshotRefs`)
  - `apps/cell/src/jobs/run-operator-station.ts`, `apps/cell/src/jobs/run-inspection.ts`, `apps/cell/src/jobs/deliver.ts`
  - `apps/cell/src/names.ts` (`snapshotRefFor`)
- **Classification**: `Integration` / `Infrastructure`
- **Dependencies**:
  - No new external dependencies.

---

## 🛠️ Implementation Plan

1. **Named Worktree Branches (`apps/cell/src/workspace/worktree.ts`)**:
   - Check out `.worktrees/<todoId>` onto `factory/<todoId>` (not `--detach`).
   - On `fresh` start (station `0` / after reset-to-0): reset or create `factory/<todoId>` cleanly at the resolved base commit (`git worktree add -B factory/<todoId> <path> <base>` or reset existing checked-out branch via `checkout -B factory/<todoId> <base>` + `clean -fd`), avoiding collisions if an evicted worktree left a local `refs/heads/factory/<todoId>` behind.
   - On `reuse` continuation: verify the worktree is checked out on `factory/<todoId>` (never reset or wipe it).
   - On `removeWorktree` / eviction (when no job holds it): remove the worktree and prune; on terminal delivery/cancel, optionally clean up the local `factory/<todoId>` ref once `origin/factory/<todoId>` is published or work is cancelled.
2. **Isolated Tree Snapshots (`apps/cell/src/workspace/snapshots.ts`)**:
   - Port v1's `withWorktreeTree` (`mkdtempSync` + `GIT_INDEX_FILE` + `read-tree` + `add -A` + `write-tree`, respecting `.cell/` exclusion via `.git/info/exclude`), `commit-tree`, and `update-ref` under `refs/software-factory/<todoId>/<stationId>/<cycleId>`.
   - Implement:
     - `snapshot({ worktree, ref })` → creates a snapshot ref before a cycle starts without modifying `HEAD` or the worktree's index.
     - `differsFromSnapshot({ worktree, ref })` → exact tree equality check (`tree !== snapshotTree`) for `run_inspection` and `permission: 'read'` operator stations on dirty worktrees.
     - `restore({ worktree, ref })` → `git read-tree -u --reset <commit>` + `clean -fd` (excluding `.cell/`) to roll back partial/corrupted changes on cycle failure/restart before retrying.
     - `deleteSnapshotRefs(todoId)` → deletes `refs/software-factory/<todoId>/*` refs after successful delivery or order cancellation.
3. **Integrate Snapshots with Cycle Execution & Delivery**:
   - Record a pre-cycle snapshot before `run_operator_station` and `run_inspection`.
   - Use `differsFromSnapshot` for read-only verification (`readOnlyFinish` and `runInspection`).
   - On `restart` after a crashed/timed-out write cycle, restore the previous station's snapshot if available so the restarted cycle starts from a clean pre-cycle state.
   - In `deliver.ts`, push `HEAD:refs/heads/factory/<todoId>` and invoke `deleteSnapshotRefs(todoId)` once delivery succeeds.

---

## ✅ Acceptance Criteria

- [ ] `.worktrees/<todoId>` is checked out on named branch `factory/<todoId>` instead of `detached HEAD`.
- [ ] Re-creating or evicting a worktree handles pre-existing local `refs/heads/factory/<todoId>` cleanly without `git worktree add` branch-exists errors.
- [ ] `snapshot`, `differsFromSnapshot`, `restore`, and `deleteSnapshotRefs` work via temporary `GIT_INDEX_FILE` under `refs/software-factory/<todoId>/...` without touching `HEAD` or `.cell/`.
- [ ] `run_inspection` and `permission: 'read'` stations use `differsFromSnapshot` to verify zero side effects even on dirty worktrees.
- [ ] Failed/timed-out write cycles can be rolled back cleanly to their pre-cycle snapshot on restart, and snapshot refs are pruned on delivery.
- [ ] Passes verification gate (`pnpm ci:verify`).
