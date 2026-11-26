---
status: delivered
priority: high
line: standard
type: feat
---

# hq-rate-limit-and-auth-brake: add per-token quota and per-IP auth failure brake on HQ

## Objective

Protect HQ endpoints with a two-tier in-memory rate limiter (per-token prefix quota + per-IP auth-failure brake) so exposing `HQ_HOST` over Tailscale or TLS resists brute-force and runaway client loops.

## Context

Inspired by `gon-stack/apps/parka/src/server/mcp/rate-limit.ts`. HQ currently validates bearer tokens via SHA-256 + `timingSafeEqual`, but has no request throttling or brute-force brake on `/api/v1/*` or `/api/v1/tokens/join`.

## Scope

- **Target**: `apps/hq/src/adapters/hono/middlewares.ts`, `apps/hq/src/adapters/memory/rate-limit.adapter.ts`, `apps/hq/src/app.ts`, `apps/hq/test/blackbox`
- **Classification**: `Security`, `Backend`

## Implementation Plan

1. **Rate Limiter (`apps/hq/src/adapters/memory/rate-limit.adapter.ts`)**:
   - Sliding/fixed-window in-memory limiter with injectable clock (for deterministic tests):
     - Per-token quota keyed by token prefix (never store full plaintext token in memory maps).
     - Per-IP auth-failure brake keyed by peer socket IP (ignore spoofable `X-Forwarded-For` unless explicitly trusted).
   - Periodic stale-bucket pruning to bound memory.
2. **Middleware Wiring (`apps/hq/src/app.ts`)**:
   - Apply auth-failure brake on `401`/`403` responses and return `429 Too Many Requests` with `Retry-After` once threshold is exceeded.
   - Apply per-token quota on `/api/v1/*` (exempt `/api/v1/cells/claims` long-poll wait timeouts or give heartbeats/claims generous ceilings).
3. **Tests**:
   - Add black-box tests verifying `429` + `Retry-After` on repeated invalid tokens and per-token burst overflow, plus window recovery after clock advance.

## Acceptance Criteria

- [ ] Repeated auth failures from one IP return `429` with `Retry-After`.
- [ ] Per-token burst limit triggers `429` without storing plaintext secrets in limiter keys.
- [ ] Normal Factory/Cell heartbeat and claim loops stay well below limits.
- [ ] Black-box tests pass using an injected clock (no real sleeps).
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
