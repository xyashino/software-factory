---
scope: repo/sf
summary: sf matches cell-server replies to cell contracts
why: sf called cell-server with raw routes, so a contract change broke sf only at runtime
date: 2026-11-22
tags: [contracts, cell-server, sf]
---

- `apps/sf` depends on `@repo/cell-contracts` and `@repo/zod-contract-kit` (workspace).
- `checkedReply` (`procedures/cell-server/checked-reply.ts`) runs kit `parseReply` on the 200 contract, then the sf shape.
- Drifted reply throws `Unreachable` naming route and field path; no new error kind.
- Checked calls: factories list, add, default, remove; settings get, patch; status settings.
- Request bodies typed from contract `in.body` (compile time); no runtime request check.
- `probe` health call not checked: liveness only, a drifted body must not start a second server.
- Tests: drift stories for settings and factory list; valid settings reply unchanged.
- Factory test fixture gains `createdAt`/`updatedAt` required by the contract.
- Out: `mapReply` rewrite, route-typed client, factory calls.
