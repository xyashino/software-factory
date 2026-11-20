---
scope: factory
summary: Smoke test compiled sf in an external repo, document install
why: Nothing proved an installed sf binary and web UI work outside the monorepo; docs still said factory-2
date: 2026-11-20
tags: [cli, test, docs, install]
---

- `test/blackbox/standalone-external-repo.test.ts`: installs `dist/sf` and the web build with `scripts/install.sh` into a temp `PREFIX`, then drives `sf` in a fresh git repo outside the monorepo.
  - Temp `HOME`, `XDG_DATA_HOME`, `SF_WEB_DIR` and free ports.
- Flow covered: `init`, `server start`, `server token create --save`, `project add`, `web start` (HTTP 200).
  - Also `token create --kind cell_join` + `cell start` enroll in `cell list`, `todos import` + `queue`, `web stop`, `server stop`.
- Cell enrolls before `todos import` and is stopped first, so it never claims a job or starts an agent.
- Test is `describe.skipIf` without `dist/sf` and web build output.
  - `ci:verify` runs `test` before `build`, so a clean checkout skips it. Run `pnpm build:sf` first to execute it.
- `README.md`: `sf` install (`scripts/install.sh`, `PREFIX`, `SF_WEB_DIR`) and external-repo quickstart; old `factory` section marked legacy.
- `apps/factory/docs/PLAN.md`: `factory-2` dropped, commands renamed to `sf`, new §0 install and quickstart.
  - Added `init`, `project`, `token`, `web` rows and the token lookup order.
- No `Makefile` exists, so docs name `scripts/install.sh` only (no `sudo make install`).
