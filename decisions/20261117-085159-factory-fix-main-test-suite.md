---
scope: factory
summary: Make the test suite pass after plan-review removal
why: Main failed pnpm test after the plan-review station was removed, so every build failed the quality gate.
date: 2026-11-17
tags: [factory, tests, upcast, line]
---

- Upcast version 2 events by dropping the retired `requires` station key, so events stored before capabilities were removed still replay.
- `command-loop` derives the station after `plan` from the shipped `feature` Line instead of naming `plan-review`.
- `leases` releases the lease with `continuation: false`, which states the rule directly instead of depending on the next station's runner.
- Shipped `feature` Line hash and the `quality-gate` index in `shipped` tests follow the Line without `plan-review`.
- Removed the scenario that needed a Cell unable to run the next station, and the two Operator verdict e2e tests that waited for `plan-review`.
