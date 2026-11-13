---
status: todo
priority: high
depends_on: [v2-03-core-decide-next-job]
workflow: feature
---

# v2-04: Core test harness, scenarios and property tests

## Objective

Prove the core correct as a whole: a given/when/then harness, every v1 scenario rewritten on v2
events, the new v2 scenarios, and fast-check property tests for the invariants.

## Read first

- `docs/CORE.md` §10 (invariants I1–I11) and §12
- v1: `packages/software-factory/src/engine/__tests__/{scenarios.test.ts,harness.ts}` — the list of
  scenario names is the checklist

## Scope (ROADMAP items)

`factory-m1-harness`, `factory-m1-scenarios`, `factory-m1-properties`.

## Deliverables

1. `factory-core/src/testing/` (exported subpath `@repo/factory-core/testing`):
   - `given(events).when(command).then(events)` and `given(events).nextJob(expected)`;
   - a Line builder for tests;
   - in-memory fakes of `Clock` and `Ids` (store fakes come in v2-07).
2. Scenarios: every v1 scenario name has a v2 counterpart or a written reason (in the test file) why
   it no longer applies. New scenarios:
   - Andon → `resume{retry_station}` for **each** `AndonReason`;
   - `resume{restart_from}` after a blocked and after a failed Cycle (no re-raise);
   - `reopen` of a delivered Work order;
   - lost → restart; handover → continue from WIP; budget exhaustion for both;
   - question abandoned on block, then answered, then visible in the resumed context.
3. fast-check generators for command sequences against a generated Line; properties I1, I3–I9, I11.

## Out of scope

Store contract tests (I10) — v2-07.

## Acceptance criteria

- All properties green with ≥ 10 000 generated runs each (a CI-sized default may be lower; a
  documented script runs 10 000).
- The scenario checklist against v1 is complete.
- `pnpm turbo check-types lint test` green.
