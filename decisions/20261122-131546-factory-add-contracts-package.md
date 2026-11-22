---
scope: factory/contracts
summary: Move factory wire contracts and enums into a package
why: sf and cell kept hand copies of factory API shapes and enums, drift had no compile error
date: 2026-11-22
tags: [contracts, factory, package]
---

- `packages/factory-contracts` (`@repo/factory-contracts`): subpath exports `./*` to `src/*.ts`, no barrel. Deps: `zod`, `@repo/zod-contract-kit`.
- Moved 9 `*.contract.ts` and `common.ts` (`projectIdSchema` only) from `apps/factory/src/contracts/`. Zod schemas unchanged.
- `src/enums/orders.ts`: plan and work-order states, actions, priorities, order types. `src/enums/events.ts`: entity types, actor kinds. `src/enums/incidents.ts`: incident reasons, statuses.
- Each enum constant defined once, in the package.
  - Factory domain (`order-state`, `events`, `incident-rules`, `todo-markdown`) imports constants from it.
  - DB schema (`orders`, `plans`, `incidents`, `transitions`) imports constants from it.
  - Domain keeps derived types and transition logic.
- Factory imports `@repo/factory-contracts/<name>.contract` in 30 src files and 1 test. `apps/factory/src/contracts/` deleted, dead `contracts` eslint rules removed.
- Package tests: defaults applied, enum values rejected, apply needs `commandId`, stream `afterSeq` coerced.
- Factory check-types, lint and tests (292) pass with no assertion changes.
- sf copies untouched; adoption is follow-up `sf-adopt-factory-contracts`.
