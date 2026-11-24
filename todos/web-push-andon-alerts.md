---
status: queued
priority: medium
line: feature
type: feat
plan: web-eda
depends_on: web-incidents-module
---

# web-push-andon-alerts: add browser push alerts and notification center for Andons

## Objective

Notify supervisors via Web Push and an in-app notification center in `apps/web` when an incident escalates or a work order is delivered.

## Context

Autonomous runs stall silently until a human checks the CLI or dashboard. Parka implements zero-dependency WebCrypto VAPID Web Push (`RFC 8292` + `RFC 8188/8291`) and deduplicated notification records (`recordNotificationOnce`), which fits `apps/hq` (Bun WebCrypto) and `apps/web` without native dependencies.

## Scope

- **Target**: `apps/hq/src/db/schema`, `apps/hq/src/adapters/hono/routes`, `packages/hq-contracts`, `apps/web/public/sw.js`, `apps/web/src/modules/notifications`, `apps/web/src/core/app-router/shell.tsx`
- **Classification**: `Feature`, `Backend`, `Frontend`

## Implementation Plan

1. **Contracts & HQ (`packages/hq-contracts`, `apps/hq`)**:
   - Add `push_subscriptions` and `notifications` tables + Drizzle migration (with deduplication key e.g. `incident:<id>:escalated`, `order:<id>:delivered`).
   - Add `/api/v1/notifications` (`GET /`, `POST /:id/read`, `POST /read-all`) and `/api/v1/push` (`POST /subscribe`, `DELETE /subscribe`).
   - Add zero-dependency WebCrypto VAPID sender triggered when an incident escalates or a work order enters `delivered` (no-op when VAPID env keys are unset).
2. **Web Service Worker & Notifications EDA Module (`apps/web`)**:
   - Add `public/sw.js` handling `push`, `notificationclick`, and `pushsubscriptionchange`.
   - Implement `src/modules/notifications/` (5-layer RxJS EDA) with unread bell badge + popover/drawer in `AppShell`, mark-as-read actions, and push opt-in toggle.
3. **Tests**:
   - Add HQ black-box tests for notification deduplication and subscription CRUD.
   - Add MSW black-box tests for the notification drawer in `apps/web`.

## Acceptance Criteria

- [ ] Escalated incidents and delivered work orders create deduplicated notifications.
- [ ] Supervisors can view, mark read, and toggle Web Push from `AppShell`.
- [ ] Missing VAPID keys disable push cleanly without failing HQ startup.
- [ ] HQ and web tests pass.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
