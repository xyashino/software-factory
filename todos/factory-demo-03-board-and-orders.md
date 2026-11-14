---
status: todo
priority: medium
depends_on: [factory-demo-02-server-bff-client]
line: feature
factory: v2
plan: factory-demo
---

# factory-demo-03: Work orders board, live SSE feed, and order actions

## Objective

Build `orders` module in `apps/factory-demo`: live Work order board, Traveler event timeline, blob viewer, and all Supervisor order actions.

## Read first

- `packages/factory-core/src/contracts/supervisor.ts` (`boardRowSchema`, `orderDetailResponseSchema`, action schemas)
- `packages/factory-core/src/order/events.ts`, `packages/factory-core/src/order/projection.ts`
- `.agents/references/frontend-architecture.md`
- `.agents/rules/ui.md`, `.agents/rules/ux.md`, `.agents/rules/react.md`, `.agents/rules/accessibility.md`, `.agents/rules/msw-backend-mocks.md`

## Deliverables

1. **`src/modules/orders/` (`configuration/`, `domain/`, `core/`, `integration/`, `presentation/`):**
   - Event-driven `core/` (`bus.ts`, `store.ts`, `handlers/`, `facade.ts`, `mediator.ts`).
   - **Board view:**
     - Filters: `projectId`, `status`, `priority`, search query (`todoId` / `title` / `orderId`).
     - Live updates via `/api/stream` (`EventSource`) triggering incremental/debounced board & detail refresh with connection indicator.
     - Rows/cards show `orderId`, `title`, `line`, `priority`, `status`, `stationId`, `andonReason`, `plan`, `prUrl` link, `updatedAt`.
     - UX states: initial layout-matching skeleton (`ux-skeleton`), non-hiding loading banner during filter/reload (`ux-no-data-hide`), empty state (`icon:title:description:primary-action`), filtered no-results state (`No results for "<phrase>"`).
   - **Order Detail view/drawer:**
     - Board summary + open question / Andon alert banner.
     - Traveler event list (`storedEventSchema`) + on-demand blob inspection via `GET /api/blobs/[ref]`.
     - Supervisor actions with optimistic UI + toasts (`ux-optimistic-ui`):
       - `Answer` (`questionId`, `text`)
       - `Resume` (`mode`, optional `grantRetries`)
       - `Reopen` (`stationId`)
       - `Nudge` (`text`)
       - `Reprioritise` (`high | medium | low`)
       - `Cancel` (`reason`, confirmation dialog required per `ux-delete-confirmation`)
     - Error display pattern (`icon:title:tech-code:description:retry-option:back-option`), zero jumping UI, scrollable list gap (`ui-scroll-gap`).
2. **Tests & ADR:**
   - Black-box AAA tests with `msw` covering board rendering, filtering/empty states, SSE stream update, Traveler + blob load, and all 6 supervisor actions + cancel confirmation.
   - One `decisions/` ADR entry.

## Scope guardrails

- Keep all `orders` logic isolated inside `src/modules/orders/`.
- Do not build Plans, Intake, Cells, Projects, or Admin views (WO 4–5).

## Acceptance criteria

- [ ] Keyboard navigation and ARIA attributes work across filters, board rows, detail drawer, and dialogs.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `pnpm --filter @repo/factory-demo build` pass.
