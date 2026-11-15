---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
type: feat
---

# Todo: Inject Resolved Rule and Skill Paths into Operator Prompts

## 🎯 Objective

Include each declared rule's and skill's repository-relative markdown path in `## Input: declared.rules` and `## Input: declared.skills` inside Cycle `prompt.md`, resolved from `.nitpick/config.ts`.

---

## 🌐 Context & Problem Statement

Currently `buildPrompt` in `packages/factory-runtime/src/prompts/build-prompt.ts` renders `declared.rules` and `declared.skills` as bare IDs only (for example `rich-commit`, `decision-log`, `testing`, `evidence`).

- Rules like `rich-commit` and `decision-log` are imported from `@repo/nitpick/rules/*` inside `.nitpick/config.ts`, so reading `.nitpick/config.ts` does not show their actual rule text — the full markdown lives in `<output>/rules/<id_or_group>.md` (`.agents/rules/*.md` in this repo).
- `packages/factory-definitions/src/nitpick-catalog.ts` already imports `.nitpick/config.ts` when `loadRepoDefinitions` runs on the Cell, so it already has the `output` directory and `rules` structure needed to resolve exact relative paths without hardcoding `.agents/`.

---

## 📦 Specification / Scope

- **Target**: `packages/factory-definitions` (`@repo/factory-definitions`), `packages/factory-runtime` (`@repo/factory-runtime`), `apps/cell` (`@repo/factory-cell`)
- **Classification**: `Integration`
- **Dependencies**:
  - `@repo/factory-core: workspace:*`
  - `@repo/factory-definitions: workspace:*`
  - `@repo/factory-runtime: workspace:*`

---

## 🛠️ Implementation Plan

1. **Resolve rule and skill paths in `packages/factory-definitions` (`nitpick-catalog.ts`, `load.ts`):**
   - Extend `NitpickCatalog` (and `Definitions`) with resolved relative path maps (`rulePaths: Map<string, string>`, `skillPaths: Map<string, string>`), derived from `.nitpick/config.ts`:
     - Primary output path: `config.output?.[0]?.path ?? '.agents'` (matching `packages/nitpick/src/docs.ts`).
     - Rules: standalone `InstructionDoc` objects (`typeof doc === 'object'`) map to `<output>/rules/<id>.md`; group keys and inline rules inside a group map to `<output>/rules/<group>.md`.
     - Skills: `.nitpick/skills/<id>/SKILL.md` (or `<output>/skills/<id>/SKILL.md` when synced).
   - Keep paths strictly repository-relative (never absolute host paths, per PROTOCOL §4).
2. **Render `id: path` in `packages/factory-runtime/src/prompts/build-prompt.ts`:**
   - Update `PromptInput['declared']` to accept resolved path maps or `{ id: string; path?: string }[]` (preserving clean fallback to bare `id` when no `.nitpick/` catalog is present).
   - Render `## Input: declared.rules` and `## Input: declared.skills` lines as `<id>: <path>` when a path is present (matching `## Input: outputs`), else `<id>`.
3. **Wire resolved paths in `apps/cell/src/jobs/render.ts`:**
   - Pass the rule and skill paths from `definitions` (`loadRepoDefinitions(worktree)`) into `buildPrompt(...)` inside `renderOperatorPrompt`.
4. **Tests & ADR:**
   - Add unit tests in `packages/factory-definitions/src/__tests__/catalog.test.ts` for group rules, standalone `InstructionDoc` rules, custom `output[0].path`, and skills.
   - Update `packages/factory-runtime/src/prompts/__tests__/prompts.test.ts` (and snapshots) plus `apps/cell` render coverage (`e2e/two-repos.test.ts` or dedicated unit test) verifying `rich-commit: .agents/rules/rich-commit.md`, `decision-log: .agents/rules/decision-log.md`, `testing: .agents/rules/testing.md`, and no absolute paths in rendered prompts.
   - Record one ADR entry in `decisions/`.

---

## ✅ Acceptance Criteria

- [ ] `## Input: declared.rules` includes the resolved relative markdown path for each declared rule/group (e.g. `rich-commit: .agents/rules/rich-commit.md`, `decision-log: .agents/rules/decision-log.md`, `testing: .agents/rules/testing.md`).
- [ ] `## Input: declared.skills` includes the resolved relative `SKILL.md` path for each declared skill (e.g. `evidence`).
- [ ] Repos without `.nitpick/` or without a matching path fall back cleanly to the bare rule/skill ID without failing prompt rendering.
- [ ] Rendered prompts contain zero absolute host paths.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
