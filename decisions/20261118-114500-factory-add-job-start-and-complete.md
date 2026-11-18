---
scope: factory/server
summary: Job start and complete transitions over HTTP
why: Cells must run a whole order through steps without re-claiming, per PLAN.md 3.2-3.5 and 6.2.
date: 2026-11-18
tags: [factory, jobs, transitions, http]
---

- `POST /api/v1/jobs/:id/transitions` takes `start` or `complete`, a discriminated union on `action`, scoped to `cell:worker`.
- Every call runs in one `immediateTx`. `commandId` replays return the stored first result with no new rows.
- Fence: job must belong to the calling cell and match `epoch`, else `409 stale-lease-epoch`.
- `start` on step 0 materializes `order_steps` from `lineSnapshot`; binds the job to its step; job and step go `running`.
- `complete` on `plan_branch`: plan `active` with `branchCommitSha`, root work orders `waiting_parent` to `queued`, cell released.
- `complete` on an operator or inspection step: step and job `passed`, next job inserted `claimed` on the same cell with `workspaceMode: reuse`, and returned inline as `nextJob`.
- `complete` on `deliver`: order `delivered`, locks cleared, waiting children `queued` with `baseCommitSha`; `nextJob: null`.
- Missing `commitSha` on a complete and missing `requiredFiles` both return `422 unprocessable-entity`.
- Lease expiry is not checked here; the reaper on claim and heartbeat still marks expired jobs `lost`.
