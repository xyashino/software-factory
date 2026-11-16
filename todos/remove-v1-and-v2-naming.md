---
status: todo
priority: medium
depends_on: []
---

# Todo: Remove the v1 package and the v2 naming

## 🎯 Objective

Finish removing `packages/software-factory` (v1) and every v2 marker: the `factory: v2` todo keyword, the `schemaVersion: 2` Line key, and the "v2" framing in docs and code. The product is now just software-factory at version zero.

---

## 🌐 Context & Problem Statement

v1 (`packages/software-factory`, the `sf` CLI) is retired. Its only purpose was to share the repo with v2 during the M9 trial, and that split is over. The `factory: v2` todo gate (`docs/TRIAL.md`, `FACTORY_V2_ONLY`) and the `schemaVersion: 2` Line key exist only to tell the two generations apart. Left in place, they make a new contributor read the code as two products. Their presence also blocks the cleanup: the factory-core, runtime and db eslint rules still forbid importing a package that no longer exists.

Work already done in the working tree (uncommitted, branch `main`):

- `packages/software-factory` deleted (`git rm -r`).
- `schemaVersion` key removed from `.factory/lines/*.yml`, `packages/factory-definitions/starter/.factory/lines/*.yml`, the valid fixture line, `line-schema.ts` (`lineFileSchema`), `schemas/line.schema.json`, `apps/server/src/testing/serve-fixture.ts`. Its tests now expect `unknown key` for a `schemaVersion` line.
- `factory: v2` gate removed from `packages/factory-definitions/src/todo.ts` (field and zod literal), `todo-scan.ts` (`TodoScanOptions`, `requireV2`, and the scan's 5th argument), `packages/factory-runtime/src/ports.ts` (`v2Only`), `apps/server/src/runtime-config.ts` (`FACTORY_V2_ONLY`) and its test.
- `apps/cli/src/commands/migration.ts`: `all` input, `requireV2`, and the "not factory: v2" skip loop removed. `apps/cli/src/commands/todos.ts` `--all` flag and `apps/cli/src/usage.ts` updated. Tests removed in `apps/cli/src/__tests__/migration.test.ts` and `tasks.process.test.ts`.

The tree does not type-check yet. These still reference removed code:

- `packages/factory-definitions/src/__tests__/todo-v2-filter.test.ts` (uses `requireV2`): delete the file.
- `packages/factory-definitions/src/__tests__/todo.test.ts`: the `reads factory: v2 and leaves it unset otherwise` test (uses `factory`): delete it.

---

## 📦 Specification / Scope

- **Target**: repo root (`package.json`, `README.md`, `.prettierignore`, `.vscode/settings.json`, `pnpm-lock.yaml`), `docs/`, `.nitpick/skills/setup-factory/SKILL.md`, `todos/`, `packages/factory-definitions`, `packages/factory-runtime`, `packages/factory-core`, `packages/factory-db`, `apps/*`.
- **Classification**: `Infrastructure` / `Repository hygiene`
- **Dependencies**: none new. Lockfile changes come from removing the v1 workspace package.

Out of scope (keep as recorded history):

- Existing `decisions/*.md` entries. They are immutable records. Write one new entry for this change only.
- The `/v1/...` HTTP route prefix. It is the wire API version, not the product generation.
- The event envelope `schemaVersion: 2` (`packages/factory-core/src/order/events.ts`, the upcaster, `factory-db` `SCHEMA_VERSION`). It is persisted data. Changing it needs its own migration todo.

---

## 🛠️ Implementation Plan

1. **Finish the broken references**:
   - Delete `packages/factory-definitions/src/__tests__/todo-v2-filter.test.ts`.
   - Delete the `reads factory: v2` test in `todo.test.ts`.
   - Check `todo-plan.test.ts` and `check.ts` still compile against the new `scanTodos` signature.
2. **Remove the v1 package wiring**:
   - Root `package.json`: drop the `sf`, `sf:run`, `sf:status`, `sf:reset` scripts.
   - `.prettierignore`: drop the `packages/software-factory/...` line.
   - `.vscode/settings.json`: drop the `packages/software-factory/schemas/workflow.schema.json` mapping.
   - `README.md`: drop the v1 lines and the `packages/software-factory` table row. Rename the "(v2)" heading.
   - Regenerate `pnpm-lock.yaml` with `pnpm install` (the v1 importer is gone).
3. **Remove the `@repo/software-factory` import guards**: the `group: ['@repo/software-factory', ...]` entries in `apps/{cell,cli,server,operator-cli}/eslint.config.mjs` and `packages/{factory-core,factory-db,factory-definitions,factory-runtime}/eslint.config.mjs`. Also remove the `boundaries.test.ts` cases that import `@repo/software-factory/engine` in those packages (in `apps/*` and `packages/factory-*`). Drop the "v2 packages must not import the v1 package" messages with them. Update `docs/RULES.md` line 56.
4. **Remove the `factory: v2` trial**:
   - Delete `docs/TRIAL.md`. Remove its row from the `docs/README.md` index.
   - Remove `factory: v2` from `todos/factory-server-layered-api.md`.
   - In `.nitpick/skills/setup-factory/SKILL.md` drop the `sf`/v1 line and the `factory: v2`/`FACTORY_V2_ONLY` line.
   - Remove the `todo-scan.ts` and `todo.ts` comments that mention the trial (`ROADMAP M9`).
5. **Remove the `schemaVersion` Line key from docs**: `docs/STRUCTURE.md`, `docs/CORE.md` and `docs/ROADMAP.md` mentions of the Line `schemaVersion`. Keep event-envelope mentions (see Out of scope).
6. **Remove v1 provenance comments** (`(v1 ...)`, `v1 PR format`, `ported from v1`, `as v1 did`) in `packages/factory-core`, `packages/factory-runtime`, `apps/cell`, `apps/cli`, `apps/server`. Rewrite each comment to describe the behaviour itself, or delete it if it adds nothing.
7. **Rewrite "v2" framing in `docs/`**: `README.md`, `ROADMAP.md`, `PROTOCOL.md`, `STRUCTURE.md`, `PLAN.md`, `CORE.md`, `STORAGE.md`, `WORKFLOW.md`, `OPEN-QUESTIONS.md`, `ORDER-PLAN.md`, `RULES.md`. "v2 design" becomes plain description. Milestone ids like `v2-15` and `v2-02-demo` in tests and fixtures are renamed too (`packages/factory-core/src/testing/event-builders.ts`, `ids.test.ts`, `apps/cell/vitest.distributed.config.ts`).
8. **Record the change**: write exactly one new entry in `decisions/` (`factory-remove-v1-and-v2-naming`, per `.agents/rules/decision-log.md`).

---

## ✅ Acceptance Criteria

- [ ] `packages/software-factory` is gone, and no file outside `decisions/` mentions `software-factory` as a package, CLI or import path.
- [ ] `rg -i "factory: ?v2|FACTORY_V2_ONLY|requireV2|v2Only|schemaVersion: 2"` finds nothing outside `decisions/` and the event-envelope code kept under Out of scope.
- [ ] No `schemaVersion` key appears in any Line YAML, the Line JSON schema, or the Line zod schema; a Line file that has one is rejected as an unknown key.
- [ ] `todos migrate` imports every runnable todo without a flag.
- [ ] `docs/TRIAL.md` is removed and no doc links to it.
- [ ] `pnpm-lock.yaml` has no `packages/software-factory` importer.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
