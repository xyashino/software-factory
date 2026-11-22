---
scope: repo/zod-contract-kit
summary: Add zod-contract-kit with contract types and parseReply
why: cell and factory duplicated schema types, errorResponse and field helpers byte for byte
date: 2026-11-22
tags: [contracts, zod, kit]
---

- `packages/zod-contract-kit`: client-safe kit, subpath exports `./*` to `src/*.ts`, no barrel.
- `http-status`: `HttpStatus` = factory set + cell 502; apps import it, local unions removed.
- `types`: `ContractIn`, `ZodContract`, `ProcedureResponse`, `RawInput`, `ContractInput` moved unchanged.
- `reply`: `errorResponse` moved; new `parseReply(contract, status, json)` never throws, returns `ok` value or `undeclared-status` / `invalid-body` with issues.
- `fields`: `paginationIn`, `idParams`, `idSchema`, `pageOut`, `slugSchema`, `titleSchema` moved from factory `contracts/common.ts`.
- Cell: deleted `application/core/schema/types.ts` and `contracts/common.ts`; contracts, procedure, zod, hono adapter import kit.
- Factory: deleted `application/core/schema/types.ts`; `contracts/common.ts` keeps only `projectIdSchema`; contracts, procedures, adapter, tests import kit.
- `parseReply` has no consumer yet; sf and web-demo adoption is a follow-up.
- Behaviour of cell and factory unchanged: foundation, blackbox and contract tests pass.
