---
status: todo
priority: medium
depends_on: []
type: feat
---

# Todo: software-factory Treat Absent Todo Files as Satisfied Dependencies

## 🎯 Objective

Update dependency resolution in `@repo/software-factory`'s supervisor (`pickTodo`) so that any dependency whose `todos/<dep>.md` file does not exist in `todos/` is treated as satisfied, matching `@repo/factory` behavior and enabling tasks to run after prerequisite todo files have been delivered and removed.

---

## 🌐 Context & Problem Statement

In `@repo/factory`, a dependency was satisfied when its todo file was either marked `done` or completely absent from `todos/` (because delivered tasks are merged and deleted).

Currently, in `@repo/software-factory` (`src/supervisor/pick-todo.ts`), `isDelivered` only treats a dependency as satisfied if:
1. `todos/${dep}.md` exists and has `status: done`, or
2. The local database `tasks` store contains a record for `todos/${dep}.md` with `task.status === 'delivered'`.

If a dependency todo file has been removed from `todos/` (or the repository is checked out fresh on a new machine without a pre-existing local SQLite database), `isDelivered` returns `false`. As a result, dependent tasks wait indefinitely with:
```text
<task>.md: waiting for <dep>
```
and are never picked.

Treating missing todo files as satisfied ensures that presence of an open todo file in `todos/` is the only condition that keeps a dependency unresolved.

---

## 📦 Specification / Scope

- **Target**: `packages/software-factory/{src/supervisor/pick-todo.ts,src/supervisor/__tests__/pick-todo.test.ts}`
- **Classification**: Infrastructure / Software Factory Engine
- **Dependencies**:
  - `@repo/eslint-config: workspace:*`
  - `@repo/typescript-config: workspace:*`
  - `@types/bun: catalog:`
  - `@types/node: catalog:`
  - `citty: catalog:`
  - `drizzle-orm: catalog:`
  - `eslint: catalog:`
  - `picocolors: catalog:`
  - `typescript: catalog:`
  - `vitest: catalog:`
  - `yaml: catalog:`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Update `isDelivered` in `src/supervisor/pick-todo.ts`**:
   - Check if `statusById` contains `todoPath` (`todos/${dep}.md`).
   - If the file is not in `statusById` (i.e. the file does not exist in `todos/`), return `true` (satisfied).
   - If the file exists, it is satisfied only when `statusById.get(todoPath) === 'done'` or when recorded as `delivered` in `tasks`.

2. **Add Unit Tests in `src/supervisor/__tests__/pick-todo.test.ts`**:
   - Add test case verifying that a todo with `depends_on: ['prerequisite']` is immediately picked when `prerequisite.md` does not exist in `todos/` and is absent from `tasks`.
   - Ensure an existing `prerequisite.md` with `status: todo` continues to block the dependent task.
   - Ensure existing tests covering satisfied and pending dependencies continue to pass.

---

## ✅ Acceptance Criteria

- [ ] A task with `depends_on: ['dep']` is ready to be picked when `todos/dep.md` does not exist in the filesystem.
- [ ] A task with `depends_on: ['dep']` is blocked when `todos/dep.md` exists with `status: todo`.
- [ ] Unit tests in `pick-todo.test.ts` cover missing dependency files as satisfied.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
