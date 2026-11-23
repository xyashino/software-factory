---
scope: factory/hq
summary: Add HQ_* env names and hq.db, keep FACTORY_* fallback
why: HQ settings used FACTORY_* names and factory.db, which clashed with the local Factory daemon names.
date: 2026-11-23
tags: [factory, hq, env, rename, db]
---

- HQ reads `HQ_PORT`, `HQ_HOST`, `HQ_DB_PATH`, `HQ_DATA_DIR`. `FACTORY_PORT`, `FACTORY_HOST`, `FACTORY_DB_PATH`, `FACTORY_DATA_DIR` still work. The new name wins when both are set.
- `sf` and web-demo read `HQ_URL`, `HQ_TOKEN`, `HQ_PROJECT_ID`, `HQ_DATA_DIR` with the same fallback. Old names are read silently; the deprecation line added in #246 is removed.
- Default DB file is `hq.db` in `$XDG_DATA_HOME/sf`. An existing `factory.db` is opened when `hq.db` is absent. The file is never renamed.
- One default DB path: `defaultDbPathOf` in `apps/hq/src/config.ts`, used by `sf`. Env readers: `apps/hq/src/bootstrap/env.ts`, `apps/sf/src/bootstrap/hq-env.ts`.
- `sf` writes `HQ_*` into the HQ child env, the web-demo env, the Factory daemon env and `sf service` units.
- Cells get `HQ_URL` (relay) and `HQ_TOKEN` (local bearer). The daemon blanks inherited `FACTORY_URL` and `FACTORY_TOKEN` so a Cell never sees the HQ URL or credential.
- Unchanged: `FACTORY_DAEMON_*`, `SF_FACTORY_PORT`, `FACTORY_CELL_ID`, `FACTORY_JOIN_TOKEN`, `FACTORY_OPERATOR_URL`, `factory.pid`, `factory.json`, `.factory/`.
- Tests: `apps/hq/test/blackbox/env-names.test.ts` starts HQ as a process. sf and web-demo tests assert `HQ_*` names and the silent fallback.
- Docs: `README.md`, `docs/sf.md`, `docs/hq.md`, `docs/cell.md`, `docs/web-demo.md` list `HQ_*`. Old names are described once, in `docs/sf.md`.
- Checks: `ci:verify` (34 tasks) passes.
