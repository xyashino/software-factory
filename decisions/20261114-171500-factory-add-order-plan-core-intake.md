---
scope: factory
summary: Order Plan core, storage and intake on the same store
why: Plan members must chain, gate on predecessors and build on the right base, so the store and intake carry plan state
date: 2026-11-14
tags: [v2, order-plan, core, storage, intake]
---

- Core: `plan/` aggregate per CORE §12.3 (events, state, evolve, decide, nextJob table, projection).
  - `order_created` and `CreateOrder` take an optional `plan`; `baseBranch` is kept in `WorkOrderState` and `OrderProjection`.
  - `queue/deps.ts` adds the stacked outcome for in-plan predecessors (CORE §12.4).
- Definitions: `plan` frontmatter. `validatePlans` marks a branch, second root, cycle or cross-plan dependency as `plan_invalid` on every `todo`-status member.
  - A member that is not runnable also makes its plan invalid, so an invalid plan creates nothing.
- Storage: migration `0003_order_plan.sql` adds `orders.plan`, `orders.base_branch` and the `plans` table.
  - Plan streams use `appendPlan` and `loadPlan` on the same store, in the same transaction shape as Work orders.
  - The port's `feed` filters `:plan:` streams in SQL, so a page is never shorter than its limit.
- Deviation: plan events carry `planId` in their envelope; the `events.order_id` column holds it.
  - Two plan methods on the store, not a widened `AppendInput` union, so Work-order types stay exact.
- Rebuild folds both stream kinds. `openRuntime` rebuilds once after migration 0003, so existing rows get `base_branch` and `plan`.
- Runtime intake: `CreatePlan` before the first member, then `CreateOrder{plan}` and `AddPlanMember` in chain order.
  - A delivered or merged order whose todo is unchanged on the base is recorded silently, not as `reused_id`.
  - `plan_closed` and `plan_changed` are diagnostics. A reconcile pass reports member states; each Work order commit reports its member change.
- Queue: the root of a plan waits while its phase is `branching`. In-plan dependencies use the stacked outcome; others keep `depPolicy`.
  - Job base is resolved per job: `feat/<slug>` or `factory/<predecessor>`, else the pinned `baseBranch`.
- Board: rows carry `plan`, `baseBranch` and `dependsOn`. `supervisor/plans` and `supervisor/plan` list and show plans, members in chain order.
  - HTTP: `GET /v1/plans` and `GET /v1/plans/:id`.
- Not in this step (v2-22, v2-23):
  - plan job payloads, Cell claim of plan jobs and plan leases;
  - the `selectClaimable` branch for `kind: 'plan'` entries;
  - Resume and Cancel dispatch for plan ids, and plan PR polling in `pr-poll`;
  - the CLI `factory plan` commands.
