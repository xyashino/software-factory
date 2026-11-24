---
status: queued
priority: medium
line: standard
type: feat
---

# sf-version-drift-detection: expose HQ version endpoint and detect CLI/web drift

## Objective

Expose a build version endpoint on HQ (`GET /api/v1/version`), warn in `sf doctor` when CLI and HQ versions diverge, and display a non-blocking update banner in `apps/web` when the running server version changes.

## Context

Inspired by Parka's prerendered `/version.json` and `AppUpdateBanner` (`use-app-update.ts`). Because `sf` ships as a standalone binary while HQ and `apps/web` can run as long-lived daemons on a VPS, version drift after upgrades causes subtle contract mismatches.

## Scope

- **Target**: `packages/hq-contracts`, `apps/hq/src/adapters/hono/routes/`, `apps/sf/src/adapters/cli/doctor.command.ts`, `apps/web/src/core/app-router/shell.tsx`, `apps/web/src/pages/api/version.ts`
- **Classification**: `Feature`, `Operations`

## Implementation Plan

1. **Contract & HQ Endpoint**:
   - Add `versionContract` (`{ code: 200, version: string, protocolVersion: number }`) in `@repo/hq-contracts`.
   - Expose `GET /api/v1/version` on HQ (public or `supervisor:read` consistent with health/probe routes).
2. **`sf doctor` Check**:
   - Compare local `sf` binary version against HQ's `GET /api/v1/version` and print a warning with upgrade guidance when they differ.
3. **`apps/web` Drift Banner**:
   - Add `GET /api/version` BFF route and check on tab focus / SSE reconnect; show a dismissible refresh banner when the version changes.
4. **Tests**:
   - Add HQ black-box test for `/api/v1/version`, CLI test for `sf doctor` mismatch warning, and MSW test for the `apps/web` banner.

## Acceptance Criteria

- [ ] `GET /api/v1/version` returns current build version and protocol version.
- [ ] `sf doctor` warns clearly when CLI and HQ versions differ.
- [ ] `apps/web` shows a refresh banner when server version changes mid-session.
- [ ] Unit and black-box tests pass.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
