---
scope: factory
summary: Cell runs Order Plan jobs for branch, plan PR and ready
why: Plan jobs must be claimed, fenced and idempotent like Work orders; the Cell needs the plan wire, claim and PR poll
date: 2026-11-14
tags: [v2, order-plan, cell, git, github]
---

- Contract: `jobSchema` takes a PlanId `orderId` and the three plan kinds. A plan job has a `plan` block and no `workspace`, `station` or `deliver`; `plan_pr_ready` needs `plan.prUrl`.
  - `jobKindSchema` in `order/events.ts` stays the Work-order kinds, so an order never records a plan job.
- Wire: `submitCommand` takes two strict variants, `orderId` (Work order) or `planId` (plan). The result events carry plan events.
  - HTTP fills `planId` from the job's lease, as it fills `orderId`. No new route.
- Runtime: plan `dryRun`; the plan claim writes `ClaimJob` and its lease in one transaction; the reaper expires plan leases with `ExpireLease{jobId,epoch}`.
  - `pollPrStates` also polls plan PRs: merged completes the plan, closed raises `plan_pr_closed`.
  - Plan jobs are offered before the queue. Leases use `orderId: OrderId | PlanId`.
- Cell: `jobs/plan.ts` runs the three kinds on the bare mirror, with no worktree.
  - `plan_branch` pushes `feat/<slug>` at the base without force; a lost race is accepted when the branch descends from the base.
  - `plan_pr` finds the PR in any state or opens a draft; `plan_pr_ready` writes the body, dry-runs the report, then marks ready.
- GitHub: `findPr(head, base?)` with `--state all`, `markReady`, `updateBody` (body on stdin), with a fake keyed by head and base.
- Deliver on a stacked base needed no code change: tests cover `factory/<pred>` and `feat/<slug>`, a missing base and a rewritten predecessor.
- Leave: a leaving Cell waits up to 5 min for its plan jobs to finish, then sends `ReleaseJob{jobId,epoch}` and stops them.
- Not done: no end-to-end plan run through real orders.
