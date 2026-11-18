---
scope: factory/v1
summary: Delete packages/software-factory (v1) and every live reference
why: v2 is the only runner; no v2 package imports v1, and ported copies already live in .factory/.
date: 2026-11-18
tags: [factory, v1, cleanup, boundaries]
---

- `packages/software-factory/` deleted. Git history keeps it. Supersedes "v1 frozen" in ROADMAP M9.
- Root `sf*` scripts, `.vscode/settings.json` (v1 yaml schema only), `.prettierignore` v1 fixture line, lockfile importer removed.
- `@repo/software-factory` restricted-import group removed from eslint configs of v2 packages and apps; matching boundary test cases removed. No logic changes.
- Root `README.md` and `docs/{README,ROADMAP,RULES,STRUCTURE}.md`, `apps/factory-server/docs/BE_RULES.md` rewritten v2 only.
- Kept: `.nitpick/config.ts` scope `software-factory` (project name), `.factory/`, past `decisions/`.
- `todos/remove-v1-software-factory.md` still names v1 paths: it is the task spec.
