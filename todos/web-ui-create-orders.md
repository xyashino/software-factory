---
status: todo
priority: medium
depends_on:
  [factory-demo-03-board-and-orders, passive-server-03-cli-create-and-migrate]
line: feature
factory: v2
---

# web-ui-create-orders: Create Work orders, plans, and import todos from Web UI

## Objective

Add Astro BFF endpoints and Web UI workflows in `apps/factory-demo` so operators can create Work orders, stacked Order Plans, and import markdown `todos/*.md` files directly from the browser against the passive `factory-server`.

## Read first

- `packages/factory-core/src/contracts/supervisor.ts`, `http-routes.ts`
- `todos/factory-demo-02-server-bff-client.md`, `factory-demo-03-board-and-orders.md`
- `.agents/references/frontend-architecture.md`
- `.agents/rules/astro.md`, `.agents/rules/ui.md`, `.agents/rules/ux.md`, `.agents/rules/accessibility.md`, `.agents/rules/msw-backend-mocks.md`

## Deliverables

1. **Astro BFF routes (`apps/factory-demo/src/pages/api/`):**
   - Add `POST /api/orders`, `POST /api/plans`, and `POST /api/orders/[id]/pr-state` proxying to `POST /v1/orders`, `POST /v1/plans`, and `POST /v1/orders/:id/pr-state` with `zod` validation and session auth forwarding.
2. **Web UI creation & import (`apps/factory-demo/src/modules/orders/`):**
   - Add a "New Order" drawer/modal on the Board view with fields for `projectId`, `todoId` (auto-slugged from title, editable), `title`, `type`, `line`, `priority`, `dependsOn` selector, optional `plan`, and markdown `body` editor.
   - Add a "Create Plan / Import `.md` Todos" flow allowing multi-file `.md` drop/upload (parsed client-side or validated against the server schema) to preview the plan chain/todos and submit via `POST /api/plans` and `POST /api/orders`.
   - Optimistic refresh / toast notifications and inline validation errors matching `ux.md` / `ui.md`.
3. **Tests & ADR:**
   - Black-box AAA tests with `msw` covering single order creation, plan creation, `.md` file import preview/submit, and validation error handling.
   - One `decisions/` ADR entry.

## Acceptance criteria

- [ ] Operators can create new Work orders and stacked Order Plans from `apps/factory-demo` without editing `todos/*.md` in git.
- [ ] Uploading existing `todos/*.md` files in the UI creates the corresponding orders/plans on the server.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm --filter @repo/factory-demo build` pass.
