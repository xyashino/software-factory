---
status: todo
factory: v2
plan: operator-cli
depends_on: [step-04-operator-operator-verbs, step-05-operator-mechanic-verbs]
priority: high
line: feature
type: test
---

# Todo: `step-06-operator-boundaries-exit-codes` — Boundary Guards and Exit-Code Coverage

## 🎯 Objective

Make the boundary rules executable, and prove each exit code end to end through the CLI.

---

## 🌐 Context & Problem Statement

- The CLI must not know about runners, agents, the factory server, or factory core rules (IMPLEMENTATION_RULES §1).
- The protocol package must stay free of I/O (IMPLEMENTATION_RULES §6).
- Every exit code in PLAN §4 needs at least one test.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/operator/src/__tests__/boundaries.test.ts`
  - `packages/operator-protocol/src/__tests__/boundaries.test.ts`
  - `apps/operator/src/__tests__/cli.test.ts`: black-box cases for exit `0`, `1`, `2`, `3`
- **Boundary**: tests only. No source changes unless a boundary test finds a real violation, which is then fixed in the step that owns that file.
- **Classification**: `Unit` for the boundary tests (static scan of import statements); `Black-box` for exit codes.

---

## 🛠️ Implementation Plan

1. `apps/operator/src/` boundary test: fail if any file imports `apps/cell`, `apps/factory-server`, or `packages/factory-*`.
2. `packages/operator-protocol/src/` boundary test: fail if any file imports `process`, `node:fs`, or `node:net`.
3. Black-box exit-code cases: `0` (accepted), `1` (refused by stub Cell), `2` (missing env var), `3` (nothing listening).
4. Check the boundary test fails when a forbidden import is added: add one by hand, watch it fail, revert.

---

## ✅ Acceptance Criteria

- [ ] Both boundary tests pass on the current code.
- [ ] Adding a forbidden import makes the boundary test fail (checked once by hand, then reverted).
- [ ] All four exit codes have a black-box case.
- [ ] `pnpm --filter @repo/factory-operator-cli test` and `pnpm --filter @repo/operator-protocol test` pass.
- [ ] One new ADR entry in `decisions/`.
- [ ] Evidence recorded per `.agents/skills/evidence/SKILL.md`.
