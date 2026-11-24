---
status: queued
priority: high
line: feature
type: feat
plan: web-eda
---

# web-navigation-and-overview: add app navigation shell and overview EDA module

## Objective

Add multi-page navigation to `apps/web` and implement `src/modules/overview/` as the landing dashboard showing live HQ health counts and escalated Andon alerts.

## Context

`apps/web` currently mounts only `src/modules/work-orders/` at `/` and `/work-orders` using RxJS EDA (`src/libs/eda/eda.ts`), TanStack Router (`src/core/app-router/router.ts`), Tailwind v4 semantic tokens, and shadcn/ui primitives. All new modules must mirror `src/modules/work-orders/` (`configuration/`, `domain/`, `core/`, `integration/`, `presentation/`).

## Scope

- **Target**: `apps/web/src/core/app-router`, `apps/web/src/modules/overview`, `apps/web/src/pages/api`, `apps/web/src/server/factory-client.ts`, `apps/web/test`
- **Classification**: `Feature`, `Frontend`
- **Out of scope**: Full CRUD pages for incidents, plans, factories, and tokens (separate todos in `plan: web-eda`).

## Implementation Plan

1. **BFF (`apps/web/src/server/factory-client.ts`, `apps/web/src/pages/api/`)**:
   - Extend `createFactoryClient` with `listFactories`, `listIncidents`, and `listOrderPlans` using `@repo/hq-contracts`.
   - Add `GET /api/overview` (parallel `Promise.all` of work orders, incidents, factories, plans) returning `Cache-Control: private, no-store`.
2. **Navigation Shell (`apps/web/src/core/app-router/shell.tsx`, `router.ts`)**:
   - Add responsive sidebar/top navigation with links for Overview (`/`), Work Orders (`/work-orders`), Incidents (`/incidents`), Plans & Queue (`/plans`), Factories (`/factories`), and Tokens (`/tokens`).
   - Keep live SSE status badge and dark mode toggle in header; center content on x-axis per UI rules.
3. **Overview EDA Module (`apps/web/src/modules/overview/`)**:
   - Implement 5-layer RxJS EDA slice (`TRIGGER`/`TASK`/`FACT`/`EFFECT`) loading `/api/overview` and refreshing silently on SSE `work_order`, `incident`, and `factory` transitions via `watchDataChanges`.
   - Display summary cards (queued/running/blocked work orders, open/escalated incidents, online factories), escalated Andon alert banner linking to `/incidents`, skeleton, error+retry, and empty states.
4. **Tests**:
   - Add MSW black-box tests in `apps/web/test/blackbox/overview.test.tsx` covering initial load, escalated alert banner, error+retry, and navigation.

## Acceptance Criteria

- [ ] `/` renders the Overview dashboard and `/work-orders` renders the Work Orders module via TanStack Router.
- [ ] Navigation works across mobile (`320px`) and desktop (`1440px`) viewports with full keyboard navigation and ARIA labels.
- [ ] Overview refreshes silently on SSE transitions without hiding rendered cards.
- [ ] MSW black-box tests pass with no `fetch` stubbing.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] `bun run ci:verify` passes.
