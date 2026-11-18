---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-09-runners]
priority: high
line: feature
type: feat
---

# Todo: `cli-10-worktree-checkpoint-deliver` — Git Work for a Job

## 🎯 Objective

Give the Cell the git operations a Job needs: create and remove the worktree, commit a checkpoint, push the branch, and publish the PR at `deliver`.

---

## 🌐 Context & Problem Statement

- Each Work order runs in `<repo>/.worktrees/<slug>/` (factory-server PLAN §2.3). The worktree is created at step 0 and removed only after `deliver` pushes and publishes (§1.4).
- The `.cell/` directory inside the worktree holds station artifacts. It must be excluded from git, so checkpoints contain only code.
- The server never calls GitHub (factory-server PLAN §1.6). The Cell publishes the PR with the `gh` CLI.
- Checkpoints are commits on the Work order branch. A dry run before push catches a commit that would break the next station.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/adapters/git/`, `apps/factory/src/application/procedures/cell/deliver.procedure.ts`, `checkpoint.procedure.ts`.
- **Classification**: `Integration`.
- **Files to create**:
  - `src/adapters/git/git.ts` (implements `GitPort`: `worktreeAdd`, `worktreeRemove`, `commit`, `push`, `headSha`, `status`)
  - `src/adapters/git/exclude.ts` (adds `.cell/` to `.git/info/exclude` of the worktree)
  - `src/adapters/git/gh.ts` (`gh pr create` or `gh pr edit`, body from the PR template in `.factory/templates/pr/`)
  - `src/domain/git/branch-names.ts` (`factory/<slug>`, `feat/<plan-slug>`)
  - `src/domain/git/checkpoint-policy.ts` (which files count as a checkpoint; pure)
  - `src/application/procedures/cell/checkpoint.procedure.ts`
  - `src/application/procedures/cell/deliver.procedure.ts`
  - `test/unit/domain/branch-names.test.ts`, `checkpoint-policy.test.ts`
  - `test/blackbox/git-deliver.test.ts` (uses a throwaway git repository in a temp dir)
- **Dependencies**: none added. Requires `git` and `gh` on the Cell machine.

---

## 🛠️ Implementation Plan

1. **Worktree create** (step 0): `git worktree add <repo>/.worktrees/<slug> -b factory/<slug> <baseBranch>`. The base comes from the server's `baseBranch` on the Job. Write `.cell/worktree.json` (projectId, orderId, planId, lineName, baseBranch, baseCommitSha, cellId).
2. **Exclude**: add `.cell/` to the worktree's `info/exclude`.
3. **Checkpoint** (after each station that changed code):
   - Stage only paths the station reported in `producedFiles`, minus `.cell/`.
   - Commit with the message from the build station's `commit.md` (or a default when absent).
   - Dry-run the next station's checks, then push to `factory/<slug>`.
   - Record `commitSha` for the `complete` transition.
4. **Deliver**:
   - Push `factory/<slug>`.
   - Create or update the PR with `gh` (body from the template).
   - Remove the worktree with `git worktree remove --force`.
   - Send `complete` with `commitSha`. The server marks the Work order `delivered`.
5. **Failure**: a push or `gh` failure sends `fail` with reason `delivery_failed` and keeps the worktree for triage.
6. **Worktree missing**: before a station with `stepIndex > 0`, the check from cli-08 uses `git worktree list` and the `.cell/` files. Any missing piece is `worktree_missing`.

---

## ✅ Acceptance Criteria

- [ ] `.cell/` is excluded from git; `git status` in the worktree never lists it (black-box test).
- [ ] A checkpoint commit contains only the reported files.
- [ ] `deliver` pushes `factory/<slug>` before removing the worktree (order checked by a fake git).
- [ ] After a successful `deliver`, `<repo>/.worktrees/<slug>` no longer exists.
- [ ] A push failure sends `fail` with `delivery_failed` and leaves the worktree in place.
- [ ] `gh` is never called with a token argument; it uses the environment as configured on the Cell.
- [ ] The server is never asked to publish a PR (no `gh` call in any server file).
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): output of a throwaway-repo deliver run.
