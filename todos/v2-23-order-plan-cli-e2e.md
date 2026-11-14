---
status: todo
priority: medium
depends_on: [v2-22-order-plan-cell-jobs]
workflow: feature
---

# v2-23: Order Plan CLI and end-to-end test

## Objective

Make Order Plans visible to the Supervisor and prove the whole flow end to end: three stacked Work
orders on `feat/<slug>` and one plan PR into `main`.

## Read first

- `docs/ORDER-PLAN.md`, PROTOCOL §10
- `apps/cli/src/usage.ts`, `apps/cli/src/commands/status.ts`, `apps/cli/src/render/`
- `apps/server/src/testing/serve-fixture.ts`, the existing e2e fake-cell tests

## Deliverables

1. **CLI (`apps/cli`):**
   - `factory plan ls`: plans with slug, project, member count, plan PR state.
   - `factory plan status <slug> [--project <id>]`: the chain in order with board status, base
     branch, PR link and blocker, e.g. `wo-1 [merged] -> wo-2 [delivered, PR into factory/wo-1] -> wo-3 [running]`,
     plus the plan PR. `--json` supported; local, remote and `--once` equivalent (RULES §6.5).
2. **End-to-end test** with a local bare remote, real Cell jobs and a fake GitHub whose merge is a
   `git merge --no-ff` into the bare repo plus PR state `merged`:
   - three `plan: e2e` todos on `main`; the Factory creates `feat/e2e`;
   - `wo-1` adds file A, PR into `feat/e2e`; `wo-2` waits until `wo-1` is delivered;
   - `wo-2` starts on `factory/wo-1` (sees A), adds B, PR into `factory/wo-1`;
   - merging `wo-1` makes the Factory open the draft plan PR `feat/e2e -> main`;
   - `wo-3` starts on the right base, sees A and B, adds C;
   - after all three merge, the plan PR is ready and lists all three sub-PRs; the todos are gone from
     `feat/e2e`; after the plan PR merges, the plan is `completed`.
3. **Docs and repo support:** `docs/ORDER-PLAN.md` gets the CLI usage and an opt-in GitHub workflow
   example that auto-merges passing `factory/*` PRs into `feat/*` only (merge commit, never into
   `main`, required checks green, `gh pr merge --auto --merge --delete-branch`).

## Acceptance criteria

- The e2e test passes 20 consecutive runs.
- `factory plan ls` and `factory plan status` have CLI tests in all three modes.
- `pnpm turbo check-types lint test` green.
