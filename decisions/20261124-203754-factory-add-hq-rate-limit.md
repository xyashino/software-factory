---
scope: factory/hq
summary: Add per-token quota and per-IP auth-failure brake to HQ
why: Exposing HQ over Tailscale or TLS needs brute-force and runaway-loop resistance before any auth check
date: 2026-11-24
---

- Two in-memory fixed-window limits in `adapters/memory/rate-limit.adapter.ts`, one shared window store.
  - Injectable `ClockPort`, no timers: stale windows are pruned lazily once per window length.
- Auth-failure brake: `authFailureBrake` middleware keys on peer socket IP (`c.env.remoteAddress`).
  - `X-Forwarded-For` is ignored. Each 401/403 records a failure.
  - At 10 failures per 60 s the IP gets `429` with `Retry-After` before any auth check, valid tokens included.
- Per-token quota: `tokenQuota` middleware on `/api/v1/*` counts requests per bearer, default 300 per 60 s.
  - Requests with no bearer skip it and fall to the brake.
- Token keys are the first 16 hex chars of the SHA-256 already used for token storage. Plaintext tokens never enter limiter maps.
- Quota is generous, so no route is exempt. Heartbeats run every 10 s (6/min). A claim long-poll holds one request up to 25 s.
- `createApp(createTransport, limiter)` takes the limiter. `index.ts` passes `createRateLimiter(clock)`. Defaults live in `config.ts` as `DEFAULT_RATE_LIMITS`.
- 429 body matches the error shape: `{code, type: "too-many-requests", message}`.
- `test/blackbox/rate-limit.test.ts` covers brake 429 plus `Retry-After`, valid token refused from a braked IP, per-IP isolation, window recovery, per-token burst 429, per-token isolation, and quota recovery.
  - Fake clock and small limits; no real sleeps.
- Not done: no proxy-trust setting for `X-Forwarded-For`.
- Limits are per process: multiple HQ instances each keep their own counts.
- The brake also counts scope-denied 403s from valid tokens.
