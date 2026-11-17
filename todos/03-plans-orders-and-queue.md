---
status: todo
priority: high
depends_on:
  - 02-safe-tokens-and-projects
line: feature
type: feat
---

# Todo: `03-plans-orders-and-queue` — `OrderPlan`, `WorkOrder`, Branch Topology & Markdown Queue Import/Export

## 🎯 Objective

Implement `OrderPlan` and `WorkOrder` management, single-parent branch resolution (`resolveBaseBranch`, `PLAN.md` §6.1), and Markdown queue round-trip (`GET /api/v1/queue/export`, `POST /api/v1/queue/import`, `POST /api/v1/queue/actions` per `PLAN.md` §5 & §9).

---

## 🌐 Context & Problem Statement

Tasks enter the factory as `todos/<slug>.md` files pinned to a repository's `projectId` and `line` name, optionally grouped into an `OrderPlan` (`feat/<plan-slug>`) or stacked on at most 1 parent `WorkOrder` (`depends_on: <parent-slug>`). The server must validate the single-parent DAG, compute unambiguous `baseBranch` / `targetBranch` values for every scenario (`PLAN.md` §6.1), support `dry_run` and `apply` imports, export clean markdown files, and wake long-polling Cells on work arrival.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-server/src/{domain/{topology,orders,queue},contracts,application/procedures/{order-plans,work-orders,queue},adapters/hono/routes}`
- **Boundary**: Strictly backend-only inside `apps/factory-server/` (do not connect or edit `apps/cell`, `apps/cli`, or `packages/factory-*`; simulate Cell/Supervisor HTTP calls via `app.request()` in `apps/factory-server/test/`).
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - `hono: catalog:`
  - `drizzle-orm: catalog:`
  - `yaml: catalog:`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Pure Topology & Queue Domain (`src/domain/topology/`, `src/domain/queue/`, `src/domain/orders/`)**:
   - `src/domain/topology/resolve-base-branch.ts`: implements all 5 scenarios from `PLAN.md` §6.1 (`Plan Branch Init`, `Standalone WorkOrder`, `Standalone Chained WorkOrder`, `OrderPlan Root WorkOrder`, `OrderPlan Step WorkOrder`), returning `{ isReady, initialState, baseBranch, baseCommitSha, targetBranch }`.
   - `src/domain/queue/todo-markdown.ts`: parses and serializes `todos/<slug>.md` YAML frontmatter (`status`, `priority`, `line`, `plan`, `depends_on`, `type`) + `# <slug>: <title>` heading + markdown description body (`PLAN.md` §5.1). Rejects multi-parent `depends_on` arrays with `> 1` parent and detects dependency cycles.
   - `src/domain/orders/order-state.ts`: pure transition guards for `OrderPlan` (`activate`, `retry`, `complete`, `cancel`) and `WorkOrder` (`resume`, `reset_to_scratch`, `reopen`, `complete`, `cancel`, `pause`, `unpause`, `reprioritise`).
2. **Contracts (`src/contracts/`)**:
   - `order-plans.contract.ts`: `POST /api/v1/order-plans` (creates plan + optional `plan_branch` init `Job`), `GET /api/v1/order-plans`, `GET /api/v1/order-plans/:id`, `POST /api/v1/order-plans/:id/transitions`.
   - `work-orders.contract.ts`: `POST /api/v1/work-orders`, `GET /api/v1/work-orders` (filter by `projectId`, `planId`, `lineName`, `state`, `pinnedCellId`), `GET /api/v1/work-orders/:id` (with `steps`, `jobs`, `incidents`), `POST /api/v1/work-orders/:id/transitions`.
   - `queue.contract.ts`: `GET /api/v1/queue/export`, `POST /api/v1/queue/import` (`mode: 'dry_run' | 'apply'`, idempotent via `commandId`), `POST /api/v1/queue/actions` (`pause`, `unpause`, `reprioritise`, `reset_to_scratch`, `cancel`).
3. **Procedures (`src/application/procedures/{order-plans,work-orders,queue}/`)**:
   - Execute all mutations inside `immediateTx(ctx.db, ...)`.
   - On `OrderPlan` activation (`branching`), enqueue a `plan_branch` `Job` (`status: 'ready'`).
   - On `POST /api/v1/queue/import` (`mode: 'apply'`):
     - Upsert `OrderPlan`s for referenced `plan:` slugs.
     - Create new `WorkOrder`s (`projectId:slug`) in `queued` or `waiting_parent` per `resolveBaseBranch`.
     - Update existing `WorkOrder`s in `waiting_parent | queued | paused | line_unavailable` (clearing `unavailable_line_cells_json` if `line_name` changed).
     - Skip structural edits on `running | delivering | delivered | completed` orders (applying only `priority` or `status: cancelled` overrides).
     - Record `state_transitions` and call `ctx.claimWaiters.wakeAll()` + `ctx.transitionBus.publish(...)` after commit.
4. **Routes (`src/adapters/hono/routes/`)**:
   - `order-plans.route.ts`, `work-orders.route.ts`, `queue.route.ts` mounted under `/api/v1/*`.
5. **Tests**:
   - Unit tests (`src/domain/topology/__tests__/resolve-base-branch.test.ts`, `src/domain/queue/__tests__/todo-markdown.test.ts`): all 5 branch topology cases, markdown parse/format round-trip, cycle & multi-parent rejection.
   - Black-box HTTP tests (`test/blackbox/plans-orders-queue.test.ts`): `dry_run` vs `apply` import, idempotent `commandId` replay, export -> import round-trip, stacked child waiting in `waiting_parent`, and bulk `/queue/actions`.

---

## ✅ Acceptance Criteria

- [ ] `resolveBaseBranch` satisfies all 5 scenarios in `PLAN.md` §6.1 with 100% unit test coverage.
- [ ] `POST /api/v1/queue/import` supports `dry_run` and `apply`, enforces single-parent `depends_on` without cycles, pins `projectId` and `line_name`, and wakes `claimWaiters` on commit.
- [ ] `GET /api/v1/queue/export` renders clean `todos/<slug>.md` markdown that round-trips through `/queue/import` with zero state drift.
- [ ] `POST /api/v1/queue/actions`, `/api/v1/order-plans/*`, and `/api/v1/work-orders/*` transitions work end-to-end and record `state_transitions`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
