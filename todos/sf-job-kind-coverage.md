---
status: queued
priority: high
line: standard
type: test
---

# sf-job-kind-coverage: fail the gate when a job kind has no Cell handler

## Objective

Every job kind HQ can create must be handled by the Cell. Add a test that fails when a `JOB_KINDS` value has no branch in `runJob`.

## Context

`plan_branch` jobs were created by HQ but `runJob` had no handler, so every plan stayed in `branching`. The HQ tests faked the completion and never noticed.

## Scope

- **Target**: `apps/sf`, `apps/hq/src/db/schema/jobs.ts`
- **Classification**: `Testing`
- **Out of scope**: the e2e flow (`sf-plan-branch-e2e`)

## Implementation Plan

1. Export `JOB_KINDS` from `@repo/hq-contracts` if it is not already exported.
2. Add `apps/sf/test/unit/application/job-kind-coverage.test.ts`: for each kind, run `runJob` with a claimed job of that kind and assert it does not return `line_unavailable: job names no valid line` or an unknown-kind error.
3. Keep it black box: public `runJob` only, no internals.

## Acceptance Criteria

- [ ] Adding a new `JOB_KINDS` value without a handler fails `bun run test` in `apps/sf`.
- [ ] Test names follow story style (`it('runs every job kind HQ can create', ...)`).
- [ ] `bun run ci:verify` passes.
