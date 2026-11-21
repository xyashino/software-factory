---
status: queued
priority: medium
line: standard
type: feat
---

# zod-contract-kit-package: pure contract types and reply parsing

## 🎯 Objective

Create `@repo/zod-contract-kit`: contract types, shared field schemas, `errorResponse`, client `parseReply`. Cell and factory drop their identical `schema/types.ts`.

---

## 🌐 Context & Problem Statement

`schema/types.ts` byte-identical in cell and factory. `errorResponse` duplicated in both `contracts/common.ts`. Clients (sf `mapReply`, web-demo `factory-client`) parse replies by hand, no contract. Kit must be client-safe: no Hono, no `BaseError`, no server runtime. See `docs/contracts-plan.md`.

---

## 📦 Specification / Scope

- **Target**: `packages/zod-contract-kit`, `apps/cell`, `apps/factory` (type imports only)
- **Classification**: `Universal Tooling`
- **Dependencies**:
  - `zod: catalog:`
  - dev: `@types/node: catalog:`, `eslint: catalog:`, `typescript: catalog:`, `vitest: catalog:`, `@repo/eslint-config: workspace:*`, `@repo/typescript-config: workspace:*`
- Out: `withZodSchema` (server-side, future `server-kit`), error classes, Hono, domain enums, DTOs.

---

## 🛠️ Implementation Plan

1. **Initialize File Structure** (mirror `packages/operator-protocol`):
   - `package.json` (`@repo/zod-contract-kit`, `exports {"./*": "./src/*.ts"}`, scripts `check-types`, `lint`, `test` = `bun --bun vitest run`), `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`.
   - `src/types.ts`, `src/http-status.ts`, `src/reply.ts`, `src/fields.ts`, tests in `src/__tests__/`.
2. **Core Logic & Behavior**:
   - `http-status.ts`: `HttpStatus` union = factory set (200 201 400 401 403 404 409 413 422 500) + cell set (502).
   - `types.ts`: move `ContractIn`, `ZodContract`, `ProcedureResponse` (uses kit `HttpStatus`), `RawInput`, `ContractInput` from `schema/types.ts` unchanged.
   - `reply.ts`: `errorResponse` (from `contracts/common.ts`). New `parseReply(contract, status, json)`: pick `contract.out[status]`, `safeParse`, return `{ ok: true, value }` or `{ ok: false, reason: 'undeclared-status' | 'invalid-body', status, issues? }`. Never throws, no I/O.
   - `fields.ts`: `idParams`, `idSchema(brand)`, `paginationIn`, `pageOut(item)`, `slugSchema`, `titleSchema` from factory `contracts/common.ts`. `projectIdSchema` stays in factory-contracts.
3. **Exports & Integration**:
   - Cell + factory: delete `src/application/core/schema/types.ts`; update importers (`zod.ts`, `procedure.ts`, hono adapter, procedures) to `@repo/zod-contract-kit/types`. `error-handling.ts` `HttpStatus` import from kit; keep `BaseError` etc. in app.
   - Cell + factory `contracts/common.ts`: import `errorResponse` from kit, delete local copy. Factory `fields` helpers: import from kit, delete local copies.
   - Add `@repo/zod-contract-kit: workspace:*` to both apps (`linkWorkspacePackages: false`), `pnpm install`.
   - `parseReply` has no consumer yet; adoption is a follow-up.

Tests (black box, AAA, story names):
- `parseReply` returns value for declared status with valid body.
- Returns `undeclared-status` for status not in `out`.
- Returns `invalid-body` with issues for body not matching schema.
- `errorResponse` builds schema for given code + type literal.
- `paginationIn` coerces and applies defaults; `pageOut` wraps items.
- Type test: `ContractInput` infers params/query/body from a sample contract.

---

## ✅ Acceptance Criteria

- [ ] Package has no Hono, no `BaseError`, no `node:`/`bun:` imports (client-safe).
- [ ] No `schema/types.ts` left in cell or factory; no local `errorResponse` or duplicated field helpers.
- [ ] `parseReply` never throws; covered by 3 outcome tests.
- [ ] Cell and factory tests pass unchanged in behavior.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
