---
scope: factory
summary: Add @repo/factory-contracts for factory loopback API
why: Factory loopback schemas were duplicated in apps/sf; one contract package keeps wire shapes in sync
date: 2026-11-24
tags: [factory, contracts, zod, sf]
---

- New `packages/factory-contracts` (`@repo/factory-contracts`) with Zod schemas and inferred types for `127.0.0.1:7072` loopback API.
- No barrel export: consumers import `@repo/factory-contracts/status.contract` and `@repo/factory-contracts/scale.contract`.
- `status.contract.ts`: `HealthReplySchema`, `HqStateSchema`, `DaemonStatusSchema`, `FactoryCredentialSchema` (strict where previously strict).
- `scale.contract.ts`: `ActivitySchema` (`writes` defaults to false), `CellRecordSchema`, `ScaleRequestBodySchema`, `ScaleReplySchema`, `ProjectScaleSchema`, `ProjectsScaleReplySchema`, `ActivityReplySchema`.
- `apps/sf` consumes the contracts; removed `domain/factory/hq-state.ts` and `domain/factory/factory-credential.ts`, plus local `/health`, `/scale`, `/status` and activity schemas.
- `FactoryProject` (cell listing) now equals `ProjectScale`; cell records in listing carry full wire shape (`startedAt`, `since`, `projectId`, `repoRoot`).
- Contract tests in `packages/factory-contracts/src/__tests__/` cover valid and invalid payloads through public `safeParse`.
- Setup procedure test fixture updated to full cell record shape.
