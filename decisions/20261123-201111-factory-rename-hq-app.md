---
scope: factory/hq
summary: Rename apps/factory to apps/hq, package @repo/hq
why: apps/factory held the HQ server, so "factory" meant both HQ and the local daemon. Path and package now name HQ only.
date: 2026-11-23
tags: [factory, hq, rename, docs]
---

- `git mv apps/factory apps/hq` and `docs/factory.md` to `docs/hq.md`. Package `@repo/factory` is now `@repo/hq`; `bun.lock` refreshed.
- Build and dispatch: `apps/sf` embeds HQ from `apps/hq/src/index.ts` (`config.ts`, `bootstrap/server-dispatch.ts`, `tsconfig.json`). Compiled `sf hq start` still starts HQ.
- Turbo task inputs and `scripts/lint-todos.ts` point at `apps/hq`. Skill text in `.nitpick/skills` (`create-todo`, `boss-factory`) updated; `nitpick:sync` regenerated.
- Docs (`README.md`, `docs/*`, `apps/hq/README.md`) link `docs/hq.md` and name `apps/hq`. Todo specs with old paths updated so the path grep is clean.
- Unchanged: `@repo/factory-contracts`, env vars, `factory.db`, HTTP routes, `.factory/` and `.factory-local/` folders, `docs/hq-factory-cell-plan.md` file name.
- No behavior change. Same binary, routes and DB.
- Test fixtures in `apps/sf/test/unit/config.test.ts` use `apps/hq` paths.
- Checks: `ci:verify` (34 tasks), `nitpick:check`, `build:sf`, `sf hq start` then `sf hq stop` from the compiled binary.
