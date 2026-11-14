---
scope: factory/portability
summary: Recover Work orders from git with order_recovered, plus deploy runbook
why: Proves R1 - queue moves between Factories and resumes mid-Line from git after a lost database
date: 2026-11-14
tags: [v2, portability, recovery, deploy]
---

- CORE amendment first: `order_recovered { passedStations, checkpoint, delivery? }`, `RecoverOrder`, state `recovered`.
  - Valid only on a fresh Work order (epoch 0, no Cycle). Never writes `lastPassed`.
  - Resume is the first Station not passed, on the checkpoint commit. Recovered artifacts are not in git.
- Git port: `GitMirror.branches` (real `git log` adapter) and `PrStatePort.forBranch` (`gh pr list --head`).
- Runtime: `recoverFromGit` runs intake, then reads `factory/<todoId>` newest first for `Factory-Outcome: passed`.
  - Open or merged PR marks the order delivered. Command id `recover:<orderId>:<sha>` makes replays no-ops.
- Surface: `factory admin recover [--project]`, `factory-server admin recover`, `supervisor/admin/recover`.
- Tests: core decide and evolve, runtime recovery (fake git and PR), real-process `move` and `git-recovery` in `test:distributed`.
- `deploy/`: systemd units for server and Cell, Litestream example, `RESTORE.md`. Checked by `deploy-assets.test.ts`.
- Not done: the property generator does not yet emit `RecoverOrder`; `order_recovered` is covered by sample-based I2 and unit tests.
