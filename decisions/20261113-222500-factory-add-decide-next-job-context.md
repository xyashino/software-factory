---
scope: factory/core
summary: Add decide, nextJob and resolveCycleContext
why: Decide, nextJob and context are pure over folded state; every CORE 5-7 row gets a test
date: 2026-11-13
tags: [v2, core, decide, factory]
---

- Branch fast-forwarded to main first: v2-02 (events, state, evolve) is merged as #11; the old unmerged branch is not used
- Command catalogue: 24 commands of CORE 5.2 as one strict zod union on `type` in `commands.ts`; payloads reuse the event schemas, now exported from `events.ts`
- `DomainError` is `not_found | stale_epoch{current} | not_live{cycleId} | precondition{detail} | invalid{issues}`; `DecideContext` carries `ids`, `actor`, `epoch`, `blobs`
- Refusal order: not_found, actor, epoch fence, liveness, other preconditions, invalid payload; the first refusal wins
- Wrong actor is `precondition` (detail names the actor); payload implications (failing verdict without feedback, operator block without handover) are `invalid`
- Every blob a command names must exist (`invalid`); CompleteCycle also needs each declared artifact present and non-empty
- `question_abandoned` is emitted first for CompleteCycle, SubmitVerdict, ReportInspection, FailCycle, BlockCycle, HandOverCycle, ExpireLease, ReleaseJob and Cancel
- Fenced commands read the epoch from `ctx.epoch`; RecordUsage, Answer, Nudge, ClaimJob, Cancel, UpdateSpec and the rest are unfenced
- ClaimJob allocates the job id, then the Cycle id for Station jobs, from `ids`; StartCycle takes the job spec from `nextJob` on the state without its active job
- StartCycle: a concrete job base must equal the command's `baseCommit`; a `branch_base` job takes the command's commit
- Resume: `grantRetries` defaults to 1 for `retries_exhausted` with `retry_station`; 0 is `invalid`; `restart_from` must name a Station of the Line
- Reopen refuses a merged PR; Answer accepts an open question or an abandoned, unanswered one
- Station gains optional `verdict`, `artifacts` (default []) and `exec` (names from PROTOCOL 4); additive, no version bump (CORE 11)
- `nextJob`: 16 rows in order, one early return each; `retriesUsed` is checked against `onFail.max + retryGrants` of the failing Station
- Restart budget is `restartsUsed` vs `maxRestarts`; a lost Cycle counts against `lostRestartsUsed` vs `maxLostRestarts` instead
- Row 16 on a delivering Work order with no checkpoint throws: an invariant break, not a `Next` (a Line with only Inspections can reach it)
- Context paths are relative: `.worker/inputs/<station>.<key>` and `.worker/outputs/<key>`; the `.cell/` of the plan was stale, CORE 7 and PROTOCOL 4 say `.worker/`
- Context order inputs are title, body and branch (`todoId`); CORE 7 types body as text, but the spec keeps only `bodyBlob`, so the body input carries the blob and a `.worker/inputs/order.body` path
- Resume and Reopen refuse a note blob the runtime does not hold (`invalid`), like every other command that names a blob
- Context feedback is present whenever `pendingFeedback` targets the Station, whatever the cause; resume, handover and restart sections follow the cause
- Tests are black box through the public `decide`, `nextJob` and `resolveCycleContext`; shared histories live in `order/__tests__/histories.ts`
