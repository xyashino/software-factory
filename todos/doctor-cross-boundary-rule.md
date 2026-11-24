---
status: queued
priority: medium
line: standard
type: docs
---

# doctor-cross-boundary-rule: make the audit ask for the consumer of new job kinds and states

## Objective

Add a rule to the Doctor audit so a diff that adds a job kind, work-order state, or payload field must name the consumer that handles it, and fail if the consumer is neither in the diff nor covered by a test.

## Context

The Doctor reads only the diff and the gate result and runs no commands. It passed a change set where the HQ side of `plan_branch` existed and the Cell side did not, because nothing in the diff pointed at the missing side.

## Scope

- **Target**: `.factory/operators/doctor.md`
- **Classification**: `Documentation`, `Process`
- **Out of scope**: runtime checks, which belong in `sf-job-kind-coverage`

## Implementation Plan

1. Add a Blocking item under "Blocking vs notes" in `.factory/operators/doctor.md`: new job kind, state, or payload field with no consumer in the diff and no test that exercises it.
2. Add an Instructions step: list each new producer and find its consumer in the diff or in the context; if absent, fail with the file and line of the producer.

## Acceptance Criteria

- [ ] `doctor.md` names the producer/consumer check as a blocking item.
- [ ] The rule stays a text check and does not ask the Doctor to run commands.
- [ ] `bun run nitpick:check` still passes.
