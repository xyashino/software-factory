---
scope: factory/sf
summary: Add sf doctor preflight check command
why: setup failures surface one at a time on fresh machines
date: 2026-11-21
tags: [sf, doctor, onboarding]
---

- `sf doctor` prints one `ok:`, `warn:` or `missing:` line per check; failing lines end with `; fix: <hint>`.
- Checks: `git`, `gh auth status` (warn only), each runner used by `.factory/lines/*.yml` via `RunnerCatalogPort.isInstalled`, `herdr` only when a line has `headless: false`.
- Checks: repo config, server answers, token accepted, repo project registered, data dir and DB path writable, invalid line files.
- Exit 1 when any check is `missing`; `--json` prints `{ ok, checks }`.
- No token or `gh` account data in any output.
- Not included: port-owner check, because `server-start-verify-own-process` has not landed.
- Tests: `test/unit/application/procedures/doctor` with fake ports, Arrange/Act/Assert.
