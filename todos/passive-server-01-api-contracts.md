---
status: todo
priority: high
depends_on: []
line: feature
factory: v2
plan: passive-server
---

# passive-server-01: API order/plan creation and optional removeTodo

## Objective

Add transport-neutral supervisor contracts and runtime handlers to create Work orders, Order Plans, and PR state updates directly via the API without reading `todos/*.md` from `GitMirror`, and make `deliver.removeTodo` optional for API-created orders.

## Read first

- `docs/PROTOCOL.md` (§1, §3, §4, §8.3)
- `packages/factory-core/src/contracts/routes.ts`, `http-routes.ts`, `supervisor.ts`, `job.ts`
- `packages/factory-core/src/order/commands.ts`, `events.ts`, `decide-lifecycle.ts`
- `packages/factory-runtime/src/operations.ts`, `job-builder.ts`, `intake.ts`, `plan-commands.ts`
- `apps/cell/src/jobs/deliver.ts`

## Deliverables

1. **Contracts (`packages/factory-core`):**
   - Add `createOrder`, `createPlan`, and `recordPrState` schemas and routes in `supervisor.ts`, `routes.ts`, and `http-routes.ts` (`POST /v1/orders`, `POST /v1/plans`, `POST /v1/orders/:id/pr-state`, all `auth: 'supervisor'`).
   - `createOrder` accepts `commandId`, `projectId`, `todoId`, `title`, `type`, `body` (markdown spec), `line`, `priority`, `dependsOn`, optional `plan`, and optional `baseBranch` (defaults to the project's `baseBranch`).
   - `createPlan` accepts `commandId`, `projectId`, `slug`, optional `baseBranch`, and an ordered list of members (with `todoId`, `title`, `type`, `body`, `line`, `priority`, `dependsOn`) validated as a linear chain.
   - Make `deliver.removeTodo` optional in `jobSchema` (`packages/factory-core/src/contracts/job.ts`).
2. **Runtime & Cell (`packages/factory-runtime`, `apps/cell`):**
   - Implement `createOrder`, `createPlan`, and `recordPrState` in `operations.ts`: store each markdown spec body in `BlobStore`, compute `contentHash`, validate `projectId` and `line`, and append events via `CommandHandler` (notifying waiting Cells).
   - Track whether an order originated from git (`todos/<todoId>.md`) or API/UI (e.g. `removeTodo?: string` on spec/job) so `buildJob` omits `deliver.removeTodo` for API-created orders, and `apps/cell/src/jobs/deliver.ts` skips deleting a todo file when `deliver.removeTodo` is undefined.
3. **Tests:**
   - Unit and integration tests covering `createOrder`, `createPlan` (including linear-chain validation and `commandId` idempotency), `recordPrState`, `buildJob` without `removeTodo`, and Cell `deliver` without a todo file in the repo.

## Acceptance criteria

- [ ] `POST /v1/orders` and `POST /v1/plans` create runnable Work orders and Order Plans without `GitMirror` or `todos/*.md` in git.
- [ ] A Cell claims, executes, and delivers an API-created Work order PR without attempting to remove `todos/<todoId>.md`.
- [ ] `pnpm ci:verify` passes.
