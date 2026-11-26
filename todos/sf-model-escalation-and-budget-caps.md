---
status: queued
priority: medium
line: feature
type: feat
plan: universal-engine
depends_on: sf-telemetry-and-oee-stats
---

# sf-model-escalation-and-budget-caps: add retry model escalation ladder and spend guardrails

## Objective

Allow line stations to escalate runner/model across retry attempts (e.g. cheap fast model on attempt 1, stronger model on retry) and enforce per-order and daily cost/token budget caps that stop execution cleanly and open a `budget_exceeded` Andon incident.

## Context

Verified current behavior:

- `apps/sf/src/domain/line/parse-line.ts` parses a single `runner` and `model` per operator; every retry repeats the exact same model.
- `packages/hq-contracts/src/enums/incidents.ts` defines `INCIDENT_REASONS` with no `budget_exceeded` reason yet.
- `sf-telemetry-and-oee-stats` adds per-job `inputTokens`, `outputTokens`, and `costUsd` tracking.

## Scope

- **Target**: `apps/sf`, `packages/hq-contracts`, `apps/hq`
- **Classification**: `Feature`, `Domain Core`, `Safety`
- **Dependencies**: `@repo/hq-contracts: workspace:*`
- **Out of scope**: Real-time mid-prompt token kill inside closed third-party CLIs (checked at job boundaries and on runner process exit).

## Implementation Plan

1. **Model Escalation Ladder (`apps/sf/src/domain/line/parse-line.ts`, `run-job.procedure.ts`)**:
   - Extend operator config schema with optional `escalate?: { runner?: string; model: string }[]` (indexed by retry attempt; attempt 1 uses base `runner`/`model`, attempt `n > 1` uses `escalate[Math.min(n - 2, escalate.length - 1)]`).
   - Support escalation in built-in universal lines when repo/user configures a `tiers: { fast, strong }` map in config.
2. **Budget Guardrails (`apps/sf`, `apps/hq`, `packages/hq-contracts`)**:
   - Add optional `budget?: { maxOrderCostUsd?: number; maxOrderTokens?: number; maxDailyCostUsd?: number }` in `.factory/config.json` and line YAML.
   - Add `'budget_exceeded'` to `INCIDENT_REASONS` (`packages/hq-contracts/src/enums/incidents.ts`).
   - Before claiming/starting next station or retry (and after each job finishes), sum order cost/tokens and project daily cost from telemetry; if cap exceeded, halt order, release Cell, and open `budget_exceeded` incident (skipping Mechanic to avoid further spend -> `open_supervisor`).
3. **Tests**:
   - Unit tests for attempt-to-model ladder selection and budget threshold evaluation.
   - Black-box tests verifying retry attempt 2 invokes escalated model and exceeding `maxOrderCostUsd` opens `budget_exceeded` directly for supervisor without dispatching Mechanic.

## Acceptance Criteria

- [ ] Retry attempts select the configured escalated runner/model while attempt 1 uses base config.
- [ ] Exceeding `maxOrderCostUsd`, `maxOrderTokens`, or `maxDailyCostUsd` halts order, frees Cell, and opens `budget_exceeded` supervisor incident without running Mechanic.
- [ ] Lines without `escalate` or `budget` behave identically to today.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
