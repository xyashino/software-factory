---
status: delivered
priority: medium
line: feature
type: feat
---

# sf-plan-reset-from-scratch: restart an order plan from scratch

## Objective

Let an operator force an order plan to run again from the beginning, with its child work orders reset to step 0 and its integration branch recreated, through one explicit command.

## Context

Today there is no plan-level restart:

- `sf queue reset <order>` only resets a single work order, and the server accepts it only from `queued`, `waiting_parent`, `line_unavailable` or `blocked` (`apps/hq/src/domain/orders/order-state.ts`).
- `OrderPlan` actions are `activate | retry | complete | cancel` (`packages/hq-contracts/src/enums/orders.ts`). `retry` works only from `failed`, so a plan in `active`, `ready` or `completed` cannot be restarted.
- The plan branch job (`createPlanBranch`, `apps/sf/src/application/procedures/cell/run-job.procedure.ts:1620`) runs a plain `git push` to `feat/<plan-slug>`. A second run on an existing branch is non-fast-forward and fails.

CLI side for activate and retry is tracked in [`sf-plan-activate-verb`](./sf-plan-activate-verb.md). This task adds the reset path on top of it.

## Scope

- **Target**: `packages/hq-contracts/src/enums/orders.ts`, `apps/hq/src/domain/orders/order-state.ts`, `apps/hq/src/application/procedures/order-plans/transition-order-plan.procedure.ts`, `apps/hq/src/application/orders/order-writes.ts`, `apps/sf/src/application/procedures/cell/run-job.procedure.ts`, `apps/sf/src/adapters/cli`, `docs/sf.md`, `docs/hq.md`
- **Classification**: `Domain Core`, `Integration`, `CLI`

## Implementation Plan

1. **HQ plan action `reset`**: add `reset` to `PLAN_ACTIONS`. In `nextPlanState`, allow `reset` from every state except `cancelled`, moving to `branching`. Insert a fresh `plan_branch` job, as `activate` does.
2. **HQ cascade**: in the same transaction, cancel in-flight jobs of the plan's work orders (reuse the `releaseLease` path from `cancel`) and set each non-delivered child to step 0 via the `reset_to_scratch` logic. Leave `delivered` children untouched and list them in the response so the operator can decide on `reopen`.
3. **Cell force push**: mark the reset `plan_branch` job with `payloadJson.fresh = true`. For that job only, `createPlanBranch` pushes with `--force-with-lease` against the commit it fetched. Normal runs keep the plain push.
4. **SF CLI**: `sf plan reset <slug> [--yes]`. Require `--yes`, matching `queue cancel`. Print the children reset and the children skipped as delivered.
5. **Docs**: add the command to `docs/sf.md` and the reset flow to `docs/hq.md`.

## Open Decisions

- Remote branch: force-push over `feat/<plan-slug>` (recommended, the branch is rebuilt from base) or delete it first. Either way the old commits stay in the reflog only.
- Delivered children: skipped and reported (recommended) or reopened automatically.

## Acceptance Criteria

- [ ] `sf plan reset <slug>` without `--yes` fails and changes nothing.
- [ ] A plan in `completed` or `active` moves to `branching` and gets one new `plan_branch` job.
- [ ] Non-delivered child work orders return to step 0 and their in-flight jobs are cancelled.
- [ ] A reset `plan_branch` job force-updates the existing `feat/<plan-slug>` without failing on non-fast-forward.
- [ ] Delivered children are not changed and appear in the command output.
- [ ] Each command has a blackbox test with a fake HQ. Tests follow the `testing` rules.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] `bun run ci:verify` passes.
