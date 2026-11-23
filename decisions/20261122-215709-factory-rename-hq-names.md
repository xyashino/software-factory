---
scope: factory/cli
summary: Rename server to HQ in docs and sf help, old names as aliases
why: Docs and help called the external server Factory; the local daemon needs that name
date: 2026-11-22
supersedes: 20261113-120000-factory-nomenclature
tags: [hq, cli, docs, env]
---

- Glossary (`docs/README.md`) first: HQ = external server, Factory = local daemon, Cell = disposable worker.
- Docs (`README.md`, `docs/`) use HQ for the server. "cell-server" removed from prose; code names kept and marked as code names.
- New `sf hq start|stop|connect|target ls|use|rm|token create|token admin create`. Same command definitions as before, mounted under `hq`.
- Old names kept in `adapters/cli/legacy.command.ts`: `server`, `connect`, `target`, `token`. Each run prints one line to stderr `deprecated: use "sf hq <sub>"`, then behaves as before.
- `server token create` is `hq token admin create`. `token create` (HTTP mint) is `hq token create`.
- Env: `HQ_URL`, `HQ_TOKEN` read first. Fallback to `FACTORY_URL`, `FACTORY_TOKEN` prints once per process `deprecated: FACTORY_URL, use HQ_URL`. One resolver in `bootstrap/hq-env.ts`.
- Token source labels: `env:HQ_TOKEN` or `env:FACTORY_TOKEN`, matching the variable used. Token values never printed.
- Child env from `sf` and `apps/cell` to Cell daemons now sets `HQ_URL`, `HQ_TOKEN`, so children do not print the fallback warning.
- Not renamed: binaries, packages, directories, DB columns, route paths, `FACTORY_*` vars that are not URL or token, recovery hint text (still prints `sf server token create ...`, same command).
- Tests: `test/blackbox/hq-names.test.ts` (new names silent, old names warn once, `HQ_URL` beats `FACTORY_URL`, no token in output). Existing tests moved to `HQ_*` where they assert empty stderr.
- Checks: `ci:verify` (41 tasks), `nitpick:check`, `docs:check` pass.
