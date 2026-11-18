---
status: todo
factory: v2
plan: factory-cli
depends_on: [cli-04-server-client-and-server-commands]
priority: high
line: feature
type: feat
---

# Todo: `cli-05-todos-and-queue` — `factory todos` and `factory queue`

## 🎯 Objective

Move Work order definitions between `todos/*.md` and the server, and show or change the live queue.

---

## 🌐 Context & Problem Statement

- `todos/*.md` is the human-editable source. The server stores the live state. `todos import` pushes files to the server; `todos export` writes the server state back to files (factory-server PLAN §5).
- `queue` is the live view and the bulk actions. It never writes files.
- `projectId` comes from `.factory/config.json` (`"project"`), not from a flag. A mismatch is an argument error.
- Bulk actions change many Work orders at once. `cancel` must be explicit, so a typo cannot cancel the queue.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/src/application/procedures/todos/`, `procedures/queue/`, `adapters/cli/todos.command.ts`, `adapters/cli/queue.command.ts`, `adapters/fs/todo-files.ts`, `domain/repo-config/`, `domain/todo/`.
- **Classification**: `Domain Core` (parsing) and `Integration` (routes).
- **Files to create**:
  - `src/domain/repo-config/parse-repo-config.ts` (reads `.factory/config.json`: `project`, `rules`, `skills`)
  - `src/domain/todo/parse-todo.ts` (frontmatter: `status`, `priority`, `line`, `plan`, `depends_on`, `type`; body kept as-is)
  - `src/domain/todo/render-todo.ts` (inverse of parse, for export)
  - `src/adapters/fs/todo-files.ts` (list and write `todos/*.md`)
  - `src/application/procedures/todos/import.procedure.ts`, `export.procedure.ts`
  - `src/application/procedures/queue/list.procedure.ts`, `actions.procedure.ts`
  - `src/adapters/cli/todos.command.ts`, `queue.command.ts`
  - `test/unit/domain/parse-todo.test.ts`, `render-todo.test.ts`
  - `test/blackbox/todos-queue.test.ts`
- **Dependencies**: none added.

---

## 🛠️ Implementation Plan

1. **Domain (pure)**:
   - `parse-todo`: split frontmatter, validate `status` in `todo | in_progress | done`, `priority` in `high | medium | low`, `line` non-empty. Unknown keys are kept, not dropped.
   - `render-todo`: writes frontmatter in a fixed key order, then the body. Round trip `parse -> render -> parse` gives the same object.
2. **`factory todos import [--dir todos] [--dry-run]`**:
   - Reads `.factory/config.json` for `project`.
   - Parses every `todos/*.md`, skips files without `line`, reports them.
   - `POST /api/v1/queue/import` with `projectId`, the list, and a `commandId`.
   - `--dry-run` prints what would be sent and sends nothing.
3. **`factory todos export [--dir todos] [--force]`**:
   - `GET /api/v1/queue/export?projectId=...`.
   - Writes one file per Work order. Refuses to overwrite an existing file unless `--force`. Lists refused files.
4. **`factory queue [--state] [--line] [--plan]`**:
   - `GET /api/v1/work-orders` and `GET /api/v1/order-plans`, filters passed as query.
   - Table: id, state, line, priority, plan, active cell. `--json` for scripts.
5. **`factory queue pause|unpause|reprioritise|reset|cancel <orderIds...>`**:
   - `POST /api/v1/queue/actions` with `{ action, orderIds, priority? }`. `reprioritise` requires `--priority high|medium|low`.
   - `reset` maps to the server action `reset_to_scratch`.
   - `cancel` requires `--yes`. Without it, exit `2` with the list it would cancel.
6. **Errors**: a `409` from import (conflicting slug) is printed per file, and the rest of the batch is reported.

---

## ✅ Acceptance Criteria

- [ ] `parse -> render -> parse` round trip keeps every field, including unknown keys.
- [ ] `todos import --dry-run` sends no request.
- [ ] `todos import` sends one request with `projectId` from `.factory/config.json`.
- [ ] `todos export` does not overwrite an existing file without `--force`.
- [ ] `queue cancel` without `--yes` sends no request and exits `2`.
- [ ] `queue reprioritise` without `--priority` exits `2`.
- [ ] `queue` never writes a file (test checks no fs write call).
- [ ] No barrel file; no `any`.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence recorded per [evidence](.agents/skills/evidence/SKILL.md): import dry-run and queue output.
