---
status: queued
priority: high
line: feature
type: feat
plan: universal-engine
depends_on: sf-universal-role-md-and-guards
---

# sf-telemetry-and-oee-stats: record per-job cost, PR merge outcome, and expose sf stats OEE metrics

## Objective

Capture per-job usage telemetry (`runner`, `model`, `inputTokens`, `outputTokens`, `cacheTokens`, `costUsd`, `durationMs`) and post-delivery PR/MR outcome (`prUrl`, `prNumber`, `prState`, `mergedAt`, `humanCommitsAfterDelivery`), then expose `sf stats` CLI and `/api/v1/metrics` OEE rollups for Web UI.

## Context

Verified current schema gaps:

- `apps/hq/src/db/schema/jobs.ts` stores `createdAt`, `startedAt`, `finishedAt`, `kind`, `status`, `lineName`, with no `runner`, `model`, token, or `costUsd` columns.
- `apps/hq/src/db/schema/orders.ts` stops at `state = 'delivered'` with no `prUrl`, `prNumber`, `prState`, or merge tracking columns.
- `apps/sf/src/adapters/runners/` spawns external CLIs (`claude`, `codex`, `opencode`, `antigravity`, `copilot`, `cursor`) without extracting structured token/cost telemetry into job transition payloads.
- `sf-forge-andon-issue-and-draft-pr` adds `getPrStatus` to `ForgePort`.

## Scope

- **Target**: `packages/hq-contracts`, `apps/hq`, `apps/sf`
- **Classification**: `Feature`, `Domain Core`, `Observability`
- **Dependencies**: `@repo/hq-contracts: workspace:*`
- **Out of scope**: `apps/web` `/metrics` charts UI (follow-up FE module), per-order budget circuit breakers (`sf-model-escalation-and-budget-caps`).

## Verify first

- Confirm JSON/stdout token and cost fields emitted by installed `claude`, `codex`, `opencode`, and `antigravity` CLI versions; unknown runner usage must record `null` gracefully without failing jobs.
- Confirm Postgres migration parity in `apps/hq/src/db/pg/migrations` for new `jobs` and `work_orders` columns.

## Implementation Plan

1. **Schema & Contracts (`apps/hq`, `packages/hq-contracts`)**:
   - Add nullable telemetry columns to `jobs`: `runner`, `model`, `inputTokens`, `outputTokens`, `cacheTokens`, `costUsd`, `durationMs`.
   - Add nullable delivery outcome columns to `work_orders`: `prUrl`, `prNumber`, `prState` (`open | merged | closed`), `mergedAt`, `humanCommitsAfterDelivery`.
   - Extend `packages/hq-contracts/src/jobs.contract.ts` transition payload with optional `usage` block and `pr` metadata on `deliver`.
   - Create `packages/hq-contracts/src/metrics.contract.ts` defining `GET /api/v1/metrics` (filterable by `projectId`, `since`, `lineName`) returning:
     - `firstPassYield`, `autonomousRate`, `mechanicSaveRate`, `firstPassMergeRate`
     - `totalOrders`, `deliveredOrders`, `mergedOrders`, `totalCostUsd`, `costPerMergedPr`, `wasteRate`
     - Breakdown tables by `lineName`, `stationId`, and `(runner, model)`.
2. **Runner Usage Extraction & PR Sync (`apps/sf`)**:
   - Parse runner usage metadata where available in `apps/sf/src/adapters/runners/*` (fallback `null` when unavailable) and attach to job transition.
   - Persist `prUrl` and `prNumber` on delivery.
   - Add `sf stats [--sync-prs] [--since 7d|30d] [--json]` CLI command: optionally queries `ForgePort.getPrStatus` for `delivered` orders to update `prState` / `mergedAt` / `humanCommitsAfterDelivery`, then prints OEE summary table or JSON.
3. **Tests**:
   - Unit tests for runner usage parsers and OEE metric aggregation math (FPY, autonomous rate, waste rate, cost per merged PR, zero-division guards).
   - Black-box tests covering job usage persistence, PR merge sync, `GET /api/v1/metrics`, and `sf stats --json`.

## Acceptance Criteria

- [ ] Completed and failed jobs persist `runner`, `model`, `durationMs`, and available token/cost usage.
- [ ] Delivered orders store `prUrl` / `prNumber`; `sf stats --sync-prs` updates `prState` (`open | merged | closed`) and merge metrics.
- [ ] `GET /api/v1/metrics` and `sf stats` report First-Pass Yield, Autonomous Rate, Mechanic Save Rate, First-Pass Merge Rate, Waste Rate, and Cost per Merged PR.
- [ ] Missing runner token output never fails a job.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
