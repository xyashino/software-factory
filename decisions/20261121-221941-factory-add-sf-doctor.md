---
scope: factory/sf
summary: Add sf doctor preflight check command
why: setup failures surfaced one at a time, late, during server, Cell or job runs
date: 2026-11-21
tags: [sf, doctor, onboarding]
---

- `sf doctor [--json]`: one line per check, `ok:`, `warn:` or `missing:`; each `missing:` line ends with `; fix: <hint>`.
- Checks:
  - `git`; `gh` and `gh auth`
  - each runner used by a line file (`isInstalled`), with the lines that need it
  - `herdr` only when a line has a non-headless station or mechanic
  - data dir and db path writable
  - server answers; token accepted; project id from `.factory/config.json` registered on the server
- Exit 4 (`EXIT.preflight`) when any check is `missing`; `warn:` does not fail.
- Token and `gh auth status` output are never printed; `--json` carries check names, status, detail and fix only.
- Not done: port owner check, server-start-verify not landed yet.
- `FsPort.writable` added; adapter `adapters/fs/writable.ts`.
- Procedure `application/procedures/doctor/doctor.procedure.ts`; black box tests with fake ports in `test/unit/application/doctor.test.ts`.
