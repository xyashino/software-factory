# Order Plan: a stack of Work orders and PRs

An **Order Plan** delivers several Work orders as one change. The Work orders form a chain
`WO_1 -> WO_2 -> WO_3`, each is reviewed as its own small PR, and the Factory opens **one** PR for the
whole result. The contracts are in [CORE.md](CORE.md) §12, [PROTOCOL.md](PROTOCOL.md) §4 and §8,
and [STORAGE.md](STORAGE.md) §4. This page is the guide: what to write, what happens, and what
GitHub must allow.

## 1. Declare a plan

Add `plan: <slug>` to the frontmatter of each todo in the chain, and chain them with `depends_on`:

```yaml
# todos/wo-1.md
---
plan: xyz
---
# todos/wo-2.md
---
plan: xyz
depends_on: [wo-1]
---
# todos/wo-3.md
---
plan: xyz
depends_on: [wo-2]
---
```

- `slug` matches `^[a-z0-9][a-z0-9-]{0,63}$`. The plan branch is `feat/<slug>`.
- The todos live on the project's base branch (`main`), like every todo.
- The chain is linear: one root without an in-plan `depends_on`, and every other todo with exactly
  one in-plan `depends_on`. A branch, a second root, a cycle or a dependency on a todo of another plan
  makes every todo of the plan show the diagnostic `plan_invalid`, and nothing is created until you fix
  it. `depends_on` entries outside the plan work as usual.
- A todo that names a finished or cancelled plan gets `plan_closed`. Changing `plan` or the in-plan
  dependency of an existing Work order gets `plan_changed` and is ignored.
- A todo file name must not contain `:`.

## 2. End-to-end flow

```text
main
 └─ feat/xyz                      plan branch, created by the Factory from main
     ├─ WO_1  factory/wo-1  → PR into feat/xyz
     ├─ WO_2  factory/wo-2  → PR into factory/wo-1  (into feat/xyz once WO_1 is merged)
     └─ WO_3  factory/wo-3  → PR into factory/wo-2  (…)
 feat/xyz → main : draft PR, opened once WO_1 is merged; marked ready when all three are merged
```

1. **Intake** reads the three todos on `main`, creates the plan (stream `<projectId>:plan:xyz`) and
   the three Work orders in chain order.
2. A Cell runs `plan_branch`: it creates `feat/xyz` from `origin/main` if it is absent and pushes it.
   `wo-1` is not claimable before this.
3. `wo-1` runs its Line. It builds on `feat/xyz`, and `deliver` opens the PR `factory/wo-1 → feat/xyz`.
4. As soon as `wo-1` is **delivered** (PR open, not closed), `wo-2` becomes claimable. It builds on
   `factory/wo-1` (so it sees `wo-1`'s code), and delivers a PR `factory/wo-2 → factory/wo-1`. `wo-3`
   stacks on `wo-2` the same way.
5. A person (or the opt-in auto-merge workflow that v2-23 adds to this guide) **merges** the sub-PRs bottom-up, each with a **merge
   commit**, deleting the head branch. GitHub retargets the next PR to `feat/xyz`. From then on the
   Factory builds the dependents' next jobs on `feat/xyz`.
6. When `wo-1` is **merged**, a Cell runs `plan_pr` and opens the **draft** PR `feat/xyz → main`
   with a body that lists the sub-PRs.
7. When all three are **merged**, a Cell runs `plan_pr_ready`; the PR leaves draft and its body lists
   all the merged sub-PRs. The sub-PRs removed their own todos on `feat/xyz`, so the PR also deletes
   the three todos.
8. A person merges the plan PR (**squash**). The plan becomes `completed`.

The Factory never merges anything, and never deletes `feat/<slug>`.

## 3. Which base a Work order uses

The Factory resolves the base branch every time it builds a job. It is not stored.

| The Work order is…                                      | Base branch                   |
| :------------------------------------------------------ | :---------------------------- |
| the root, or its predecessor's PR is `merged`           | `feat/<slug>`                 |
| its predecessor is `delivered` and the PR is not merged | `factory/<predecessorTodoId>` |

Station jobs start from the tip of the base. `deliver` rebases onto it and opens the PR against it.

## 4. When things go wrong

| Situation                                                      | What happens                                                                                                               |
| :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| A sub-PR is closed without merging                             | The dependents become `deps_broken` and are not claimed. Fix the todos or cancel.                                          |
| A predecessor is **reopened** after its dependent started      | The dependent keeps going. If the rewritten predecessor makes its delivery rebase conflict, `delivery_failed`: Andon.      |
| A predecessor is merged and its branch is deleted mid-delivery | `delivery_failed` (base missing). `factory resume <order>` rebuilds the job on `feat/<slug>`.                              |
| A plan job fails twice                                         | Plan Andon `plan_job_failed`. Run `factory resume <projectId>:plan:<slug>`.                                                |
| The plan PR is closed without merging                          | Plan Andon `plan_pr_closed`. Run `factory resume <planId>` to open a new draft PR, or `factory cancel <planId>`.           |
| A member is cancelled                                          | Its dependents are `deps_broken`. The only repair in v2.0 is `factory cancel <planId>`, which cancels undelivered members. |

There is **no automatic restack** in v2.0: after rework of a predecessor, the Supervisor decides how
to fix the stack (OPEN-QUESTIONS Q24).

## 5. GitHub settings

The stack only works with these settings. They are repository settings; the Factory cannot set them.

| Setting                                                          | Value                                                                                                                                                                                                                                                          |
| :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General → Pull Requests → **Allow merge commits**                | On. Sub-PRs are merged with a **merge commit**.                                                                                                                                                                                                                |
| General → Pull Requests → **Allow squash merging**               | On. Used only for the final PR into `main`.                                                                                                                                                                                                                    |
| General → Pull Requests → **Automatically delete head branches** | **On.** Deleting the head branch is what makes GitHub retarget the next PR in the stack to `feat/<slug>`.                                                                                                                                                      |
| Branch protection on `main`                                      | Required checks as usual. Prefer allowing only squash merging into `main` (a ruleset on `main` limiting merge methods).                                                                                                                                        |
| Branch protection on `feat/*`                                    | Optional. If set: require the checks you want, allow **merge commits**, do **not** require linear history, do **not** block deletion of `factory/*`, allow the Cell's credential to **create and push** `feat/*` (the `plan_branch` job pushes without force). |
| The Cell's GitHub credential                                     | Can push `feat/*` and `factory/*`, open and edit PRs, and mark a PR ready for review.                                                                                                                                                                          |

Why a **merge commit** for sub-PRs: the Cell already squashed each Work order into one commit at
delivery. A merge commit keeps that exact commit in `feat/<slug>`, so the next member (built on top of
it) rebases without conflict. A squash or rebase merge would write a new commit, and every dependent
branch would conflict (OPEN-QUESTIONS Q23).

## 6. Looking at a plan

`factory plan ls` lists plans; `factory plan status <slug> [--project <id>]` shows the chain in order
with each member's board status, base branch, PR link and blocker, then the plan PR and its Andon:

```text
xyz  software-factory  pr_open
  wo-1 [merged] -> wo-2 [delivered, PR into factory/wo-1] -> wo-3 [running]
  plan PR: feat/xyz -> main (draft)
```

Both take `--json`, and give the same output over the socket, over HTTP and with `--once`
(PROTOCOL §10).
