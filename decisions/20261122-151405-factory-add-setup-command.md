---
scope: factory/sf
summary: Add sf setup one-command repo onboarding
why: fresh repo needed doctor, init, server, project and cell by hand
date: 2026-11-22
tags: [sf, setup, onboarding]
---

- `sf setup` runs doctor, init, server start, project add, and optionally one local Cell (`--cell <name>`); prints `step: done|skipped` per step and a `sf todos import --dry-run` hint.
- Idempotent: init skipped when `.factory/config.json` exists, server skipped when it answers, project skipped when registered, cell skipped when the name is live. Second run is all `skipped`, exit 0.
- Doctor runs first; any `missing` check except `server`, `token`, `project`, `repo-config` refuses (exit 1) before any side effect.
- No Cell starts without `--cell`. `--json` prints `{ steps }`. Token is never printed.
- `--project <id>` is checked against an existing repo config before any side effect; init uses it only when config is absent.
- Project id comes from repo config, or from init's default (origin name, then directory). Repo url is the `origin` remote; missing origin refuses at the project step, after init and server start.
- Server start saves the supervisor token, so project and cell steps use a fresh ports build (`reconnect` input), not the pre-start one.
- Composes existing procedures only; no new server endpoints; `sf-project-add-defaults` not required.
- Risk: server probe accepts any listener on the port, so a stale server counts as up. Out of scope until `server-start-verify-own-process` lands.
- Tests: `test/unit/application/procedures/setup` with fake ports, Arrange/Act/Assert, 7 cases.
- Proof: real `sf setup` twice in a fresh scratch repo, second run all `skipped`, doctor ok after.
