---
status: todo
priority: medium
depends_on: []
line: feature
type: feat
---

# Todo: Simplify the todo commands to `factory todos import` and `factory todos export`

## 🎯 Objective

Replace `factory todos migrate --project <id> ...` with `factory todos import`, which runs inside the repo and needs no flags. Add `factory todos export`, which writes the server's todos back to `todos/`.

---

## 🌐 Context & Problem Statement

Today the only todo command is `factory todos migrate` (`apps/cli/src/commands/todos.ts`, usage in `apps/cli/src/usage.ts`). It needs `--project <id>` on every run, even though the command is always run from inside the repo whose `todos/` it reads. It also has `--dir`, `--repo-dir` and `--register` flags that most runs don't need.

Nothing exports work back. Once a todo is imported, the server is the only place that has its state, and there is no command that writes it back to `todos/`.

The name `migrate` describes a one-time move, but the command is run again for every new todo, so `import` is the better name.

---

## 📦 Specification / Scope

- **Target**: `apps/cli/src/commands/todos.ts`, `apps/cli/src/usage.ts`, `apps/cli/src/commands/migration.ts`, and `apps/cli/src/__tests__/` (migration and process tests).
- **Classification**: `Integration`
- **Dependencies**: the project registry (`projectList`, `projectAdd`) and the board/order reads already used by `migrate`.

Decisions to confirm before implementing:

1. **Project id.** Option A: derive it from the repo's `.factory/config.json` `projects` key (`apps/cell/src/config.ts`). Option B: derive it from the `origin` repo name. This todo assumes A, with `--project` kept as an override.
2. **Export format.** `export` writes one `todos/<id>.md` per work order, with frontmatter from the order's state (status, priority, line, depends_on, plan, type). Option A: overwrite existing files. Option B: write only files that don't exist and report the rest. This todo assumes B.

---

## 🛠️ Implementation Plan

1. **`factory todos import`**:
   - Runs in the repo root; the project id comes from the decision above.
   - Same behaviour as `migrate`: dry run by default, `--apply` to create the orders. Keep `--remove` (delete the file after the server confirms it).
   - Drop `--dir`, `--repo-dir` and `--all`. Keep `--project` as an override and `--json`.
2. **`factory todos export`**:
   - Reads the project's work orders and plans from the server.
   - Writes `todos/<todoId>.md` for each order that has no file, with frontmatter and the spec body.
   - Reports every order it skipped, and why.
3. **Remove `migrate`**: keep it as a hidden alias for one release that prints a deprecation line pointing to `import`.
4. **Usage and docs**: update `apps/cli/src/usage.ts`, `docs/` references and `setup-factory` SKILL.md.

---

## ✅ Acceptance Criteria

- [ ] `factory todos import` run in a repo imports its `todos/` without any flag, and defaults to a dry run.
- [ ] `factory todos import --apply` creates the orders; a second run creates nothing.
- [ ] `factory todos export` writes a file for each order that has none, and lists the orders it skipped.
- [ ] A round trip (export, then import on a clean server) recreates the same orders.
- [ ] `migrate` still works and prints a deprecation line.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
