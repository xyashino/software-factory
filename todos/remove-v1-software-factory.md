---
status: todo
factory: v2
priority: medium
line: fast
type: chore
---

# Todo: `remove-v1-software-factory` — Delete v1 package

## 🎯 Objective

Delete `packages/software-factory/` (v1 harness) and every live reference to it. v2 is the only runner after this.

---

## 🌐 Context & Problem Statement

- v1 = `packages/software-factory`: 276 files, about 19.5k lines of TS in `src/`, plus roles, workflows, templates, docs and its own tests.
- No v2 package imports it. It is referenced only by: root `sf*` scripts, `.vscode/settings.json`, `.prettierignore`, root `README.md`, `docs/`, the `pnpm-lock.yaml` importer, and eslint boundary groups plus boundary tests in v2 packages and apps.
- v1 `todos/` is absent from the working tree, so v1 picks nothing. Ported copies already live in `.factory/operators/` and `.factory/lines/`, so runtime needs nothing from v1.
- Conflict: `docs/ROADMAP.md` M9 says "v1 is frozen (kept for reference)" and `docs/README.md` calls v1 the reference implementation. This todo replaces "frozen" with "deleted". Git history keeps v1.

---

## 📦 Specification / Scope

- **Target**:
  - `packages/software-factory/` (delete whole directory)
  - `package.json` (root): remove `sf`, `sf:run`, `sf:status`, `sf:reset`
  - `pnpm-lock.yaml`: drop `packages/software-factory` importer
  - `.vscode/settings.json`: remove `yaml.schemas` entry for v1 schema; delete file if empty
  - `.prettierignore`: remove v1 fixture line and its comment
  - `README.md` (root): rewrite v1 lines (SoftwareFactory intro, package table row, `pnpm sf*` commands) to v2 only
  - `docs/README.md`, `docs/ROADMAP.md` (M0 done-when clause, M9 "frozen" line), `docs/RULES.md` (rule 4 about `@repo/software-factory`): update
  - `eslint.config.mjs` `no-restricted-imports` group `@repo/software-factory` in `packages/{factory-core,factory-db,factory-definitions,factory-runtime,prompt}` and `apps/{cell,cli,server,factory-server,operator-cli}`
  - `boundaries.test.ts` cases that import `@repo/software-factory/engine`
- **Boundary**: no logic changes in `apps/*/src` or `packages/*/src`. Only the boundary test literals.
- **Keep**:
  - `.nitpick/config.ts` scope `software-factory`: it is the project scope name
  - `.factory/`: v2 config and ported copies
  - `decisions/` and `docs/` history mentioning v1 that describes past work
- **Dependencies**: none added. Lockfile importer removed by `pnpm install`.

---

## 🛠️ Implementation Plan

1. **Delete v1**:
   - `git rm -r packages/software-factory`
2. **Root wiring**:
   - remove the four `sf*` scripts from root `package.json`
   - update `.vscode/settings.json` and `.prettierignore` as listed above
3. **Boundary guards**:
   - remove the `@repo/software-factory` restricted group from each eslint config listed above
   - remove the matching cases from each `boundaries.test.ts`
4. **Docs**:
   - rewrite root `README.md` for v2 only
   - fix `docs/README.md`, `docs/ROADMAP.md`, `docs/RULES.md` as listed above
   - check `.factory/templates/prompts/cli-guide.md` and `packages/factory-definitions/starter/.factory/templates/prompts/cli-guide.md` (`## sf commands`): point at v2 `factory` commands if they teach v1 `sf`
5. **Lockfile**:
   - run `pnpm install`; confirm `pnpm-lock.yaml` has no `packages/software-factory` importer
6. **ADR**:
   - one new entry in `decisions/` for this change

---

## ✅ Acceptance Criteria

- [ ] `packages/software-factory/` is absent from the working tree.
- [ ] `git grep -n "packages/software-factory\|@repo/software-factory" -- ':!decisions'` returns nothing.
- [ ] Root `package.json` has no `sf` scripts.
- [ ] `pnpm-lock.yaml` has no `packages/software-factory` importer and `pnpm install --frozen-lockfile` passes.
- [ ] `pnpm nitpick:check` passes.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test` pass for every package the change touches.
- [ ] `pnpm format:check` passes.
- [ ] Exactly one new ADR entry in `decisions/`.
- [ ] Evidence of the verification run recorded per `.agents/skills/evidence/SKILL.md`.
