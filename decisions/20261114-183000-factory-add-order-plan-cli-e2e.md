---
scope: factory
summary: Order Plan CLI, end-to-end test and opt-in auto-merge docs
why: Supervisors must see a stack's chain, and real Cells must prove three stacked PRs complete one plan PR
date: 2026-11-14
tags: [v2, order-plan, cli, e2e, docs]
---

- CLI (`apps/cli`): `factory plan ls` and `factory plan status <slug> [--project <id>] [--json]`.
  - Both read `supervisor/plans` and `supervisor/plan`, so socket, remote (HTTP) and `--once` share one path.
  - The slug resolves through the `plans` list. Unique slugs need no flag; an ambiguous slug without `--project` is a usage error.
  - Renderers in `render/plan.ts`: the chain line `wo-1 [merged] -> wo-2 [delivered, PR into factory/wo-1] -> ...`, per-member base and PR, the plan PR line, and the Andon with `factory resume|cancel <planId>`.
- End-to-end test: `apps/cell/src/__tests__/distributed/order-plan.test.ts`, not `apps/server`.
  - It needs real Cell processes, so it runs in the distributed suite with the bare remote, real git and the fake `gh`.
  - A merge is `git merge --no-ff` into the bare remote (squash for the plan PR), then the PR state is written as `MERGED`. A merge deletes the head branch and retargets the PRs that targeted it, as GitHub does.
  - The scripted builder adds `a.txt`, `b.txt`, `c.txt` and logs what its worktree held, so the test checks each base.
  - Passed 20 consecutive runs.
- Found while testing: a runtime bug in the member command id.
  - It was `<orderId>:<lastSeq>:plan`. Once `lastSeq` reached two digits, `wo-1:12` matched the host:port check of `isMachineIndependentText`.
  - The PR poll and intake passes then failed on every tick. The id is now `<orderId>#<lastSeq>:plan` (`plan-commands.ts`, `intake.ts`).
- Test harness: `FACTORY_PR_POLL_MS` is a new timing knob (unset means the 5 min default).
  - `createWorld` takes `bare` and `env`.
  - The fake `gh` now answers `--base`, `--draft`, `pr ready`, `pr edit` and `--json isDraft`.
- Docs: `docs/ORDER-PLAN.md` §6 gets the CLI usage and the output of the e2e run.
  - §7 is the opt-in auto-merge workflow (`factory/*` into `feat/*` only, merge commit, `--auto`).
  - The workflow is a copy-only example and is not enabled.
- Remote mode is covered by a process test against a fake HTTP server (bearer token, `plan ls`, `plan status`, `--json`), not by a live `factory-server`.
