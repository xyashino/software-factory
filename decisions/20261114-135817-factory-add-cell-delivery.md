---
scope: factory
summary: Cell runs deliver jobs by rebasing, squashing and opening a PR
why: Delivery is the last Cell job and squashes the work branch onto the base, so Work orders reach delivered.
date: 2026-11-14
tags: [v2, cell, deliver, git, github]
---

- **Deliver job.** `apps/cell/src/jobs/deliver.ts` runs `deliver` jobs in the order of PROTOCOL §8.3:
  - prepare the workspace at the job base, check out the work branch tip, rebase on the base branch
  - `reset --soft` to the base, remove the todo file, commit the job's `commitMessage`
  - dry-run the push with a lease, dry-run `ReportDelivery`, push, find or create the PR, `ReportDelivery`
- **Rebase conflict.** The rebase is aborted and `ReportDelivery{failed}` carries `rebase conflict: <tail>`. Nothing is pushed and no PR is created.
- **Dry-run report names `failed`.** The PR URL does not exist before the push, so the dry run sends `failed`. The epoch and order state are checked before the result is read.
- **Stale epoch.** A `stale_epoch` answer to the dry run throws `JobStopped`. The branch is left as it was.
- **Todo path.** `removeTodo` must be relative with no `..` segment. Otherwise the job reports `ReportDelivery{failed}` before any git change, and nothing is pushed.
- **Push target.** The push goes to `job.repo.url`, not to `origin`. Found by the delivery tests: the workspace mirror is a `--mirror` clone, and git refuses an explicit refspec on a mirror remote.
- **Lease.** The push uses `--force-with-lease=refs/heads/<branch>:<tip read at checkout>`; an absent branch expects an empty value. A lease rejection reports `failed` and overwrites nothing.
- **Identity.** Rebase and the squash commit set the identity with `-c`, so the Cell needs no configured git user.
- **Reopen.** A reopened Work order builds on the delivery commit. Its rework is squashed again into one commit on the base, pushed to the same branch, and the open PR is reused.
- **Job context.** `JobContext` gains `githubFor(cwd)`. `startCell` takes an optional `githubFor`, defaulting to the `gh` adapter, so tests inject a fake GitHub.
- **Continuation not run.** A deliver job sent as the `next` of another command is not run by the claim loop yet. `runJob` drops it, as it already does for inspections.
- **All Cell job kinds wired.** `runJob` dispatches `run_inspection`, `run_operator_station`, and `deliver`. The delivery integration test still scripts Inspection and build over the socket and runs only the delivery for real.
- **Tests.** `deliver.test.ts` covers ten behaviours on real git with a fake client and fake GitHub.
  - One integration case delivers a fixture Work order end to end.
  - The scripted stations claim and complete the Inspection and the build over the socket.
  - `startCell` then claims the queued delivery and runs it. The order reaches `delivered` and `delivery_finished`.
- **Fixture continuation off.** The fixture server runs with `continuation: false`, so the command that ends the build does not lease the delivery to the scripted station. The delivery stays in the queue for the Cell's own claim loop.
- **Manual run not done.** A scratch GitHub run would create a repo and a PR under the user's account, so it waits for the user's OK. Recorded as not run.
