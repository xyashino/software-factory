---
status: todo
priority: high
depends_on: []
plan: herdr-tabs-and-log-files
line: feature
type: fix
---

# Todo: Open the operator and mechanic panes in their own new tab of the task workspace

## 🎯 Objective

Every operator and mechanic pane opens in a new tab of its task's own Herdr workspace, and never in another task's workspace or a second workspace with the same name.

---

## 🌐 Context & Problem Statement

In v1 (`packages/software-factory/src/supervisor/operator.ts`), the on-call operator opened in its own tab `operator#n` inside the task workspace, in the task worktree. It closed earlier operator tabs first, so at most one ran.

In v2, `apps/cell/src/runners/herdr-pane.ts` `open()` creates a new tab for every pane, which matches the wanted behaviour. The problem is the workspace lookup:

- `workspaces` (line 89) is an in-memory map from task to Herdr workspace id. After a Cell restart it is empty, and `adopt()` (line 199) restores only tab locations, not workspaces.
- The next pane for that task therefore runs `herdr workspace create` again with the same label, so the operator or mechanic lands in a second workspace with the task's name.
- The workspace also takes its working directory from whichever pane creates it. The mechanic can create it with its scratch repair directory (`run-mechanic.ts`, `cwd = worktree ?? repairDir`).

This produces the wrong pane the user reported.

---

## 📦 Specification / Scope

- **Target**: `apps/cell/src/runners/herdr-pane.ts`, `apps/cell/src/jobs/run-mechanic.ts`, `apps/cell/src/jobs/run-operator-station.ts`
- **Classification**: `Integration`
- **Dependencies**: Herdr CLI (`workspace list`, `tab create`, `tab close`), already used by the driver.

---

## 🛠️ Implementation Plan

1. **Find an existing workspace before creating one**: on a cache miss, list Herdr workspaces and reuse the one whose label equals the task. Create one only when none exists. Store it in `workspaces`.
2. **One new tab per run**: keep `tab create` per pane. Label the tab with the pane name (`operator#n`, `mechanic-<n>-<jobId>`).
3. **Working directory**: set each tab's `--cwd` explicitly to its own worktree (or scratch directory). Never rely on the workspace's cwd.
4. **Close earlier operator tabs of the task**, as v1 did, so at most one operator tab runs. Do the same for the mechanic before it opens its own.
5. **Restart**: after `adopt()`, the workspace cache is seeded from the adopted tabs' workspace ids.

---

## ✅ Acceptance Criteria

- [ ] Each operator or mechanic run creates exactly one new tab, in the task's existing workspace.
- [ ] After a Cell restart, a new pane for a task reuses the existing workspace; no second workspace with the same label appears.
- [ ] Each tab's working directory is its own worktree or scratch directory, whatever created the workspace first.
- [ ] At most one operator tab and one mechanic tab per task are open at a time.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
