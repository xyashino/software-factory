---
status: todo
priority: medium
depends_on: []
line: feature
factory: v2
type: refactor
---

# Todo: Move Cycle `prompt.md` Inside Worktree `.cell/`

## 🎯 Objective

Write each Cycle's `prompt.md` inside the task's git-excluded `<worktree>/.cell/` directory instead of `<cellDataDir>/cycles/<hash>/`, so Operators read their prompt directly from the repository worktree while keeping Unix sockets on a short path.

---

## 🌐 Context & Problem Statement

Currently `apps/cell` writes `prompt.md` to `<cellDataDir>/cycles/<cycleDirName>/prompt.md` (defaulting to `~/.local/share/factory-cell/cycles/<hash>/prompt.md`). Because the Operator runner starts with `cwd = worktree`:

- The prompt lives outside the repository worktree environment, forcing `run-job.ts` to pass `--add-dir <cycleDir>` and exposing runners to external-path approval prompts or sandbox blocks.
- Leftover `cycles/<hash>/` directories accumulate outside the project worktree rather than living inside the worktree's lifecycle.
- Every worktree already has `<worktree>/.cell/` excluded via the mirror's `info/exclude` and preserved across resets (`git clean -fd -e .cell/`).

At the same time, Unix domain sockets (`op.sock`) are subject to the ~108-byte `sun_path` limit (documented in `apps/cell/src/names.ts`), so `op.sock` cannot safely be placed inside deep `<cellDataDir>/worktrees/<order>/...` paths and must remain under the short `cycles/<hash>/` (or `repair/`) path in `cellDataDir`.

---

## 📦 Specification / Scope

- **Target**: `apps/cell` (`@repo/factory-cell`)
- **Classification**: `Integration`
- **Dependencies**:
  - `@repo/factory-core: workspace:*`
  - `@repo/factory-definitions: workspace:*`
  - `@repo/factory-runtime: workspace:*`
  - `zod: catalog:`

---

## 🛠️ Implementation Plan

1. **Operator station prompt in `<worktree>/.cell/` (`apps/cell/src/jobs/run-operator-station.ts`, `apps/cell/src/jobs/run-job.ts`):**
   - Write `prompt.md` to `<worktree>/.cell/cycles/<cycleDirName>/prompt.md` (using `cycleDirName(cycleId)` from `apps/cell/src/names.ts`).
   - Update `kickoff` to point to the in-worktree relative path `.cell/cycles/<cycleDirName>/prompt.md` (or the resolved path inside `worktree`).
   - Keep `op.sock`, `bin/`, `stdout.log`, `stderr.log` in `<dataDir>/cycles/<cycleDirName>/` so the Unix socket path remains safely under 108 bytes.
   - Remove the external `addDirs: [cycleDir]` requirement from `runnersFor` / `launcherFor` in `apps/cell/src/jobs/run-job.ts` when the prompt is inside `worktree` (keeping `addDirs` optional if needed by fallback paths).
2. **Mechanic prompt alignment (`apps/cell/src/jobs/run-mechanic.ts`):**
   - When `prepareWorkspace` succeeds and `worktree` exists, write `prompt.md` inside `<worktree>/.cell/repair/<jobId>/prompt.md` and point `kickoff` there.
   - When `prepareWorkspace` fails (no worktree), retain the fallback `prompt.md` under `<dataDir>/repair/<jobId>/` (`repairDir`).
3. **Tests & Fixtures (`apps/cell/src/__tests__/`):**
   - Verify `scripted-operator.ts`, `e2e/station.test.ts`, `unit/run-mechanic.test.ts`, and `distributed/harness/fake-runner.ts` handle the in-worktree prompt path (remembering `scripted-operator.ts` resolves relative `promptPath` against `cwd` = `worktree`).
   - Add or update tests asserting `prompt.md` is created inside `<worktree>/.cell/`, stays untracked/ignored by git (`git status --porcelain`), and `op.sock` stays under `<dataDir>/cycles/<hash>/op.sock`.
   - Record one ADR entry in `decisions/`.

---

## ✅ Acceptance Criteria

- [ ] Operator station `prompt.md` is written under `<worktree>/.cell/cycles/<cycleDirName>/prompt.md` and referenced inside the worktree by `kickoff`.
- [ ] `op.sock` stays under the short `<dataDir>/cycles/<cycleDirName>/op.sock` path (within the 108-byte Unix socket limit).
- [ ] Mechanic writes `prompt.md` inside `<worktree>/.cell/` when a worktree is available and falls back to `repairDir` only when workspace preparation fails.
- [ ] `.cell/` remains excluded from `git status` and commits in the worktree.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
