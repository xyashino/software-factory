---
status: todo
priority: high
depends_on: []
line: feature
factory: v2
type: chore
---

# split-factory-local-dir: Split committed .factory definitions from gitignored .factory-local runtime state

## Objective

Separate committed repository Factory definitions (`.factory/`) from gitignored local runtime state and machine-local overrides (`.factory-local/`) so `.factory/` is tracked normally in git without hiding new Lines, Operators, or templates behind `.gitignore`.

## Read first

- `.gitignore`
- `packages/software-factory/src/paths.ts`
- `packages/software-factory/src/supervisor/wire.ts`, `run.ts`, `lock.ts`
- `packages/software-factory/src/cli/reset-action.ts`
- `packages/software-factory/docs/STRUCTURE.md`
- `apps/cell/src/repo-config.ts`
- `docs/PLAN.md`, `docs/PROTOCOL.md`

## Deliverables

1. **Gitignore cleanup (`.gitignore`):**
   - Remove `.factory/` and the `!/packages/factory-definitions/starter/.factory/` workaround from `.gitignore`.
   - Ignore `.factory-local/` instead so local runtime artifacts never appear as untracked files while new files under `.factory/` (`lines/`, `operators/`, `templates/`, `cell.toml`) are tracked normally.
2. **Move v1 runtime state to `.factory-local/` (`packages/software-factory`):**
   - Update `storePath` and `supervisorLockPath` in `packages/software-factory/src/paths.ts` to write under `.factory-local/` (`software-factory.sqlite`, `supervisor.lock`).
   - Update `packages/software-factory/src/supervisor/wire.ts` (`workspaces.json`), `packages/software-factory/src/supervisor/run.ts` (`supervisor.log`), and `packages/software-factory/src/cli/reset-action.ts` (`supervisor.log` cleanup) to use `.factory-local/`.
   - Update `packages/software-factory/docs/STRUCTURE.md` and v1 unit/smoke tests (`task-log.test.ts`, `reset.test.ts`, `cli.smoke.test.ts`) to reference `.factory-local/`.
3. **Optional local Cell config override (`apps/cell`):**
   - Layer `<repo>/.factory-local/cell.toml` (when present) over `<repo>/.factory/cell.toml` in `apps/cell/src/repo-config.ts` so machine-specific settings (`factory_data_dir`, `cell_data_dir`, `factory_url`) can live locally without editing the committed `.factory/cell.toml`.
   - Add unit coverage in `apps/cell/src/__tests__/repo-config.test.ts` and document `.factory-local/` in `docs/PROTOCOL.md`.

## Acceptance criteria

- [ ] `.gitignore` ignores `.factory-local/` and no longer ignores `.factory/` (nor needs `!/packages/factory-definitions/starter/.factory/`).
- [ ] `packages/software-factory` reads and writes `software-factory.sqlite`, `supervisor.lock`, `supervisor.log`, and `workspaces.json` under `.factory-local/`, leaving `.factory/` strictly for repository definitions.
- [ ] `apps/cell` supports `.factory-local/cell.toml` over `.factory/cell.toml` over `~/.config/factory-cell/config.toml`.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test`, and `factory check --dir .` pass.
