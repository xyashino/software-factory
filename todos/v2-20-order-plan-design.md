---
status: todo
priority: medium
depends_on: []
workflow: standard
---

# v2-20: Order Plan design (docs only)

## Objective

Specify the **Order Plan**: a chain of Work orders `WO_1 -> WO_2 -> WO_3` declared with `plan: xyz`
in their todos, built as a stack of PRs on a plan branch `feat/xyz`, with one PR `feat/xyz -> main`
opened by the Factory automatically. This todo changes docs only; v2-21 … v2-23 implement it.

## Target shape

```
main
 └─ feat/xyz                      ← plan branch, created by the Factory from project.baseBranch
     ├─ WO_1  factory/wo-1  → PR into feat/xyz
     ├─ WO_2  factory/wo-2  → PR into factory/wo-1 (into feat/xyz once WO_1 is merged)
     └─ WO_3  factory/wo-3  → PR into factory/wo-2 (…)
 feat/xyz → main: draft PR opened once WO_1 is merged into feat/xyz; marked ready when all are merged
```

## Read first

- `docs/CORE.md` §3.3, §4.1, §5, §6, §8, §10, §11
- `docs/PROTOCOL.md` §4, §5, §8, §10
- `docs/STORAGE.md` §4, §6, §8
- `docs/OPEN-QUESTIONS.md` Q4, Q12
- `docs/RULES.md` §2.4

## Decisions to write down

1. **Declaration.** Optional todo frontmatter `plan: <slug>` (`^[a-z0-9][a-z0-9-]{0,63}$`). The plan
   branch is `feat/<slug>`. Plan todos live on `project.baseBranch` (intake reads them there as today).
2. **Linear chain.** Within one plan every Work order has at most one `depends_on` entry from the same
   plan, and exactly one Work order (the root) has none. A branch, a cycle, or a dependency on a todo
   of another plan is an intake diagnostic (`plan_invalid`); no Work order is created for that plan
   until it is fixed. Dependencies outside the plan keep the normal rules.
3. **Stacked dependency.** An in-plan predecessor is satisfied when `delivered` and its PR is not
   `closed`; a predecessor PR closed unmerged makes the dependent `deps_broken`. This replaces
   `depPolicy` for in-plan dependencies (record as a new OPEN-QUESTIONS entry next to Q4).
4. **Base of a plan Work order** (resolved by the runtime when it builds a job, not stored):
   - root, or predecessor `merged` → `feat/<slug>`;
   - predecessor `delivered` and not merged → `factory/<predecessorTodoId>`.
   First jobs use it as `branch_base`; the deliver job rebases onto it and opens the PR against it.
5. **Merge strategy.** Sub-PRs into `feat/<slug>` are merged with a merge commit and the head branch
   is deleted on merge. GitHub then retargets the next PR to `feat/<slug>` and the delivered commit
   stays the same, so the stack does not conflict. Squash is only for the final PR into `main`.
   Document the required repository settings.
6. **Order Plan aggregate.** A plan has its own Traveler (stream id `PlanId = <projectId>:plan:<slug>`)
   and is driven by `decide` / `nextJob` like a Work order (RULES §1.2). Events, at least:
   `plan_created { projectId, slug, branch, baseBranch }`, `plan_branch_created { commit }`,
   `plan_pr_opened { prUrl }`, `plan_pr_ready`, `plan_completed`, `plan_cancelled`. State and projection
   (`plans` table) carry members in chain order, branch state and PR state.
7. **Plan jobs** (PROTOCOL §4), claimed and fenced like any job (lease plus epoch):
   - `plan_branch`: create `feat/<slug>` from `origin/<baseBranch>` if absent (idempotent), push.
     Runs before the root Work order's first job; the root is not claimable until the branch exists.
   - `plan_pr`: open (or find) the draft PR `feat/<slug> -> <baseBranch>` once the root is `merged`;
     its body lists the sub-PRs.
   - `plan_pr_ready`: mark the PR ready once every member is `merged`.
   PR state of the plan PR is polled like Work order PRs; `merged` yields `plan_completed`.
8. **Reopen inside a stack.** CORE §8 stands: a reopened predecessor does not stop a started
   dependent. If the rewritten predecessor makes the dependent's delivery rebase conflict, the deliver
   job reports `delivery_failed` and the Andon goes to the Supervisor. No automatic restack in v2.0.
9. **Todo removal.** Each sub-PR removes its own todo on `feat/<slug>`; the todos leave `main` with the
   final PR. Intake must not report delivered/merged plan Work orders whose unchanged todo is still on
   `main` as `reused_id`.
10. **Versioning.** New optional fields (`plan` on `order_created`) are not a version bump (CORE §11);
    the plan events are new types.

## Deliverables

- CORE: Order Plan section (aggregate, events, `decide` / `nextJob` rules, stacked dependency in §8,
  invariants: one PR per member, plan PR never opened before the root is merged).
- PROTOCOL: §4 new job kinds and the plan base in the deliver job; §8 refs `feat/<slug>`; §10 CLI
  `factory plan ls | status`.
- STORAGE: `plans` projection table; `orders.plan` column.
- OPEN-QUESTIONS: stacked dependency, merge strategy, no automatic restack.
- WORKFLOW.md: a short Order Plan section linking to a dedicated guide
  (`docs/ORDER-PLAN.md`) with the end-to-end flow and the GitHub settings it needs.
- `decisions/` entry.

## Acceptance criteria

- Every decision above is in CORE / PROTOCOL / STORAGE with no contradiction to the existing text.
- v2-21 … v2-23 can be implemented from the docs alone.
