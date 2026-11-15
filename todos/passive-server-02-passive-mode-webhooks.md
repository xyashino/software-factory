---
status: todo
priority: high
depends_on: [passive-server-01-api-contracts]
line: feature
factory: v2
plan: passive-server
---

# passive-server-02: Passive server mode, lazy reaper, and GitHub webhook

## Objective

Allow `factory-server` to run in pure passive mode (`FACTORY_PASSIVE=1`) as a state-and-queue store with zero background polling loops, no `git` or `gh` CLI dependencies, lazy lease expiration, and an authenticated GitHub `pull_request` webhook.

## Read first

- `packages/factory-runtime/src/composition.ts`, `open-runtime.ts`, `reaper.ts`, `pr-poll.ts`, `operations.ts`
- `apps/server/src/main.ts`, `runtime-config.ts`, `http/app.ts`
- `docs/PROTOCOL.md` (§3, §5.4)

## Deliverables

1. **Passive runtime configuration (`packages/factory-runtime`, `apps/server`):**
   - Support `FACTORY_PASSIVE=1` (and allow `0` for `FACTORY_INTAKE_POLL_MS`, `FACTORY_PR_POLL_MS`, `FACTORY_REAPER_MS` in `runtime-config.ts` / `RuntimeConfig`).
   - When `FACTORY_PASSIVE=1` is set, default `intakePollMs`, `prPollMs`, and `reaperMs` to `0` (unless explicitly overridden) so the server starts no periodic `intake`, `pr poll`, or `reaper` timers and never invokes `git` or `gh`.
2. **Lazy lease expiration (`packages/factory-runtime`):**
   - When `reaperMs === 0`, run `reapOnce` lazily inside `claim` (before `selectClaimable`) and `board` reads (or when `now` advances past an active lease's `expiresAt`), so dead Cell leases return to the queue without a background timer.
3. **GitHub PR webhook (`apps/server`, `packages/factory-core`):**
   - Add `POST /v1/webhooks/github` in `apps/server/src/http/app.ts` (outside `supervisor`/`cell` bearer auth, authenticated via `X-Hub-Signature-256` HMAC-SHA256 against `GITHUB_WEBHOOK_SECRET`).
   - Handle `pull_request` events (`opened`, `reopened`, `closed` with `merged: true | false`) by matching open Work orders and Order Plans by `prUrl` and submitting `RecordPrState` / `RecordPlanPrState` idempotently.
   - Return `401` on missing/invalid signature when `GITHUB_WEBHOOK_SECRET` is set, and `503` / `not_configured` if the webhook endpoint is hit without a configured secret.
4. **Tests & ADR:**
   - Tests for `FACTORY_PASSIVE=1` startup without `git`/`gh`, lazy lease expiration on `claim` and `board`, and `POST /v1/webhooks/github` HMAC verification + state transitions (`open` -> `merged`/`closed`).
   - One `decisions/` ADR entry documenting passive server mode and webhook-driven PR state.

## Acceptance criteria

- [ ] `factory-server` with `FACTORY_PASSIVE=1` starts cleanly without `git` or `gh` installed and runs no background poll loops.
- [ ] Expired Cell leases are reclaimed lazily on `claim` and `board` when `reaperMs === 0`.
- [ ] Signed GitHub `pull_request` webhooks update order/plan PR state and unblock dependent orders.
- [ ] `pnpm ci:verify` passes.
