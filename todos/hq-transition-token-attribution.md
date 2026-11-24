---
status: queued
priority: medium
line: standard
type: feat
---

# hq-transition-token-attribution: record token name in state_transitions audit log

## Objective

Record the human-readable token name (never the secret) on `state_transitions` rows so supervisors can audit which Factory, supervisor token, or MCP client triggered each transition.

## Context

Inspired by Parka's `time_task_history` audit trail. Today `state_transitions` records `actor_kind` and `actor_id`, but does not capture the `safe_tokens.name` label when a supervisor or MCP token mutates state.

## Scope

- **Target**: `apps/hq/src/db/schema/transitions.ts`, `apps/hq/drizzle/`, `packages/hq-contracts/src/stream.contract.ts`, `apps/hq/src/application/`, `apps/hq/test/blackbox`
- **Classification**: `Backend`, `Observability`

## Implementation Plan

1. **Schema & Contract**:
   - Add nullable `actor_label` column to `state_transitions` via Drizzle migration (`bun run db:check` clean).
   - Add `actorLabel: z.string().nullable()` to `transitionDto` in `packages/hq-contracts/src/stream.contract.ts`.
2. **Write Path (`apps/hq/src/application/`)**:
   - Pass authenticated token's `name` (from `safe_tokens`) into the auth context and persist it as `actor_label` on every transition insert.
3. **Tests**:
   - Add black-box test asserting transitions created by a named token expose `actorLabel` in `/api/v1/stream` and never leak the token secret or hash.

## Acceptance Criteria

- [ ] New Drizzle migration passes `db:check` and applies cleanly to existing DBs.
- [ ] `transitionDto` includes `actorLabel` and `/api/v1/stream` emits it.
- [ ] Token secrets/hashes never appear in `state_transitions`.
- [ ] Black-box tests pass.
- [ ] One new ADR in `decisions/`.
- [ ] `bun run ci:verify` passes.
