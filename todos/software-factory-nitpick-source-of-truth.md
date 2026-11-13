---
status: todo
priority: medium
depends_on: []
type: refactor
---

# Todo: software-factory Align Rules and Skills Source of Truth with .nitpick

## 🎯 Objective

Refactor role prompts, path declarations, and validation in `@repo/software-factory` so that declared rules and skills point to their canonical source of truth in `.nitpick` (e.g. `.nitpick/skills/<id>/SKILL.md`) rather than the generated/synced output directory `.agents/`.

---

## 🌐 Context & Problem Statement

Repository rules, skills, agents, and configurations are authored and maintained within `.nitpick/` (`.nitpick/config.ts`, `.nitpick/skills/*`, `.nitpick/references/*`, `@repo/nitpick/rules/*`).
The `.agents/` folder is merely a compiled / synchronized artifact produced by `pnpm nitpick:sync` as specified in `.nitpick/config.ts` (`output: [{ path: '.agents', ... }]`).

Currently, `@repo/software-factory` points directly to `.agents/`:
1. `renderDeclarations()` in `src/prompts/build-prompt.ts` generates prompt paths pointing to `.agents/rules/<id>.md` and `.agents/skills/<id>/SKILL.md`.
2. Role prompt templates (`roles/doctor.md`, `roles/worker.md`, `roles/planner.md`, `roles/doctor-review.md`, `roles/worker-review.md`) instruct agents to inspect `.agents/rules/` and `.agents/AGENTS.md`.
3. Catalog validation in `src/definitions/validate.ts` and `src/cli/commands/check.ts` verifies rules and skills existence against `.agents/`.

This violates the single-source-of-truth principle. Agents and validation should reference the source of truth in `.nitpick` rather than build artifacts that may be out of date or regenerated.

---

## 📦 Specification / Scope

- **Target**: `packages/software-factory/{src/definitions/*,src/prompts/*,src/cli/commands/check.ts,roles/*.md,docs/DEFINITIONS.md}`
- **Classification**: Core Architecture / Agent Orchestration
- **Dependencies**:
  - `citty: catalog:`
  - `yaml: catalog:`
  - `zod: catalog:`
  - `@repo/eslint-config: workspace:*`
  - `@repo/typescript-config: workspace:*`

---

## 🛠️ Implementation Plan

1. **Definitions & Validation (`validate.ts`, `load.ts`, `check.ts`)**:
   - Update `agentsDir` / source resolution to look into `.nitpick` (e.g. `.nitpick/skills/<id>/SKILL.md` for skills).
   - Ensure rule verification checks nitpick rule sources or `.nitpick` configuration rather than `.agents/rules`.
   - Update tests in `packages/software-factory/src/definitions/__tests__/` to reflect `.nitpick` paths and fixtures.

2. **Prompt Generation (`build-prompt.ts`)**:
   - Update `renderDeclarations()` in `src/prompts/build-prompt.ts` so that:
     - Skills point to `.nitpick/skills/${id}/SKILL.md`.
     - Rules point to their canonical `.nitpick` source or referenced documentation.
   - Update prompt unit tests in `src/prompts/__tests__/build-prompt.test.ts`.

3. **Roles & Documentation**:
   - Update shipped role markdown files (`roles/doctor.md`, `roles/worker.md`, `roles/planner.md`, `roles/doctor-review.md`, `roles/worker-review.md`) to reference `.nitpick` (e.g. `.nitpick/` instead of `.agents/rules/` or `.agents/AGENTS.md`).
   - Update `packages/software-factory/docs/DEFINITIONS.md` and related docs to describe `.nitpick` as the source of truth.

---

## ✅ Acceptance Criteria

- [ ] `buildPrompt` renders skill paths pointing to `.nitpick/skills/<id>/SKILL.md` (and canonical rule paths in `.nitpick`).
- [ ] Catalog validation (`sf check` / `validateRoles`) checks rules and skills against `.nitpick`.
- [ ] Shipped roles in `packages/software-factory/roles/*.md` reference `.nitpick` instead of `.agents/`.
- [ ] Unit tests for definitions, validation, and prompt rendering pass and verify `.nitpick` paths.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
