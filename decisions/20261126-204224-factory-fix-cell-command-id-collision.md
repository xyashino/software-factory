---
scope: factory/sf
summary: Include job id in Cell command ids so retried orders are not rejected
why: Command id hashed cell, order, epoch and action only, so a retry of an order at the same epoch reused an id HQ already held for another job and got 409
date: 2026-11-26
tags: [factory, sf, cell, transition, command-id]
---

- `commandIdOf` now hashes `cellId|jobId|orderId|epoch|command`.
  - A retried order gets a new job at the same epoch, so the old job's ids no longer collide.
  - Retries of the same job still produce the same id, so HQ replay keeps working.
- `run-job.procedure.ts` passes `job.jobId` into the hash.
- Not in this change: resuming the 8 blocked and 13 waiting work orders already on the VPS. They need `sf order resume` after this build is deployed.
- Tests: `command-id.test.ts` covers a new job on the same order and epoch; `cell-lifecycle.test.ts` expects the job id in the hash.
