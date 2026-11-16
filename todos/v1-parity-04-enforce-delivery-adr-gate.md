---
status: todo
priority: medium
depends_on:
  - v1-parity-03-herdr-desktop-notifications
line: feature
factory: v2
plan: v1-ux-parity
type: feat
---

# v1-parity-04-enforce-delivery-adr-gate: Enforce clean-tree and configurable ADR (`decisions/*.md`) validation before delivery

## 🎯 Objective

Restore v1's pre-push `validateDeliveryState` safety gate in `apps/cell/src/jobs/deliver.ts`, verifying that zero uncommitted files remain after the delivery commit and enforcing an ADR (`decisions/*.md`) entry check when configured on the Line.

---

## 🌐 Context & Problem Statement

In v1 (`packages/software-factory/src/supervisor/validate-pr.ts`), delivery refused to push if:
1. Any uncommitted files remained in the worktree after creating the delivery commit (`uncommitted.length > 0`).
2. The task branch did not add exactly one new `decisions/*.md` ADR entry (`decisions.length !== 1`).

In v2 (`apps/cell/src/jobs/deliver.ts`), delivery records a found `decisions/*.md` file in the PR body if present, or falls back to `_No decisions/ entry recorded for this change._` and pushes anyway, and does not explicitly run a post-commit `git status --porcelain` guard before pushing.

---

## 📦 Specification / Scope

- **Target**:
  - `packages/factory-definitions/src/` (`line-schema.ts`, `line-validate.ts`, `line-snapshot.ts`, `schemas/line.schema.json`)
  - `packages/factory-core/src/` (`line/snapshot.ts`, `contracts/job.ts`)
  - `packages/factory-runtime/src/job-builder.ts`
  - `apps/cell/src/jobs/deliver.ts`
  - `.factory/lines/` (`feature.yml`, `standard.yml`, `fast.yml`)
- **Classification**: `Domain Core` / `Integration`
- **Dependencies**:
  - No new external dependencies (`zod` already in workspace).

---

## 🛠️ Implementation Plan

1. **Declarative Line Option (`deliver.requireAdr`)**:
   - Extend `deliver` schema in `packages/factory-definitions` and `LineSnapshot` in `packages/factory-core` with optional `requireAdr?: boolean` (default `false` so existing starter/generic repos remain backwards-compatible).
   - Propagate `requireAdr` into `Job['deliver']` in `packages/factory-runtime/src/job-builder.ts`.
   - Enable `requireAdr: true` in this repository's `.factory/lines/feature.yml` and `.factory/lines/standard.yml` (keep `fast.yml` opt-in/off as appropriate for trivial chores, or enable where desired).
2. **Pre-Push Delivery Gate (`apps/cell/src/jobs/deliver.ts`)**:
   - After creating the squashed delivery commit and before `git push --force-with-lease`:
     - Always run `git status --porcelain -- . :(exclude).cell` and fail delivery (`ReportDelivery{failed}`) if any uncommitted files remain.
     - Inspect added files (`git diff --name-only --diff-filter=A origin/<baseBranch>...HEAD`) matching `^decisions/.+\.md$`.
     - When `deliver.requireAdr` is `true`, fail delivery (`ReportDelivery{failed}`) with a clear message if `decisions.length !== 1` (e.g. `delivery refused: expected exactly one new decisions/ entry, found 0`).
3. **Tests & Schema Sync**:
   - Update `packages/factory-definitions/schemas/line.schema.json` and schema tests.
   - Add unit tests in `apps/cell/src/jobs/__tests__/deliver.test.ts` covering clean-tree failure, `requireAdr: true` with 0/1/2 ADR files, and `requireAdr: false`.

---

## ✅ Acceptance Criteria

- [ ] `deliver` always verifies no uncommitted files (excluding `.cell/`) remain after the delivery commit before pushing to `origin`.
- [ ] Line `deliver` definitions support `requireAdr: boolean` (validated by `factory check` and JSON schema).
- [ ] When `requireAdr: true`, `deliver` refuses to push unless the squashed diff adds exactly one `decisions/*.md` file, reporting a clear `delivery_failed` reason.
- [ ] `.factory/lines/feature.yml` and `.factory/lines/standard.yml` enable `requireAdr: true`.
- [ ] Passes verification gate (`pnpm ci:verify`).
