---
scope: factory
summary: Default sf project add id and repo from repo config
why: inside a repo, sf project add should need no args
date: 2026-11-22
tags: [cli, project, onboarding]
---

- `sf project add` args optional: `[id] [--repo <url>]`.
- Id default: `project` in `.factory/config.json`, else `defaultProjectId(origin, dirName)`.
- Repo default: `git remote get-url origin`.
- Explicit args win. Id differing from config: warning on stderr, still registers.
- No id and no config and no origin: exit 2, "no project id".
- No `--repo` and no origin: exit 2, "no origin remote".
- New procedure `resolveAddDefaults` (application layer), reuses `readProjectId` and git port `originUrl`.
- Server contract and `addProject` unchanged.
- Help text shows the defaults.
- Tests: black-box CLI cases in `init-project-token.test.ts`; `cli-errors` no longer expects `project add` to need `--repo`.
