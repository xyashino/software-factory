---
status: todo
priority: high
depends_on: []
line: feature
factory: v2
---

# perf-01: Unify Cell workspace preparation and eliminate redundant git fetches

## Objective

Unify the two separate workspace preparation paths in `apps/cell` so all jobs on a Cell share one mirror, worktree, lock, and dependency cache per Work order, and remove redundant `git fetch` invocations.

## Read first

- `apps/cell/src/workspace.ts` (used by `run-job.ts` for `run_operator_station`)
- `apps/cell/src/workspace/prepare.ts`, `mirror.ts`, `worktree.ts`, `cache.ts`, `lru.ts` (used by `run-inspection.ts` and `deliver.ts`)
- `apps/cell/src/jobs/run-job.ts`, `run-inspection.ts`, `deliver.ts`
- `packages/factory-definitions/lines/fast.yml`, `standard.yml`, `feature.yml`
- `docs/RULES.md`, `docs/PROTOCOL.md`

## Deliverables

1. **Single workspace implementation in `apps/cell`:**
   - Consolidate `apps/cell/src/workspace.ts` and `apps/cell/src/workspace/prepare.ts` into one shared `prepareWorkspace` path used by `runOperatorStation`, `runInspection`, and `runDeliver`.
   - Keep a single bare mirror per repository/project and a single worktree per `workspace.dir` (e.g. `worktrees/<dirOf(orderId)>`), protected by the per-mirror mutex (`withMirrorLock`), LRU eviction (`inUse` guard), and `.cell/` exclusion.
   - Ensure operator stations, inspections, and delivery for the same Work order on the same Cell reuse the same worktree (`node_modules`, `.turbo`, build artifacts) instead of cloning/installing twice.
2. **Eliminate redundant `git fetch`:**
   - Remove `git fetch origin` from `workspace.sync.exec` in `packages/factory-definitions/lines/{fast,standard,feature}.yml` (`ensureMirror` already runs `git fetch --prune origin` on the mirror).
   - When `job.base` is a pinned `CommitSha` and that commit already exists in the local bare mirror (`git cat-file -e <sha>^{commit}`), skip the remote `git fetch` on continuation/reuse.
3. **Tests & ADR:**
   - Update and consolidate `apps/cell/src/__tests__/workspace.test.ts`, `operator-workspace.test.ts`, `run-inspection.test.ts`, `deliver.test.ts`, and `packages/factory-definitions/src/__tests__/shipped.test.ts`.
   - Add one `decisions/` ADR entry documenting the unified Cell workspace layout and fetch skip.

## Acceptance criteria

- [ ] `run_operator_station`, `run_inspection`, and `deliver` share one `prepareWorkspace` implementation, one mirror, and one worktree per `workspace.dir`.
- [ ] Mirror operations stay serialized via `withMirrorLock` (a Cell runs one Job at a time, but a continuation and a stopping Job may overlap).
- [ ] `lines/*.yml` no longer duplicate `git fetch origin` in `workspace.sync`, and pinned-SHA jobs skip `git fetch` when the commit is already present in the mirror.
- [ ] `pnpm ci:verify` passes.
