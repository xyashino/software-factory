---
status: todo
priority: high
depends_on: [perf-04-local-checkpoints-deliver-push]
line: feature
factory: v2
plan: cell-perf
type: feat
---

# perf-05: Reset Work order on missing local checkpoint and skip existing PRs

## Objective

When station checkpoints stay local until `deliver` (no remote branch or PR exists mid-Line), detect if a claimed mid-Line Work order's `job.base` commit is missing from the Cell's mirror/worktree (and not on `origin`): if a PR already exists on GitHub, skip the task; otherwise inform the server to reset the Work order back to its initial state (`station 0`) instead of raising a `workspace_failed` Andon.

## Read first

- `apps/cell/src/workspace/prepare.ts`, `mirror.ts`
- `apps/cell/src/jobs/run-operator-station.ts`, `run-inspection.ts`, `deliver.ts`
- `apps/cell/src/adapters/github/github.adapter.ts`
- `packages/factory-core/src/order/{commands,events,decide,decide-lifecycle,evolve,next-job,state}.ts`
- `packages/factory-runtime/src/{command-handler,queue,claim}.ts`
- `docs/CORE.md`, `docs/PROTOCOL.md`

## Deliverables

1. **Core reset command & event (`packages/factory-core`):**
   - Add an order command/event (e.g. `ResetMissingCheckpoint` → `checkpoint_reset`) for a Cell holding an active lease whose `job.base` `CommitSha` does not exist locally or on `origin`.
   - In `evolve` / `decide`, resetting returns the Work order to station `0` (`branch_base`, clearing `checkpoint`, `retriesUsed`, active job, and prior station artifacts/verdicts) with a bounded auto-reset counter so a corrupted state raises an Andon instead of looping infinitely.
2. **Cell affinity on local checkpoints (`packages/factory-runtime`):**
   - Track the Cell that produced an unpushed local checkpoint (or last ran a station on the order) and prefer that Cell in queue/continuation selection while that Cell is active, avoiding unnecessary resets across multiple Cells.
3. **Cell missing-checkpoint detection & existing-PR skip (`apps/cell`):**
   - When `prepareWorkspace` receives a pinned `CommitSha` (`typeof job.base === 'string'`):
     1. Check `git cat-file -e <sha>^{commit}` locally first (skip remote `git fetch` when present).
     2. If missing locally, fetch `origin` and retry `git cat-file -e`.
     3. If still missing, check `github.findPr(job.repo.branch)`:
        - If a PR already exists (`open` or `merged`), skip/complete without resetting or re-running the task.
        - If no PR exists, send `ResetMissingCheckpoint` to the server instead of `ReportWorkspaceFailed` so the order restarts cleanly from station `0`.
4. **Docs, Tests & ADR:**
   - Update `docs/CORE.md` and `docs/PROTOCOL.md` for `ResetMissingCheckpoint` and the missing-checkpoint / existing-PR flow.
   - Add unit tests in `packages/factory-core/src/order/__tests__/` (decide, evolve, invariants) and Cell tests in `apps/cell/src/__tests__/` covering: local hit (no fetch), missing local + PR exists (skip), missing local + no PR (reset to initial state), and bounded reset cap.
   - Record one ADR entry in `decisions/`.

## Acceptance criteria

- [ ] A mid-Line job whose `job.base` exists in the local mirror runs with zero remote `git fetch` calls.
- [ ] When `job.base` is missing locally and on `origin`, and no PR exists for `factory/<todoId>`, the Cell triggers `ResetMissingCheckpoint` and the Work order restarts cleanly from station `0` without raising an Andon.
- [ ] When a PR already exists for `factory/<todoId>`, the task is skipped/not reset or re-run.
- [ ] Repeated missing-checkpoint resets are bounded (raising an Andon after the cap) and multi-Cell ping-pong is prevented via Cell preference.
- [ ] `pnpm ci:verify` passes.
