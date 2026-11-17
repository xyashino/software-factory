---
scope: factory
summary: Todos import and export replace todos migrate
why: Import needs no flags inside the repo, and export returns server orders to todos/
date: 2026-11-17
tags: [cli, todos, import, export, migration]
---

- `factory todos import [--project <id>] [--apply] [--remove] [--register]` runs in the repo root. It is a dry run unless `--apply` is given.
  - `--dir`, `--repo-dir` and `--all` are dropped from `import`; `import` takes only `factory: v2` todos.
- `factory todos export [--project <id>]` writes `todos/<todoId>.md` for each project order that has no file. An existing file is skipped and listed with its reason.
  - Frontmatter comes from the order's board row and its latest spec event; the body is read from the spec blob. Export always writes `factory: v2`, so `import` takes the file back without `--all`.
  - A cancelled order exports as `cancelled`, a delivered or merged one as `done`. `import` skips both, so a round trip recreates the open orders only.
- Project id: `--project`, else the repo directory name through `repoProjectId`, the rule the Cell uses. The CLI does not read `projects` from the Cell config.
- `factory todos migrate` is a hidden alias for one release: the old flags, applies unless `--dry-run`, and prints a deprecation line on stderr.
