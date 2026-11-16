---
status: todo
priority: high
depends_on: []
line: feature
factory: v2
type: refactor
---

# cell-local-worktrees: Use `<repo>/.worktrees/` directly from `<repo>/.git` instead of bare mirrors

## Objective

Since `factory-cell` is now repo-scoped (`repo-scoped-cell`), stop cloning and fetching duplicate bare git mirrors under `.factory-local/cell/{mirrors,repos}` and instead create detached `git worktree`s directly from `<repoRoot>` under `<repoRoot>/.worktrees/<order>`, making active worktrees directly visible in `git worktree list` (matching `packages/software-factory`).

## Read first

- `apps/cell/src/main.ts`
- `apps/cell/src/cell.ts`
- `apps/cell/src/jobs/send.ts`
- `apps/cell/src/jobs/run-job.ts`
- `apps/cell/src/jobs/deliver.ts`
- `apps/cell/src/jobs/plan.ts`
- `apps/cell/src/workspace.ts`
- `apps/cell/src/workspace/mirror.ts`
- `apps/cell/src/workspace/prepare.ts`
- `apps/cell/src/workspace/worktree.ts`
- `apps/cell/src/workspace/lru.ts`
- `packages/software-factory/src/adapters/git/git.adapter.ts`
- `docs/PROTOCOL.md`, `docs/STORAGE.md`, `docs/STRUCTURE.md`

## Deliverables

1. **Thread `repoRoot` through `apps/cell` runtime context:**
   - Pass `loaded.repoRoot` from `apps/cell/src/main.ts` into `startCell` (`apps/cell/src/cell.ts`) and `JobContext` (`apps/cell/src/jobs/send.ts`).
   - Keep `cellDataDir` (`<repoRoot>/.factory-local/cell`, or `-2`, `-3`, ...) strictly for per-instance state (`cell.lock`, identity/credential, logs, `runtime/` journals, `cycles/`), not git mirrors or worktrees.
2. **Create detached worktrees directly in `<repoRoot>/.worktrees/` (`apps/cell/src/workspace/`, `apps/cell/src/workspace.ts`):**
   - Replace `clone --mirror` / `ensureMirror` with `git -C <repoRoot> fetch --quiet --prune origin` (guarded by a repo-level lock in `<repoRoot>/.factory-local/` so concurrent `factory-cell` instances do not race on `.git/*.lock` during `fetch`, `worktree add`, or `worktree prune`).
   - Resolve the repo's common git dir (`git rev-parse --git-common-dir`) and ensure `.cell/` is present in its `info/exclude` so `.cell/` stays untracked in every worktree.
   - Create/reset detached worktrees at `<repoRoot>/.worktrees/<dir>` (`git -C <repoRoot> worktree add --detach ...` / `checkout --force --detach <commit>`), so the user's checked-out branch in `<repoRoot>` is never modified or blocked by branch-checkout collisions.
   - Run LRU eviction (`worktree_limit`) over `<repoRoot>/.worktrees/`, removing evicted worktrees via `git -C <repoRoot> worktree remove --force` / `worktree prune` while respecting `inUse` (and without removing worktrees actively locked by another concurrent Cell instance).
   - Update both `apps/cell/src/workspace.ts` and `apps/cell/src/workspace/prepare.ts` (or consolidate them) so no `mirrors/` or `repos/` directory is created.
3. **Update remote ref resolution in `deliver.ts`, `plan.ts`, and `prepare.ts`:**
   - Because `<repoRoot>` tracks remote branches under `refs/remotes/origin/*` rather than bare-mirror `refs/heads/*`, update `prepare.ts`, `deliver.ts`, and `plan.ts` to read `refs/remotes/origin/${baseBranch}` and `refs/remotes/origin/${branch}` (while `checkpoint.ts`, `deliver.ts`, and `plan.ts` continue pushing `<commit>:refs/heads/<branch>` to `origin`).
   - Keep `plan_branch`, `plan_pr`, and `plan_pr_ready` working directly on `<repoRoot>` without creating any worktree or bare mirror.
4. **Tests, Documentation & ADR:**
   - Update `apps/cell/src/__tests__/` (`workspace.test.ts`, `deliver.test.ts`, `plan.test.ts`, `operator-workspace.test.ts`, `integration.test.ts`, `e2e/`, `distributed/`) to verify `<repoRoot>/.worktrees/` creation, `git worktree list` visibility, zero `mirrors/`/`repos/` creation, preservation of the main checkout's active branch, and safe concurrent `fetch`/`worktree` locking.
   - Update `docs/PROTOCOL.md`, `docs/STORAGE.md`, and `docs/STRUCTURE.md` to reflect `<repoRoot>/.worktrees/`.
   - Record one ADR entry in `decisions/`.

## Acceptance criteria

- [ ] `factory-cell` creates no `mirrors/` or `repos/` directories under `.factory-local/cell*`.
- [ ] Job worktrees are created detached under `<repoRoot>/.worktrees/<dir>` directly from `<repoRoot>/.git` and show up in `git worktree list`.
- [ ] Running `factory-cell` jobs never modifies or collides with the branch checked out in `<repoRoot>`.
- [ ] Concurrent `factory-cell` instances on the same repository synchronize `git fetch` / `worktree` operations safely and do not evict worktrees in use by another instance.
- [ ] `plan_branch`, `plan_pr`, `plan_pr_ready`, `run_inspection`, `run_operator_station`, `mechanic`, and `deliver` all pass against `<repoRoot>`.
- [ ] `pnpm ci:verify` passes.
