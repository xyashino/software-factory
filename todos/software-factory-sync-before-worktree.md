---
status: todo
priority: high
depends_on: []
type: feature
---

# Todo: software-factory Sync Repo From origin Before Worktree

## 🎯 Objective

Run a `sync` step in the main repo root before each task's worktree is created, doing a hard pull from `origin` (`git fetch origin` + `git reset --hard origin/main`), and move the existing `setup.exec` commands (e.g. `pnpm install --frozen-lockfile`) to run only inside the worktree after it is created.

---

## 🌐 Context & Problem Statement

The local `main` checkout must never contain changes: no local commits and no edits. Today nothing enforces this. `setup` runs only inside the task worktree (`packages/software-factory/src/supervisor/execute.ts`, `setup()`, after `ports.git.createWorktree`), so the main checkout is never synced before a task starts. `createWorktree` already fetches `origin/main` for the task branch, but it does not touch the local `main`.

The desired rule: each task starts from `origin/main`, and the main checkout is reset to `origin/main` before the task starts. Running `git reset --hard` in the repo root discards uncommitted changes and local commits on `main`, so the step must run before any worktree exists and must fail the task (no worktree created) if the command fails or times out.

---

## 📦 Specification / Scope

- **Target**: `packages/software-factory/{src/supervisor/execute.ts,src/definitions/workflow.ts,schemas/workflow.schema.json,workflows/*.yml,docs/PLAN.md,docs/DEFINITIONS.md}` plus tests under `src/supervisor/` and `src/definitions/__tests__/`
- **Classification**: Domain Core / Integration
- **Dependencies**:
  - `zod: catalog:`
  - `yaml: catalog:`

---

## 🛠️ Implementation Plan

1. **Workflow definition**:
   - Add an optional `sync` block to the workflow schema (`{ timeout, exec: [...] }`), same shape as `setup`, run in the repo root.
   - Keep `setup` as is, but document that it runs in the task worktree after creation.
   - Set `sync` in `workflows/fast.yml`, `feature.yml` and `standard.yml` to `git fetch origin` and `git reset --hard origin/main`.
2. **Supervisor flow** (`src/supervisor/execute.ts`):
   - Before `ports.git.createWorktree`, run each `sync.exec` command with `cwd: ports.root` and `timeoutMs` from the block.
   - On failure or timeout, record `setup_finished { ok: false, log }` and return, so no worktree is created.
   - Then create the worktree and run `setup.exec` in it, as today.
   - Log each sync step to `.evidences/<task>/sync-<index>.log`.
3. **Reconcile** (`src/supervisor/reconcile.ts`): a `setup_started` without `setup_finished` still drops the half-made worktree; confirm the sync step is safe to rerun.
4. **Docs**: update the setup and sync rules in `docs/PLAN.md` and `docs/DEFINITIONS.md`, and the workflow table in `docs/feature-plans/02-engine.md` if it lists setup.

---

## ✅ Acceptance Criteria

- [ ] `sync` runs in the repo root before `createWorktree`; `setup` runs inside the worktree after it is created.
- [ ] A failing or timed-out `sync` command records `setup_finished { ok: false }` and creates no worktree.
- [ ] Uncommitted changes and local commits on `main` are discarded by `sync` before a task starts, and the test covers this against a fake git port.
- [ ] `workflows/*.yml` validate against the updated schema; invalid `sync` blocks (missing timeout, empty exec) are rejected.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
