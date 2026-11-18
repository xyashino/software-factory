---
scope: factory
summary: Add todo spec to delete the v1 software-factory package
why: v2 is the runner and v1 only adds maintenance; roadmap M9 freeze is replaced by deletion
date: 2026-11-18
tags: [factory, v1, cleanup, todos]
---

- New `todos/remove-v1-software-factory.md` (`factory: v2`, `line: fast`): spec only, nothing deleted in this change.
- Spec deletes `packages/software-factory/` and its live references: root `sf*` scripts, lockfile importer, `.vscode` schema mapping, root and `docs/` README text, eslint boundary groups and their tests.
- Replaces ROADMAP M9 "v1 is frozen (kept for reference)" with deletion. Git history keeps v1.
- No v2 package imports `@repo/software-factory` at runtime; the only references are guards and docs.
- Docs drop the version suffix (README, `docs/`): "v2" product wording becomes "the new factory", v1 becomes "the old factory" (history). Code and todo ids kept: `v2-NN`, `factory: v2`, `FACTORY_V2_ONLY`, `/v1/` API paths.
