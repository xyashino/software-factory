---
status: paused
priority: low
line: standard
type: feat
plan: web-eda
depends_on: web-navigation-and-overview
---

# web-request-cache: add in-flight deduplicating TTL RequestCache to apps/web

## Objective

Add a lightweight in-flight deduplicating TTL `RequestCache` with a generation counter to `apps/web/src/shared/request-cache/` so rapid tab switching does not fire duplicate BFF requests or apply stale responses after mutations. Paused until thin-HQ Web UI contracts settle.

## Context

Inspired by `gon-stack/apps/parka/src/shared/request-cache/request-cache.ts` (30s TTL + generation invalidation). As `apps/web` grows across EDA modules, navigating back and forth or receiving bursts of SSE events should deduplicate concurrent reads and invalidate cleanly on writes.

## Scope

- **Target**: `apps/web/src/shared/request-cache/request-cache.ts`, `apps/web/src/modules/*/integration/repository.ts`, `apps/web/test/unit/request-cache.test.ts`
- **Classification**: `Performance`, `Frontend`

## Implementation Plan

1. **Cache Utility (`apps/web/src/shared/request-cache/request-cache.ts`)**:
   - Implement `createRequestCache({ ttlMs })` with `getOrLoad(key, loader)`, `invalidate(prefix?)`, and a monotonic generation counter so responses that started before an invalidation never populate the cache.
2. **Wire Into Module Repositories**:
   - Use `RequestCache` for GET reads in `work-orders` (and overview) repositories; call `invalidate` on POST mutations and SSE live updates.
3. **Tests**:
   - Add unit tests covering in-flight deduplication, TTL expiration, prefix invalidation, and stale-write suppression via generation counter.

## Acceptance Criteria

- [ ] Concurrent calls with the same key share one in-flight promise.
- [ ] Mutations invalidate cached entries and prevent stale in-flight responses from overwriting fresh state.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
