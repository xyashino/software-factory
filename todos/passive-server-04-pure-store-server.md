---
status: todo
priority: high
depends_on: [passive-server-03-store-tasks-lines-operators]
line: feature
factory: v2
plan: passive-server
---

# passive-server-04: The server is a pure store: no intake, no git, no gh, no background loops

## Objective

Passive is the only mode, not a flag. `factory-server` holds tasks, Lines, Operators and state and answers requests; it runs no polling loops and never calls `git` or `gh`. Cells do all repository and GitHub work. PR state arrives by GitHub webhook or by API.

## Read first

- `docs/PLAN.md`, `docs/PROTOCOL.md` (§3, §3.1, §5.1, §5.4, failure matrix), `docs/STORAGE.md` (§8), `docs/WORKFLOW.md`
- `packages/factory-runtime/src/composition.ts` (`repeating` loops, `start`), `intake.ts`, `pr-poll.ts`, `reaper.ts`, `open-runtime.ts`, `ports.ts`
- `packages/factory-core/src/ports/git-mirror.ts`, PR-state port
- `apps/server/src/main.ts`, `runtime-config.ts`, `adapters/git-mirror.ts`, `adapters/*` (gh), `http/app.ts`
- `apps/cli/src/commands/sync.ts`, `packages/factory-db/src/intake-table.ts`

## Deliverables

1. **Remove server-side git and GitHub (`factory-runtime`, `apps/server`, `factory-core`):**
   - Delete intake (`intake.ts`, `sync`, `/v1/intake/sync` + socket route, `factory sync`), the `GitMirror` port and adapter, PR polling (`pr-poll.ts`, the PR-state port's `gh` adapter) and their config (`FACTORY_INTAKE_POLL_MS`, `FACTORY_PR_POLL_MS`). No `FACTORY_PASSIVE` flag is introduced.
   - Drop the `intake` table in a generated migration once nothing reads it (keep any row data needed for idempotency by moving it to `commands`, or document why it is safe to drop). Project removal no longer checks intake rows.
2. **No background timers:** remove the reaper timer and `FACTORY_REAPER_MS`. Expired leases are reaped lazily inside `claim` (before `selectClaimable`), `heartbeat`, and board/order reads, in the same write transaction semantics `reapOnce` has today. Keep boot grace: leases are not reaped until the grace after start has passed. `Runtime.start` only arms that grace.
3. **GitHub webhook (`apps/server`):** `POST /v1/webhooks/github`, outside bearer auth, verified by `X-Hub-Signature-256` HMAC-SHA256 against `GITHUB_WEBHOOK_SECRET` (constant-time compare). Handles `pull_request` `opened`/`reopened`/`closed` (`merged` true/false), matches Work orders and Order Plans by `prUrl`, submits `recordPrState` idempotently (delivery id as `commandId`). `401` on a bad signature, `503 not_configured` when the secret is unset.
4. **Tests:** server boots and serves with no `git`/`gh` on `PATH`; no timers registered after `start` except boot grace; lazy reaping on claim/heartbeat/board; webhook signature checks and state transitions that unblock `merged`-policy dependents and Order Plan PR progress.
5. **Docs & ADR:** one `decisions/` entry ("server is a pure store"); update `docs/PLAN.md` (architecture, R1 now satisfied by export/import; drop "rebuild from git"), `docs/STORAGE.md` §8, `docs/PROTOCOL.md` (routes, reaper, failure matrix), `docs/WORKFLOW.md` (intake → API).

## Acceptance criteria

- [ ] `factory-server` runs with neither `git` nor `gh` installed and starts no periodic loops.
- [ ] Dead Cells' leases return to the queue on the next claim, heartbeat or board read.
- [ ] Signed GitHub `pull_request` webhooks update order and plan PR state.
- [ ] `pnpm ci:verify` passes.
