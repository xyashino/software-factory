---
status: todo
priority: medium
depends_on: [v2-19-project-registry-cli, v2-20-order-plan-design]
workflow: feature
---

# v2-21: Order Plan in the core, storage and intake

## Objective

Implement the Order Plan domain from v2-20: `plan:` todos become an Order Plan aggregate plus member
Work orders, stacked dependencies gate claims, and each job is built against the right base branch.
No Cell changes here (v2-22).

## Read first

- `docs/ORDER-PLAN.md` and the CORE / STORAGE / PROTOCOL sections written in v2-20
- `packages/factory-definitions/src/todo.ts`, `todo-scan.ts`
- `packages/factory-core/src/order/events.ts` (`order_created.baseBranch` already exists), `state.ts`,
  `evolve.ts`, `projection.ts`, `decide-lifecycle.ts`, `queue/deps.ts`
- `packages/factory-runtime/src/intake.ts`, `queue.ts`, `job-builder.ts`, `pr-poll.ts`
- `packages/factory-db/src/schema.ts`, `orders-table.ts`, `migrations/`

## Deliverables

1. **Definitions:** `plan` in `todoFrontmatter` / `Todo` (slug rule from v2-20) with tests. Plan
   validation in `scanTodos`: linear chain, one root, no cycles, no cross-plan in-plan dependency →
   `plan_invalid` diagnostics for every todo of that plan.
2. **Core, Work order:**
   - `order_created` and `CreateOrder` gain optional `plan`. No `schemaVersion` bump (CORE §11); a
     test reads stored events without it.
   - `baseBranch` from `order_created` is kept in `WorkOrderState` and `OrderProjection` (today
     `evolve` drops it). It stays `project.baseBranch` for non-plan orders.
   - `queue/deps.ts`: add the stacked outcome for in-plan predecessors (`delivered` and PR not
     `closed` → satisfied; `closed` → broken).
3. **Core, Order Plan aggregate:** ids, events, state, `evolve`, `decide`, `nextJob` and projection as
   specified in v2-20, with tests driven by events and commands alone (RULES §1.3) and the new
   invariants property-tested (RULES §1.4).
4. **Storage:** migration for `orders.plan`, `orders.base_branch` and the `plans` table, written in the
   same transaction as their events and rebuilt identically (RULES §2.5); `schema.test.ts` parity;
   export/import round trip.
5. **Runtime:**
   - Intake: creates the plan (`CreatePlan`) before its members, passes `plan` into `CreateOrder`, and
     stays idempotent on replay.
   - Intake: a delivered/merged Work order whose todo is unchanged on the base branch is recorded
     silently, not as `reused_id` (fixes the noise for plan todos that stay on `main`).
   - `queue.ts`: in-plan dependencies use the stacked outcome; others `project.depPolicy`.
   - Root is not claimable until the plan has `plan_branch_created`.
   - `job-builder.ts`: plan base resolution (`feat/<slug>` or `factory/<predecessor>`) for
     `job.repo.baseBranch` and `branch_base`; non-plan orders use the pinned `state.baseBranch`, never
     `project.baseBranch`.
   - Board row gains `plan`, `baseBranch` and `dependsOn`; a `supervisor/plans` read route
     (list + detail with members in chain order).

## Out of scope

- Executing plan jobs on the Cell and the deliver base switch (v2-22). CLI and e2e (v2-23).

## Acceptance criteria

- Three `plan: xyz` todos on `main` (`wo-1`, `wo-2 depends_on wo-1`, `wo-3 depends_on wo-2`) produce
  one plan and three Work orders; a branching or cyclic plan produces `plan_invalid` and no orders.
- `wo-2` is not claimable while `wo-1` is queued or running, becomes claimable when `wo-1` is
  `delivered`, with job base `factory/wo-1`; after `wo-1` is `merged` its next job's base is `feat/xyz`.
- A `wo-1` PR closed unmerged makes `wo-2` `deps_broken`.
- Projections rebuild identically; `pnpm turbo check-types lint test` green.
