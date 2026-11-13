---
status: todo
priority: high
depends_on: [v2-02-core-events-state]
workflow: feature
---

# v2-03: Core decisions — commands, decide, nextJob, Cycle context

## Objective

Implement the decision half of `factory-core`: the command catalogue, `decide` with every
precondition and error, the `nextJob` decision table, and `resolveCycleContext`.

## Read first

- `docs/CORE.md` §5 (commands, the `question_abandoned` rule, §5.3 table), §6 (decision table and
  its notes on row order), §7
- v1 for reference only: `packages/software-factory/src/engine/{next-action,context,actions}.ts`

## Scope (ROADMAP items)

`factory-m1-decide`, `factory-m1-next-job`, `factory-m1-context`.

## Deliverables

1. `src/order/commands.ts`: every command of CORE §5.2 with zod schemas, plus `DomainError`.
2. `src/order/decide.ts`:
   - every row of CORE §5.2 with its actor and preconditions;
   - epoch fencing (`stale_epoch`), liveness (`not_live`), `RecordUsage` without epoch;
   - `question_abandoned` appended for every command whose events end a Cycle with an open question;
   - `Resume` defaults `grantRetries` to 1 for `retries_exhausted` and rejects 0;
   - `Answer` accepts an abandoned, unanswered question.
3. `src/order/next-job.ts`: rows 1–16 of CORE §6 in that order; budgets from §5.3
   (`maxRestarts`, `maxLostRestarts`, `onFail.max + retryGrants`).
4. `src/order/context.ts`: `resolveCycleContext` (CORE §7) — relative `.cell/inputs/...` paths,
   feedback whenever `pendingFeedback` targets the Station, resume / handover / restart sections,
   `priorQuestions`.

## Out of scope

Test harness and property tests (v2-04), queue selection (v2-06).

## Acceptance criteria

- `decide`: a test per command for success and for every error code it can return.
- `nextJob`: a test per table row, plus tests proving row order (row 4 before job rows, row 5
  before rows 6–13).
- `context`: tests for first, retry, restart, handover, resume (with and without `fromCycle`).
- `pnpm turbo check-types lint test` green.
