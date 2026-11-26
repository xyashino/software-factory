---
status: paused
priority: low
line: standard
type: feat
plan: web-eda
depends_on: web-navigation-and-overview
---

# web-tokens-module: add token lifecycle management EDA module

## Objective

Implement `src/modules/tokens/` in `apps/web` so supervisors with `admin:tokens` scope can create, rotate, and revoke HQ tokens with show-once secret UX. Paused while CLI `sf hq token` covers thin-HQ token setup.

## Context

`apps/hq` exposes `/api/v1/tokens` (`POST /`, `POST /rotate`, `DELETE /:id`) in `packages/hq-contracts/src/tokens.contract.ts`. Inspired by Parka's `access-tokens` module: show the plaintext token once on creation with copy-to-clipboard, never persist or log secrets, and require confirmation before revocation. Note: auto-registered `web_session` tokens do not hold `admin:tokens`; handle `403 Forbidden` gracefully by explaining that an admin token (`HQ_TOKEN`) is required.

## Scope

- **Target**: `apps/web/src/modules/tokens`, `apps/web/src/pages/api/tokens*`, `apps/web/src/server`, `apps/web/src/core/app-router/router.ts`, `apps/web/test`
- **Classification**: `Feature`, `Frontend`, `Security`

## Implementation Plan

1. **BFF (`apps/web/src/server/`, `apps/web/src/pages/api/tokens*`)**:
   - Add token methods to `createFactoryClient` using `@repo/hq-contracts/tokens.contract`.
   - Add `POST /api/tokens` and `DELETE /api/tokens/[id]` enforcing `Origin` CSRF guard and `Cache-Control: private, no-store`.
2. **EDA Module (`apps/web/src/modules/tokens/`)**:
   - Implement 5-layer RxJS EDA slice for issuing (`factory_join`, `supervisor`) and revoking tokens.
   - UI: create-token dialog (kind, name, optional TTL), show-once secret dialog with copy button, revoke confirmation dialog, and clear `403` permission notice when running on a non-admin `web_session`.
3. **Router**:
   - Register `/tokens` in `apps/web/src/core/app-router/router.ts`.
4. **Tests**:
   - Add MSW black-box tests in `apps/web/test/blackbox/tokens.test.tsx` covering create+show-once, revoke confirmation, and `403` handling.

## Acceptance Criteria

- [ ] Supervisors can create and revoke tokens via `/tokens` with show-once secret display.
- [ ] `403` from HQ renders an actionable permission notice instead of a crash.
- [ ] Plaintext secrets are never stored in `localStorage`, URLs, or logs.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
