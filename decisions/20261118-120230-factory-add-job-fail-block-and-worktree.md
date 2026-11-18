---
scope: factory/server
summary: Job fail, block and worktree_missing transitions over HTTP
why: Cells must retry, rewind, stop or reset a line on failure without re-claiming, per PLAN.md 3.3, 3.4 and 6.2.
date: 2026-11-18
tags: [factory, jobs, transitions, incidents, http]
---

- `POST /api/v1/jobs/:id/transitions` also takes `fail`, `block` and `worktree_missing`, scoped to `cell:worker`, with the same `commandId` replay and `epoch` fence as `start` and `complete`.
- `fail` on a running job: failing step `failed` with `attemptsUsed` bumped, job `failed`. Retry or rewind issues the target step's next job inline on the same cell with `workspaceMode: reuse`, returned as `nextJob`. Rewind resets steps after the target up to the failing step to `pending`.
- `fail` when attempts are exhausted: order `blocked`, `active_job_id` and `active_cell_id` cleared, cell released, Incident opened with reason `step_retries_exhausted`, or `delivery_failed` on `deliver`. `workspaceFailed: true` uses reason `workspace_failed` instead.
- `block` on a running job: job and step `blocked`, order `blocked`, Incident `operator_blocked`; `handoverFile` is appended to the Incident detail.
- `worktree_missing` on a running job: `planWorktreeMissing` decides. Under the cap, order `worktreeResets` +1, all steps reset to `pending` with attempts zeroed, Step 0 job issued `workspaceMode: fresh`, returned as `resetToScratch: true, nextJob`. Over `MAX_WORKTREE_RESETS`, order `blocked` with Incident `worktree_reset_limit`.
- New Incidents are always `triageOwner: mechanic` and `status: open`; the Mechanic escalates to the Supervisor.
- `issueJob` is shared by `complete`, `fail` and `worktree_missing`; behaviour of `complete` is unchanged.
