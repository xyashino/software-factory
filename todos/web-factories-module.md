---
status: queued
priority: medium
line: standard
type: feat
plan: web-eda
depends_on: web-navigation-and-overview
---

# web-factories-module: add connected factories status EDA module

## Objective

Implement `src/modules/factories/` in `apps/web` to monitor connected Factory daemons, online/offline status, heartbeats, and attached projects in real time.

## Context

`apps/hq` exposes `GET /api/v1/factories` (`@repo/hq-contracts/factories.contract`). Follow `apps/web/src/modules/work-orders/` as the 5-layer RxJS EDA + shadcn/ui reference.

## Scope

- **Target**: `apps/web/src/modules/factories`, `apps/web/src/pages/api/factories.ts`, `apps/web/src/core/app-router/router.ts`, `apps/web/test`
- **Classification**: `Feature`, `Frontend`

## Implementation Plan

1. **BFF**:
   - Add `GET /api/factories` proxying `GET /api/v1/factories` with `Cache-Control: private, no-store`.
2. **EDA Module (`apps/web/src/modules/factories/`)**:
   - Implement 5-layer RxJS EDA slice loading factories and subscribing to SSE `factory` transitions via `watchDataChanges`.
   - UI: responsive factory cards showing name, online/offline badge, relative last-heartbeat time, and project list; skeleton, empty state, and error+retry.
3. **Router**:
   - Register `/factories` in `apps/web/src/core/app-router/router.ts`.
4. **Tests**:
   - Add MSW black-box tests in `apps/web/test/blackbox/factories.test.tsx`.

## Acceptance Criteria

- [ ] `/factories` lists all enrolled factories with online status, last heartbeat, and projects.
- [ ] Empty state and structured error+retry state match UX rules.
- [ ] MSW black-box tests pass.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
