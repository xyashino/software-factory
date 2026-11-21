---
status: queued
priority: low
line: standard
type: feat
depends_on: cell-contracts-package
---

# sf-adopt-cell-contracts: sf validates cell-server replies

## 🎯 Objective

sf types and validates its calls to cell-server with `@repo/cell-contracts`. This adds safety; it does not remove a copy.

---

## 🌐 Context & Problem Statement

sf `cell-server` procedures (`factories`, `settings`, `start`, `status`, `stop`) call `ctx.cellServer.get/post` with raw route strings, bodies unchecked. A cell contract change breaks sf only at runtime.

---

## 📦 Specification / Scope

- **Target**: `apps/sf` (`application/procedures/cell-server/*`, `adapters/http/cell-server.adapter.ts`)
- **Classification**: `Integration`
- **Dependencies**:
  - `@repo/cell-contracts: workspace:*`
  - `@repo/zod-contract-kit: workspace:*`
- Out: factory calls, `mapReply` rewrite, route-typed client.

---

## 🛠️ Implementation Plan

1. **Decide scope**: read the 5 procedures; list each request/reply and the matching contract. Skip any call without a contract; record it.
2. **Validate**: request bodies built from contract `in.body` types; replies checked with `parseReply(contract, status, json)` from kit. Invalid body maps to an existing sf error (`Unreachable`/`Refused`), no new error kinds.
3. **Tests**: sf tests with a fake cell-server returning a drifted body show a clear error.

---

## ✅ Acceptance Criteria

- [ ] Every sf cell-server call with a contract validates its reply.
- [ ] Drifted reply body yields a readable sf error, covered by test.
- [ ] No behavior change for valid replies.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
