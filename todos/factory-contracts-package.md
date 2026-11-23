---
status: queued
priority: high
line: standard
type: feat
plan: standalone-factory
---

# factory-contracts-package: create @repo/factory-contracts for loopback API

## Objective

Create `packages/factory-contracts` (`@repo/factory-contracts`) with Zod schemas and TypeScript types for the Factory loopback HTTP API (`127.0.0.1:7072`), and wire `apps/sf` to consume it.

## Context

Part of [`docs/standalone-factory-plan.md`](../docs/standalone-factory-plan.md).

Currently, Factory loopback schemas are duplicated across `apps/sf`:

- `apps/sf/src/domain/factory/hq-state.ts` defines `HqStateSchema`, `DaemonStatusSchema`, `HqState`, `DaemonStatus`.
- `apps/sf/src/domain/factory/factory-credential.ts` defines `FactoryCredentialSchema`, `FactoryCredential`.
- `apps/sf/src/factory/routes.ts` defines `ScaleSchema` (`{ repoRoot, count, lines? }`) and `ActivitySchema` (`{ state, writes, since }`).
- `apps/sf/src/application/procedures/cell/factory-cells.ts` duplicates `ScaleSchema`, `CellStatusSchema`, `ProjectSchema`, `ProjectsReplySchema`.
- `apps/sf/src/application/procedures/factory/health.ts` parses `GET /health` `{ pid }`.

Note: `packages/factory-contracts` may exist locally as an untracked leftover directory containing only `node_modules` and `.turbo`.

## Scope

- **Target**: `packages/factory-contracts`, `apps/sf`
- **Classification**: `Domain Core`, `Integration`
- **Dependencies**: `@repo/zod-contract-kit: workspace:*`, `zod: catalog:`
- **Out of scope**: Moving `apps/sf/src/factory/*` to `apps/factory` (handled in `factory-app-extract`).

## Implementation Plan

1. **Package setup (`packages/factory-contracts`)**:
   - Create `package.json` (`name: "@repo/factory-contracts"`, `exports: { "./*": "./src/*.ts" }`, scripts `check-types`, `lint`, `test` matching `packages/hq-contracts/package.json`).
   - Create `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, and `README.md` matching `packages/hq-contracts`.
2. **Schemas (`packages/factory-contracts/src/`)**:
   - `status.contract.ts`: `HealthReplySchema` (`{ pid }`), `HqStateSchema`, `DaemonStatusSchema`, `FactoryCredentialSchema` and inferred types.
   - `scale.contract.ts`: `ActivitySchema` (`{ state: 'idle' | 'running', writes: boolean, since: number }`), `CellRecordSchema`, `ScaleRequestBodySchema` (`{ repoRoot, count, lines? }`), `ScaleReplySchema` (`{ projectId }`), `ProjectScaleSchema`, `ProjectsScaleReplySchema` (`{ projects }`), `ActivityReplySchema` (`{ cellId }`).
   - No barrel files (`coding-no-barrel-export` rule).
3. **Adopt in `apps/sf`**:
   - Add `"@repo/factory-contracts": "workspace:*"` to `apps/sf/package.json`.
   - Replace inline schemas in `apps/sf/src/factory/routes.ts`, `apps/sf/src/application/procedures/cell/factory-cells.ts`, `apps/sf/src/application/procedures/factory/status.procedure.ts`, `apps/sf/src/application/procedures/factory/health.ts`, and `apps/sf/src/domain/factory/*` with imports from `@repo/factory-contracts/*`.
4. **Tests**:
   - Add contract validation tests in `packages/factory-contracts/test/` verifying valid and invalid payloads for status, scale, and activity contracts.

## Acceptance Criteria

- [ ] `@repo/factory-contracts` exports `status.contract.ts` and `scale.contract.ts` with no barrel exports.
- [ ] `apps/sf` uses `@repo/factory-contracts` for `/health`, `/status`, `/scale`, `/cells/:cellId/activity`, and `FactoryCredential`.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes.
