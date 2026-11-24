---
status: queued
priority: high
line: feature
type: feat
plan: web-eda
depends_on: web-navigation-and-overview
---

# web-incidents-module: add incidents Andon triage EDA module

## Objective

Implement `src/modules/incidents/` in `apps/web` so supervisors can inspect open/escalated Andon incidents and resolve them from the browser.

## Context

`apps/hq` exposes `GET /api/v1/incidents` and `POST /api/v1/incidents/:id/resolve` (`retry_step`, `restart_from_step`, `restart_from_scratch`, `escalate`, `cancel`), defined in `packages/hq-contracts/src/incidents.contract.ts`. Follow `apps/web/src/modules/work-orders/` as the exact 5-layer RxJS EDA + shadcn/ui reference.

## Scope

- **Target**: `apps/web/src/modules/incidents`, `apps/web/src/pages/api/incidents*`, `apps/web/src/server`, `apps/web/src/core/app-router/router.ts`, `apps/web/test`
- **Classification**: `Feature`, `Frontend`

## Implementation Plan

1. **BFF (`apps/web/src/server/`, `apps/web/src/pages/api/incidents*`)**:
   - Add `listIncidents` and `resolveIncident` to `createFactoryClient` using `@repo/hq-contracts/incidents.contract`.
   - Add `GET /api/incidents` (supports `?status=` and `?reason=`) and `POST /api/incidents/[id]/resolve` with `Origin` CSRF guard and Zod payload validation.
2. **EDA Module (`apps/web/src/modules/incidents/`)**:
   - `domain/`: models, event union, and pure resolution rules (`availableResolutions`).
   - `core/`: RxJS bus, store, actions, handlers (`load-list`, `resolve-incident`, `live-sync` on `incident` SSE events, `notify`), registry, facade, mediator.
   - `presentation/`: filterable incident list (by status/reason), handover/detail panel, resolution dialog (requiring confirmation for `restart_from_scratch` and `cancel`), skeleton, loading banner, normalized-filter empty state, error+retry, and toasts.
3. **Router**:
   - Register `/incidents` in `apps/web/src/core/app-router/router.ts` with `lazyRouteComponent`.
4. **Tests**:
   - Add unit tests for resolution rules and MSW black-box tests in `apps/web/test/blackbox/incidents.test.tsx`.

## Acceptance Criteria

- [ ] Supervisors can filter incidents by status/reason and inspect handover details.
- [ ] Supervisors can resolve open/escalated incidents with confirmation on destructive actions and toast feedback.
- [ ] Live SSE `incident` events refresh the list without hiding existing rows.
- [ ] Unit and MSW black-box tests pass.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
