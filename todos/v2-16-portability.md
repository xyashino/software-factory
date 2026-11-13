---
status: todo
priority: medium
depends_on: [v2-15-distributed-hardening]
workflow: feature
---

# v2-16: Portability — backup, move between Factories, recovery from git

## Objective

Prove R1: the queue survives moving to another machine, and can be rebuilt from git when nothing
else is left.

## Read first

- `docs/STORAGE.md` §7–8, `docs/OPEN-QUESTIONS.md` Q7, `docs/ROADMAP.md` M8

## Scope (ROADMAP items)

`factory-m8-backup`, `factory-m8-move`, `factory-m8-git-recovery`.

## Deliverables

1. `deploy/`: systemd units for `factory-server` and `factory-worker`, a Litestream config example,
   a restore runbook.
2. Test: export from Factory A mid-run, import into Factory B, Workers re-join, every Work order
   completes with no duplicate work.
3. CORE amendment specifying `order_recovered { passedStations, checkpoint }` (docs change first),
   then implementation of STORAGE §8 using `Factory-Outcome: passed` trailers, with a test that
   deletes the database and recovers a mid-Line Work order.

## Acceptance criteria

- Move test and git-recovery test green in CI.
- `pnpm turbo check-types lint test` green.
