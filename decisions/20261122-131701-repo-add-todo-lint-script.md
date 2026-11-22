---
scope: repo
summary: Add pnpm todo:lint validating todos with the factory importer parser
why: create-todo validated by hand and drifted from the importer rules
date: 2026-11-22
tags: [todos, lint, scripts, ci]
---

- `scripts/lint-todos.ts`: parses each `todos/*.md` with `parseTodoMarkdown` from `apps/factory/src/domain/queue/todo-markdown.ts`, unchanged.
- Extra checks: `.factory/lines/<line>.yml` exists, `depends_on` names a todo in `todos/`, chain has no cycle (`findDependencyCycle`, unchanged).
- Output `file: message` per error, exit 1 on any. Plan slug shape comes from the parser.
- Runtime is bun: the factory imports are extensionless, which Node ESM rejects. Bun already runs factory tests.
- Root `todo:lint`, `test:scripts` (bun test), `check-types:scripts` (strict `scripts/tsconfig.json`).
- Turbo: `//#todo:lint`, `//#test:scripts`, `//#check-types:scripts` added and wired into `ci:verify`.
- Root devDeps `@types/bun`, `@types/node`, `typescript`, all catalog-pinned. No new packages in catalog.
- `scripts/lint-todos.test.ts`: black-box tests spawn the script on temp repos, Arrange/Act/Assert.
- `.nitpick/skills/create-todo` Validate section now calls `pnpm todo:lint`; `nitpick:sync` run.
- Importer rules and sf parser untouched.
