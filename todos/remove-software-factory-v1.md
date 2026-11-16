---
status: todo
priority: medium
depends_on: []
line: standard
factory: v2
type: chore
---

# remove-software-factory-v1: Remove `packages/software-factory` (v1) and clean up repository

## 🎯 Objective

Delete the legacy v1 `packages/software-factory/` (`@repo/software-factory`) package completely and remove all v1 scripts, ignore/schema configs, v1-import boundary checks, and stale documentation references across the repository.

---

## 🌐 Context & Problem Statement

The v2 Software Factory (`apps/server`, `apps/cell`, `apps/cli`, `apps/operator-cli`, and `packages/factory-{core,db,definitions,runtime}`) now replaces the legacy v1 implementation in `packages/software-factory/`. Keeping `packages/software-factory/` in the workspace adds unnecessary dependencies, CI/lint/typecheck overhead, obsolete `sf*` root scripts, and v1/v2 coexistence rules (`no-restricted-imports` against `@repo/software-factory`, `boundaries.test.ts` fixtures, `.prettierignore`, `.vscode/settings.json`, and docs). Removing it leaves a clean v2-only monorepo.

Note: Historical ADR files in `decisions/` are immutable records and must **not** be edited.

---

## 📦 Specification / Scope

- **Target**: `packages/software-factory/` (delete), root workspace configs (`package.json`, `pnpm-lock.yaml`, `.prettierignore`, `.vscode/settings.json`), v2 ESLint/boundary tests, and repository docs (`README.md`, `docs/`).
- **Classification**: `Infrastructure`
- **Dependencies**:
  - None added; verify `pnpm-workspace.yaml` `catalog:` entries remain used by active workspace packages after removing `@repo/software-factory`.

---

## 🛠️ Implementation Plan

1. **Delete Legacy v1 Package & Root Scripts**:
   - Delete `packages/software-factory/` completely.
   - Remove `"sf"`, `"sf:run"`, `"sf:status"`, and `"sf:reset"` scripts from root `package.json` (retain `"factory"`, `"factory-server"`, and `"factory-cell"`).
   - Run `pnpm install` so `pnpm-lock.yaml` no longer references `@repo/software-factory`.
   - Audit `pnpm-workspace.yaml` `catalog:` and drop any dependency that was only used by `packages/software-factory` (keep shared entries like `ajv`, `citty`, `drizzle-orm`, `picocolors`, `yaml`, `zod`, `vitest` that are still used by v2 packages/apps).

2. **Clean Repository Configs**:
   - `.prettierignore`: remove `# intentionally invalid definition fixtures (software-factory tests)` and `packages/software-factory/src/definitions/__tests__/fixtures/invalid/`.
   - `.vscode/settings.json`: remove `"./packages/software-factory/schemas/workflow.schema.json": "packages/software-factory/workflows/*.yml"` from `"yaml.schemas"`.

3. **Remove Obsolete v1 Boundary Rules & Tests**:
   - Remove the `@repo/software-factory` / `@repo/software-factory/*` pattern from `no-restricted-imports` in:
     - `packages/factory-core/eslint.config.mjs`
     - `packages/factory-db/eslint.config.mjs`
     - `packages/factory-definitions/eslint.config.mjs`
     - `packages/factory-runtime/eslint.config.mjs`
     - `apps/server/eslint.config.mjs`
     - `apps/cell/eslint.config.mjs`
     - `apps/cli/eslint.config.mjs`
     - `apps/operator-cli/eslint.config.mjs`
   - Remove the `'rejects an import of the v1 package'` test case from each corresponding `src/__tests__/boundaries.test.ts` (`factory-core`, `factory-db`, `factory-definitions`, `apps/server`, `apps/cell`, `apps/cli`, `apps/operator-cli`).

4. **Update Documentation & Record ADR**:
   - `README.md`: remove the v1 `packages/software-factory` description, workspace table row, v1 prerequisites (`packages/software-factory/workflows/*.yml`), and `pnpm sf*` usage commands; document the v2 packages/apps and `factory` / `factory-server` / `factory-cell` workflow cleanly.
   - `docs/README.md`, `docs/RULES.md` (§4.4), `docs/STRUCTURE.md`, `docs/ROADMAP.md`, and `docs/TRIAL.md`: remove active v1 coexistence instructions/rules referencing `packages/software-factory` or `@repo/software-factory` (do not edit historical `decisions/*.md`).
   - If `.nitpick/skills/setup-factory/SKILL.md` is still present, remove its `sf` / v1 note (and if `todos/cleanup-outdated-skills-and-nitpick.md` is still `status: todo`, leave historical context accurate or remove broken `Read first` paths pointing to `packages/software-factory/`).
   - Add one ADR entry in `decisions/` documenting the removal of `packages/software-factory` (v1).

---

## ✅ Acceptance Criteria

- [ ] `packages/software-factory/` directory is completely removed from the repository.
- [ ] Root `package.json` has no `sf*` scripts and `pnpm-lock.yaml` is updated via `pnpm install`.
- [ ] `.prettierignore` and `.vscode/settings.json` contain no references to `packages/software-factory`.
- [ ] All v2 `eslint.config.mjs` and `boundaries.test.ts` files no longer contain `@repo/software-factory` rules or test cases.
- [ ] `README.md` and `docs/` reflect a clean v2-only repository without active `packages/software-factory` / `sf` instructions, and a new ADR exists in `decisions/`.
- [ ] No stale references to `@repo/software-factory` or `packages/software-factory` remain outside historical `decisions/*.md` (and `todos/`).
- [ ] Passes verification gate (`pnpm ci:verify`).
