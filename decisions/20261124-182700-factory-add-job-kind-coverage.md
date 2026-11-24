---
scope: factory/sf
summary: Fail the gate when a job kind has no Cell handler
why: plan_branch jobs stayed in branching because runJob had no handler and HQ tests faked completion
date: 2026-11-24
---

- Move `JOB_KINDS` to `@repo/hq-contracts/enums/jobs`; HQ schema imports it.
- `runJob` fails a claimed job with `unknown job kind` unless it is `plan_branch` or a line job (`run_operator`, `run_inspection`, `deliver`, `mechanic`).
- Add `job-kind-coverage.test.ts`: runs `runJob` for every `JOB_KINDS` value and fails on `unknown job kind` or `job names no valid line`.
- Verified: a temporary extra kind with no handler fails the test; reverted.
- Test fixtures using legacy kinds `step` and `operator` switched to `run_operator`.
