---
status: todo
factory: v2
plan: operator-cli
priority: high
line: feature
type: feat
---

# Todo: `step-01-operator-protocol-package` — Operator Protocol Package

## 🎯 Objective

Create `packages/operator-protocol` with one zod contract per operator verb and the reply shapes, so the CLI and the Cell parse the same wire format.

---

## 🌐 Context & Problem Statement

- The operator CLI (`apps/operator`) and the Cell endpoint (`apps/cell/src/operator-socket.ts`) must agree on the request body and the reply codes.
- Schemas must not live in an app, because apps may not import each other (boundary rules).
- Blocked on two decisions in `apps/operator/docs/PLAN.md` §9 and the open questions below. Do not start until they are answered.

**Open before starting**

1. CLI package name: `operator` (docs) or `factory-operator` (current code).
2. Protocol location: new `packages/operator-protocol`, or inside `packages/factory-core`. This spec assumes the new package.

---

## 📦 Specification / Scope

- **Target**:
  - `packages/operator-protocol/package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`
  - `packages/operator-protocol/src/constants.ts`: `MAX_BODY_BYTES = 1024 * 1024`, verb names, role names, reply codes
  - `packages/operator-protocol/src/replies.ts`: reply shapes for `200`, `400` (`invalid`), `401` (`unauthorized`), `409` (`rejected`, `stale_epoch`, `not_live`, `precondition`), `500` (`internal`)
  - `packages/operator-protocol/src/verbs/operator.contract.ts`: `done`, `verdict`, `block`, `context`
  - `packages/operator-protocol/src/verbs/mechanic.contract.ts`: `read`, `incident`
  - `packages/operator-protocol/src/__tests__/contracts.test.ts`
- **Boundary**: `packages/operator-protocol/` only. No `process`, `node:fs`, `node:net`, or network code. Schemas and constants only.
- **Classification**: `Unit`.
- **Dependencies**: `zod: catalog:`, `typescript`, `eslint`, `vitest`, `@types/node` as devDependency only, all via `catalog:`.
- **Contract source**: `apps/operator/docs/PLAN.md` §3 (verbs and options), §4 (reply and exit codes), and `apps/cell/src/operator-socket.ts` (reply codes already sent).

---

## 🛠️ Implementation Plan

1. Scaffold the package with the same tooling as other workspace packages.
2. Write `constants.ts` first: verb names, role names (`operator`, `mechanic`), reply codes, body limit.
3. Write `replies.ts`: one zod schema per reply code, with `ok` discriminant.
4. Write the operator contracts: `done` (no fields), `verdict` (`pass` | `fail` with `feedback` text), `block` (`reason`, `handover` text), `context` (no fields).
5. Write the mechanic contracts: `read` (no fields), `incident` (`action` enum of the five values, optional `step`, required `diagnosis`, `outcome`, `report`). Do not make `diagnosis` and `outcome` required until PLAN §3.2 confirms it (see step-05).
6. Every body schema is `.strict()` and includes the `verb` literal and the `token` field.
7. Tests: each contract accepts a valid body and rejects an unknown verb, a missing required field, and an extra field.

---

## ✅ Acceptance Criteria

- [ ] Every verb in PLAN §3 has exactly one contract.
- [ ] Extra fields are rejected by every body schema.
- [ ] Unit tests cover valid body, unknown verb, missing required field, extra field.
- [ ] No `process`, `node:fs`, or `node:net` import in `packages/operator-protocol/src`.
- [ ] No barrel `index.ts`; no `any`.
- [ ] `pnpm --filter @repo/operator-protocol check-types`, `lint`, `test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
