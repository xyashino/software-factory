---
status: todo
priority: medium
depends_on: [v2-21-order-plan-core-intake]
workflow: feature
---

# v2-22: Order Plan jobs on the Cell

## Objective

Let Cells execute the plan side of an Order Plan: create `feat/<slug>`, deliver stacked Work orders
against their predecessor's branch, open the draft plan PR into the base branch after the root
merges, and mark it ready when every member is merged.

## Read first

- `docs/ORDER-PLAN.md`, PROTOCOL §4, §5, §8 as amended in v2-20
- `apps/cell/src/jobs/deliver.ts`, `apps/cell/src/workspace/prepare.ts`, `apps/cell/src/workspace.ts`
- `apps/cell/src/adapters/github/github.adapter.ts` (`createPr`, PR lookup)
- `packages/factory-core/src/contracts/job.ts`
- `packages/factory-runtime/src/pr-poll.ts`

## Deliverables

1. **Job contract:** `plan_branch`, `plan_pr`, `plan_pr_ready` job kinds in `contracts/job.ts`, fenced
   like every job (epoch on every write, RULES §3.2).
2. **`plan_branch`:** fetch; if `refs/heads/feat/<slug>` is absent create it at `origin/<baseBranch>`
   and push without force; if present, report its commit. Idempotent under retries and takeovers.
3. **Deliver with a stacked base:** `job.repo.baseBranch` may be `factory/<predecessor>` or
   `feat/<slug>`; rebase onto it, open the PR with `--base` it, remove the todo. A missing base branch
   or a rebase conflict (e.g. a reopened predecessor) reports `delivery_failed`. Tests for both bases.
4. **`plan_pr`:** find or open the draft PR `feat/<slug> -> <baseBranch>` with a body listing the
   sub-PRs; report `plan_pr_opened { prUrl }`. Idempotent: a second run finds the PR.
5. **`plan_pr_ready`:** mark the plan PR ready for review (`gh pr ready`); idempotent.
6. **GitHub adapter:** `findPr(head, base)`, `markReady(prUrl)`, `draft` support, with a fake for
   tests. The plan PR's state is polled by `pr-poll` (`merged` → `plan_completed`).

## Out of scope

- Automatic restack after a predecessor is reopened (v2-20 decision 8).
- Merging sub-PRs (done by people or the optional workflow in v2-23).

## Acceptance criteria

- Cell tests against a local bare remote: branch creation (absent / present), deliver onto
  `factory/<predecessor>` and onto `feat/<slug>`, plan PR open / find / ready with the fake GitHub.
- Retried or taken-over plan jobs never create a second branch or PR.
- `pnpm turbo check-types lint test` green.
