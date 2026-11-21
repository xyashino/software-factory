---
status: queued
priority: high
line: standard
type: refactor
---

# operator-retire-app-and-protocol: remove dead operator app and protocol package

## 🎯 Objective

Delete `apps/operator` and `packages/operator-protocol`. `sf operator` stays the only operator implementation, with one contract in `apps/sf`.

---

## 🌐 Context & Problem Statement

Verified:
- `apps/operator/src/cli.ts`: `REGISTERED_VERBS = []`. Verb files exist, none registered. `package.json` has no `bin`. Program name still `factory-operator`.
- Nothing imports `@repo/operator`. Only `apps/operator` imports `@repo/operator-protocol`.
- `sf` has the full replacement: `adapters/cli/operator.command.ts`, `adapters/operator-client/{client,exit-map}.ts`, `application/procedures/operator/*`, `adapters/operator-endpoint/loopback.ts`, `contracts/operator.contract.ts`. Client and Cell loopback server are both in `sf`, so no second consumer for a shared package.
- Contracts drifted. Protocol: `.strict()` objects, token length 16-256, verdict feedback max 65536, `MAX_BODY_BYTES` 1 MiB. sf: `token: z.string().trim().min(1)`, no limits.
- Wire differs. sf client sends `authorization: Bearer <token>` plus `token` in body. Old client sends token in body only.
- `apps/sf/test/unit/contracts/drift.test.ts` reads `apps/operator/docs/PLAN.md` for the operator contract pair. Deleting docs breaks it.
- Old docs claim "the Cell imports the protocol": no longer true.

---

## 📦 Specification / Scope

- **Target**: `apps/operator`, `packages/operator-protocol`, `apps/sf`, root `README.md`, `pnpm-lock.yaml`
- **Classification**: `Infrastructure`
- **Dependencies**: none new
- Out: renaming `FACTORY_CYCLE_TOKEN` / `FACTORY_OPERATOR_URL` (breaking, separate decision), root README terminology, other docs moves.

---

## 🛠️ Implementation Plan

1. **Compare before deleting**: diff `packages/operator-protocol/src/{constants,replies}.ts` and `verbs/*.contract.ts` against `apps/sf/src/contracts/operator.contract.ts` and the loopback handler. List every constraint sf lacks.
2. **Adopt stricter rules in sf contract** (`.strict()`, field limits, body cap) only after checking real token length: read how the Cell issues the job token (`run-job.procedure`, factory token generation). If real tokens are shorter than 16 chars, keep sf min and record why. Decide body cap in loopback.
3. **Port test gaps**: old `client.test.ts` covers timeout, non-JSON reply, reply shape not matching status, undefined status, one request when unreachable, missing env/invalid URL sends nothing; `exit-codes.test.ts` covers exit mapping. Check `apps/sf` unit/blackbox tests; add missing cases to `apps/sf/test/` (black box, AAA, story names).
4. **Keep still-valid rules and docs**: `git mv apps/operator/docs/PLAN.md apps/sf/docs/OPERATOR.md` (later moved to `docs/operator.md` by `docs-restructure-root`). Move into it 4 lines of rules worth keeping: thin client, localhost only, never write token to disk or logs, one request no retry. Move the glossary table from operator `README.md` (the only glossary in the repo) into `OPERATOR.md`. Then delete operator `README.md` and `IMPLEMENTATION_RULES.md` (rest is app-specific to the removed app).
5. **Repoint**: `apps/sf/test/unit/contracts/drift.test.ts` operator pair to `apps/sf/docs/OPERATOR.md`; `apps/sf/docs/PLAN.md` operator doc links; root `README.md` table rows for `apps/operator` and `packages/operator-protocol`.
6. **Delete** `apps/operator`, `packages/operator-protocol`. Run `pnpm install` (lockfile loses both importers). Do not edit `decisions/` history.

---

## ✅ Acceptance Criteria

- [ ] `apps/operator` and `packages/operator-protocol` gone; `pnpm-lock.yaml` has no entry for either.
- [ ] `grep -rIn "operator-protocol\|apps/operator\|@repo/operator" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=decisions` returns nothing (docs/plans and todos updated).
- [ ] sf operator contract limits decided and recorded in ADR (adopted or kept loose with reason).
- [ ] Every old `apps/operator` test behavior covered in `apps/sf/test/` or noted as intentionally dropped.
- [ ] `drift.test.ts` passes after repoint.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
