---
scope: factory/sf-contracts
summary: sf imports factory contracts from the package
why: sf kept hand copies of factory contracts, drift between them had no compile error
date: 2026-11-22
tags: [contracts, sf, factory]
---

- sf `src/contracts/*` deleted except `operator.contract.ts`; `common.ts` gone. Deps: `@repo/factory-contracts`, `@repo/zod-contract-kit`.
- 18 src + 7 test imports retargeted to `@repo/factory-contracts/<name>.contract`; enums from `enums/orders|incidents`; `slugSchema`, `titleSchema` from `@repo/zod-contract-kit/fields`.
- `projectDto` exported from the package for sf add/list project.
- Drift classified, factory wins (`.notes/sf-factory-contract-drift.md`, gitignored):
  - Enums identical, import-only. Slug and id schemas identical to kit.
  - sf `.strict()` on inputs dropped: unknown keys now ignored. 9 unit assertions flipped from reject to ignore.
  - Claim reply `signals` required (factory always sends). Blackbox lifecycle fake now sends `signals: []`.
  - Run-job payload: `stepPayloadSchema` becomes `stepJobPayloadDto.partial()`; factory payloads differ per kind (step, mechanic, plan_branch).
  - Job transitions accept factory `output` and `workspaceFailed`; sf does not send them.
  - Token name is single-line (`titleSchema`); `token-create` rejects newlines; unit test added.
  - sf `errorReplies` (`invalid`, `internal`, `stale_epoch`, ...) wrong vs factory wire (`bad-request`, `stale-lease-epoch`, ...). Deleted; sf parses success codes only, no runtime change.
- Drift test keeps only the operator pair; factory pairs removed with their copies.
- Not adopted: factory-only endpoints (order-plan and work-order create/get/transition, token join/rotate/revoke), `parseReply`, cell-server calls.
- sf tests 590 pass, lint, check-types and format green.
