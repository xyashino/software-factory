---
scope: software-factory/sf
summary: sf project add reads id and origin from the repo
why: Inside a repo, registering needs no args; id comes from .factory/config.json, url from origin
date: 2026-11-21
tags: [sf, project, cli]
---

- `sf project add [id] [--repo <url>]`: both args optional.
  - id: explicit arg, else `project` in `.factory/config.json`, else `defaultProjectId(origin, dirName)`.
  - repo: explicit `--repo`, else `git remote get-url origin`.
- Explicit id differing from the config id: warning on stderr, still registers.
- No origin and no `--repo`: argument error, exit 2.
- New procedure `resolveProjectDefaults` runs before `addProject`, no token needed.
- Help text shows the defaults.
- Removed `project add <id>` from the missing-flag error test; `--repo` is no longer required.
