---
status: queued
priority: high
line: feature
type: feat
plan: web-eda
depends_on: web-navigation-and-overview
---

# web-plans-and-queue-module: add order plans and queue actions EDA module

## Objective

Implement `src/modules/plans-queue/` in `apps/web` so supervisors can view `OrderPlan`s, trigger plan transitions, and run bulk queue actions.

## Context

`apps/hq` exposes `/api/v1/order-plans` (`GET /`, `GET /:id`, `POST /:id/transitions` with `activate`, `retry`, `complete`, `cancel`) and `/api/v1/queue/actions` (`pause`, `unpause`, `reprioritise`, `reset`, `cancel`) via `@repo/hq-contracts/order-plans.contract` and `@repo/hq-contracts/queue.contract`. Follow `apps/web/src/modules/work-orders/` as the 5-layer RxJS EDA + shadcn/ui reference.

## Scope

- **Target**: `apps/web/src/modules/plans-queue`, `apps/web/src/pages/api/order-plans*`, `apps/web/src/pages/api/queue*`, `apps/web/src/server`, `apps/web/src/core/app-router/router.ts`, `apps/web/test`
- **Classification**: `Feature`, `Frontend`

## Implementation Plan

1. **BFF (`apps/web/src/server/`, `apps/web/src/pages/api/`)**:
   - Add `listOrderPlans`, `getOrderPlan`, `transitionOrderPlan`, and `runQueueAction` to `createFactoryClient`.
   - Add `GET /api/order-plans`, `GET /api/order-plans/[id]`, `POST /api/order-plans/[id]/transitions`, and `POST /api/queue/actions` (both POST routes enforce `Origin` CSRF guard).
2. **EDA Module (`apps/web/src/modules/plans-queue/`)**:
   - Implement 5-layer RxJS EDA slice with `switchMap` list/detail loading, plan transition handler, queue action handler, SSE `order_plan` + `work_order` live sync, and toast notifications.
   - UI: plan cards with state badges (`draft`, `branching`, `active`, `ready`, `completed`, `failed`, `cancelled`), branch SHA / failure detail view, `Activate`/`Retry`/`Complete`/`Cancel` buttons (confirmation dialog for `cancel` and `reset`), and queue control bar.
3. **Router**:
   - Register `/plans` in `apps/web/src/core/app-router/router.ts`.
4. **Tests**:
   - Add unit tests for allowed plan transitions and MSW black-box tests in `apps/web/test/blackbox/plans-queue.test.tsx`.

## Acceptance Criteria

- [ ] Supervisors can inspect order plans and activate, retry, complete, or cancel them from `/plans`.
- [ ] Destructive actions (`cancel`, `reset`) require confirmation dialog before submitting.
- [ ] Live SSE transitions update plan state without hiding rendered items.
- [ ] Unit and MSW black-box tests pass.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
