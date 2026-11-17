---
status: todo
priority: medium
depends_on: []
line: feature
type: chore
---

# Todo: Remove the v1 package `packages/software-factory`

## 🎯 Objective

Delete `packages/software-factory` and every wire that points at it.

---

## 🌐 Context & Problem Statement

v1 is retired. Its remaining references are the root `sf` scripts, the `.prettierignore` and `.vscode` entries, the README rows, the lockfile importer, and the eslint and boundary guards in the v2 packages that forbid importing `@repo/software-factory`. Those guards protect a package that no longer exists.

---

## 📦 Specification / Scope

- **Target**: `packages/software-factory/`, root `package.json`, `.prettierignore`, `.vscode/settings.json`, `README.md`, `pnpm-lock.yaml`, `eslint.config.mjs` and `boundaries.test.ts` in the v2 packages and apps, `docs/RULES.md` line 56.
- **Classification**: `Infrastructure`
- **Dependencies**: none.

---

## 🛠️ Implementation Plan

1. Delete `packages/software-factory`.
2. Remove the `sf`, `sf:run`, `sf:status`, `sf:reset` scripts from the root `package.json`.
3. Remove the `packages/software-factory` lines from `.prettierignore` and `.vscode/settings.json`, and the v1 rows from `README.md`.
4. Remove the `@repo/software-factory` restricted-import groups and the matching boundary test cases.
5. Run `pnpm install` to regenerate the lockfile without the v1 importer.

---

## ✅ Acceptance Criteria

- [ ] `packages/software-factory` does not exist.
- [ ] No file outside `decisions/` references `@repo/software-factory` or `packages/software-factory`.
- [ ] `pnpm-lock.yaml` has no v1 importer.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
