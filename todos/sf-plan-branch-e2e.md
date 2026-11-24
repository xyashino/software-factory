---
status: queued
priority: high
line: standard
type: test
---

# sf-plan-branch-e2e: test plan activation through root work order on a real remote

## Objective

Cover the path from plan activation to the first child work order with a real git remote, so a remote-only base branch fails the gate.

## Context

Activating `standalone-factory` pushed `feat/standalone-factory` to origin, but `git worktree add` looked for it only as a local ref. Tests used `main`, which exists locally, so they passed.

## Scope

- **Target**: `apps/sf/test/blackbox`, `apps/sf/src/adapters/git/git.ts`
- **Classification**: `Testing`, `Integration`

## Implementation Plan

1. Add `apps/sf/test/blackbox/plan-branch-e2e.test.ts` using a bare repo as `origin` (same setup as `git-deliver.test.ts`).
2. Scenario: import a plan with one root todo, activate it, run the Cell until the plan is `active`, then assert the root work order's worktree starts from `origin/feat/<plan>`.
3. Add a unit case to `git-worktree-add.test.ts` for a remote-only base (already partly covered by `origin/main`).

## Acceptance Criteria

- [ ] Reverting the origin fallback in `git.ts` makes the e2e test fail.
- [ ] Reverting the `plan_branch` handler in `run-job.procedure.ts` makes the e2e test fail.
- [ ] The test runs under `bun run test` in `apps/sf` with no network access.
- [ ] Test names follow story style.
