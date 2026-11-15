---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
type: feat
---

# Todo: Make `factory-cell` Repo-Scoped with Auto-Registration and `.factory-local/` State

## 🎯 Objective

Require `factory-cell` to run within a repository context (via `cwd` or `--repo-dir`), default its data directory to `<repo>/.factory-local/cell`, and automatically register the repository's project on `factory-server` when missing.

---

## 🌐 Context & Problem Statement

Currently `apps/cell` starts without a repository context, writes mirrors/worktrees/cycles/identity to `~/.local/share/factory-cell`, and requires both manual `factory project add <id> --repo <url>` on the server and listing `<id>` in `config.toml` (`projects = [...]`) before it can claim work.

When running `factory-cell` per repository:

- Launching from inside a repository already identifies the repo root, its `.factory/` and `.factory-local/` configs, and its `origin` remote URL.
- Keeping Cell state in `<repo>/.factory-local/cell` groups all machine-local runtime artifacts with the repo instead of scattering them in `~/.local/share/factory-cell`.
- Auto-registering the project from the repo's `origin` URL and defaulting `projects` to that project eliminates redundant setup steps for `factory-cell` and `factory todos migrate`.

---

## 📦 Specification / Scope

- **Target**: `apps/cell` (`@repo/factory-cell`), `apps/cli` (`@repo/factory-cli`), `packages/factory-core` (`@repo/factory-core`), `packages/factory-runtime` (`@repo/factory-runtime`)
- **Classification**: `Integration`
- **Dependencies**:
  - `@repo/factory-core: workspace:*`
  - `@repo/factory-definitions: workspace:*`
  - `@repo/factory-runtime: workspace:*`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Require repository context & default `.factory-local/cell` (`apps/cell/src/repo-config.ts`, `apps/cell/src/main.ts`, `apps/cell/src/config.ts`):**
   - Update `loadCellConfig` / `main` to resolve the repository root from `--repo-dir` or `findRepoRoot(cwd)` and fail fast with a clear error if `factory-cell` is started outside a repository.
   - Default `cellDataDir` to `<repoRoot>/.factory-local/cell` when `cell_data_dir` is not explicitly set in config (`claimInstanceDir` continues to allocate `cell-2`, `cell-3`, ... for parallel instances).
   - Update `apps/cell/src/usage.ts` and `deploy/systemd/factory-cell.service` (documenting `--repo-dir` / `WorkingDirectory`).
2. **Infer project metadata & auto-register on `factory-server` (`apps/cell`, `packages/factory-core`, `packages/factory-runtime`, `apps/cli`):**
   - Derive the repo's project id (explicit `projects[0]` if configured, otherwise normalized repo directory basename matching `projectIdSchema`) and read `repoUrl` from `git remote get-url origin` (or explicit override if needed).
   - Ensure the project exists on `factory-server` idempotently before `hello` / claim loop starts (both on local `factory.sock` and in remote HTTP mode, updating `hello` or adding a Cell-authorized idempotent project registration path if needed) and include that project in the Cell's `projects` list automatically.
   - Optionally support the same `--register` / auto-ensure behavior in `apps/cli/src/commands/todos.ts` (`todos migrate`) when run inside a repository with `origin`.
3. **Tests & Documentation (`apps/cell/src/__tests__/`, `docs/`, `decisions/`):**
   - Update existing `apps/cell` unit, e2e, and distributed tests where Cells start in a test directory without a repo root or assert `~/.local/share/factory-cell`.
   - Add tests verifying: startup fails outside a repo, `cellDataDir` defaults to `<repo>/.factory-local/cell`, and missing projects are idempotently registered from the repo `origin` URL without clobbering existing project settings.
   - Update `docs/PROTOCOL.md` / `docs/STORAGE.md` to reflect repo-scoped Cell defaults and record one ADR entry in `decisions/`.

---

## ✅ Acceptance Criteria

- [ ] `factory-cell` refuses to start outside a repository unless `--repo-dir <path>` points to a valid repo root.
- [ ] When `cell_data_dir` is unset, `factory-cell` stores its instance state (`mirrors/`, `worktrees/`, `cycles/`, identity, `cell.lock`) under `<repo>/.factory-local/cell` (and `cell-2`, ... for concurrent instances).
- [ ] Launching `factory-cell` inside a repository automatically registers the project on `factory-server` (from `git remote get-url origin`) if absent and includes it in the Cell's `projects` list at `hello`.
- [ ] Existing projects already registered on `factory-server` keep their configured `baseBranch`, `maxRunning`, and `depPolicy`.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
