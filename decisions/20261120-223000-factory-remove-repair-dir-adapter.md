---
scope: factory
summary: Remove unused repair-dir adapter and its unit test
why: only wrote a legacy operator-cli shim; operator commands now route through sf operator
date: 2026-11-20
tags: [cleanup, dead-code]
---

- Deleted `apps/factory/src/adapters/fs/repair-dir.ts` (`repairDirOf`, `prepareRepairDir`): zero production callers.
- Deleted `apps/factory/test/unit/adapters/repair-dir.test.ts`.
- No `apps/operator-cli` path left in `apps/factory`.
