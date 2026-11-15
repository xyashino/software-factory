---
status: todo
priority: high
depends_on: [perf-01-unify-cell-workspace]
line: feature
factory: v2
type: perf
---

# perf-04: Commit station checkpoints locally and push only at deliver

## Objective

Eliminate remote `git fetch` and `git push` round-trips from intermediate Operator station checkpoints (`apps/cell/src/checkpoint.ts`) so `factory-operator done` and `verdict` commit locally into the Cell's unified mirror/worktree and only `deliver` pushes the branch and opens/skips the PR on GitHub.

## Read first

- `apps/cell/src/checkpoint.ts`
- `apps/cell/src/jobs/run-operator-station.ts`
- `apps/cell/src/jobs/deliver.ts`
- `apps/cell/src/workspace/prepare.ts`, `worktree.ts`, `mirror.ts`
- `docs/PROTOCOL.md` (§8.2, §8.3)
- `todos/perf-01-unify-cell-workspace.md`

## Deliverables

1. **Local-only station checkpoints (`apps/cell/src/checkpoint.ts`, `run-operator-station.ts`):**
   - Keep `validateOutputs`, `upload` (`putBlob`), `commitAll`, `dryRun` command validation, and final `CompleteCycle` / `SubmitVerdict` / `BlockCycle` / `HandOverCycle` submission.
   - Stop calling `fetchTip` / `pushBranch` (`git fetch origin` + `git push --force-with-lease`) during `checkpoint()` on intermediate stations (`plan`, `plan-review`, `build`, etc.).
   - Keep station worktrees on detached `HEAD` (never updating `refs/heads/factory/<todoId>` locally) so the mirror's `refs/heads/factory/<todoId>` continues to reflect `origin` for `deliver`.
2. **Existing-PR skip before delivery push (`apps/cell/src/jobs/deliver.ts`):**
   - In `deliverWorktree`, check `github.findPr(branch)` **before** rebasing/pushing to `origin`: if an `open` or `merged` PR already exists for `factory/<todoId>`, skip pushing and creating a PR (report `ReportDelivery{finished}` with the existing `prUrl` when open, or fail/skip cleanly without overwriting when already merged).
   - Otherwise rebase on `origin/<baseBranch>`, squash, push `HEAD:refs/heads/factory/<todoId>` once, and run `gh pr create`.
3. **Docs & Tests:**
   - Update `docs/PROTOCOL.md` (§8.2–8.3) to document local-only station commits and push-at-deliver.
   - Update `apps/cell/src/__tests__/checkpoint.test.ts`, `deliver.test.ts`, and `e2e/station.test.ts` to assert zero remote git calls on `factory-operator done` / `verdict`, and that `deliver` skips pushing when a PR already exists.
   - Record one ADR entry in `decisions/`.

## Acceptance criteria

- [ ] `factory-operator done` and `verdict` on `write` stations (`plan`, `plan-review`, `build`) commit locally and make zero `git fetch` / `git push` calls to `origin`.
- [ ] Station checkpoints are readable by subsequent `run_inspection` and `deliver` jobs via the Cell's unified mirror/worktree from `perf-01`.
- [ ] `deliver` checks `github.findPr(branch)` before pushing and skips pushing if a PR already exists for `factory/<todoId>`.
- [ ] `pnpm ci:verify` passes.
