---
scope: factory
summary: Split committed .factory from gitignored .factory-local
why: Repo definitions must be tracked while machine state stays ignored
date: 2026-11-15
tags: [gitignore, runtime-state, cell-config, factory-local]
---

- `.gitignore` drops `.factory/` and the starter workaround; it ignores `.factory-local/` instead, so new Lines, Operators and templates under `.factory/` are tracked normally.
- `.factory-local/` holds gitignored runtime state: `software-factory.sqlite`, `supervisor.lock`, `supervisor.log`, `workspaces.json`.
  - `paths.ts` gains `localDir(root)`; `storePath` and `supervisorLockPath` build from it.
  - `wire.ts`, `run.ts` and `reset-action.ts` use `localDir` too. `supervisor.log` under `.evidences/<task>/` is unchanged.
- Old runtime files under `.factory/` are orphaned, not migrated. `sf reset` clears only the new paths.
- Cell config layers: `~/.config/factory-cell/config.toml` < `<repo>/.factory/cell.toml` < `<repo>/.factory-local/cell.toml`, each key by key.
- `repoPath` still names the committed file; `localPath` names the local override. The Cell logs every applied file.
