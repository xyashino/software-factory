---
scope: factory
summary: Order Plan design, stacked PRs on a plan branch feat/slug
why: A chain of Work orders needs one reviewable PR per step and one final PR; v2-21 to v2-23 implement it from these docs
date: 2026-11-14
tags: [v2, order-plan, docs, stacked-prs]
---

- Docs only: CORE §12, PROTOCOL §3.1/§4/§8/§10, STORAGE §4/§6, OPEN-QUESTIONS Q22-Q24, new `docs/ORDER-PLAN.md`, WORKFLOW section.
- Declaration: optional todo `plan: <slug>`, plan branch `feat/<slug>`. Chain is linear; a branch, cycle or cross-plan dependency is `plan_invalid` and creates nothing.
- Stacked dependency: in-plan predecessor is satisfied when delivered and its PR is not closed; closed unmerged gives `deps_broken`. Replaces `depPolicy` inside a plan only (Q22).
- Base is resolved per job and not stored: `feat/<slug>` for the root or a merged predecessor, else `factory/<predecessorTodoId>`. Deliver rebases onto it and opens the PR against it.
- Sub-PRs merge with a merge commit and delete the head branch, so GitHub retargets the next PR; squash only for the final PR (Q23).
- Order Plan aggregate: stream `<projectId>:plan:<slug>`, own events, `decide`, `nextJob`, `plans` projection.
  - Added `plan_member_added`, `plan_member_state_changed` and `plan_job_failed` so the plan state stays a pure function of its own events.
  - The runtime reports member states to the plan in separate transactions.
- Plan jobs `plan_branch`, `plan_pr`, `plan_pr_ready`: leased and fenced like any job, idempotent, no worktree. The plan PR never opens before the root is merged.
- No automatic restack: a conflicting rebase after a reopen is `delivery_failed` and goes to the Supervisor (Q24).
- Plan Andon is resolved with `factory resume|cancel <planId>`, no new CLI verbs. `TodoId` must not contain `:`.
- No schema bump: `order_created.plan` is optional and the plan events are new types.
