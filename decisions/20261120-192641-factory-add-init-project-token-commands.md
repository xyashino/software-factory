---
scope: factory
summary: Add sf init, project and token commands for repo onboarding
why: Onboarding a repo needed hand-written config files and curl calls to register projects and mint tokens
date: 2026-11-20
tags: [init, project, token, cli, onboarding]
---

- `sf init [--project <id>] [--force] [--json]` in cwd: writes `.factory/config.json`, `lines/standard.yml`, `lines/fast.yml`, `operators/{builder,doctor}.md`, `templates/pr/body.md`.
  - Existing files are skipped unless `--force`; reported as `skip`.
  - Appends `.factory-local/` and `.worktrees/` to `.gitignore` when the exact line is missing.
  - Project id: `--project`, else git `origin` repo name, else directory name; slug-normalized, must match the slug rule.
- Starter templates are string constants in `domain/init/templates.ts`, kept parseable by `parseLine` and `parseRepoConfig` (unit-tested).
- `sf project add <id> --repo <url> [--base-branch main] [--max-running 5] [--json]` posts `POST /api/v1/projects`.
- `sf project ls [--json]` gets `GET /api/v1/projects`; table by default.
- `sf token create --kind cell_join|supervisor --name <name> [--json]` posts `POST /api/v1/tokens` with `expiresAt: null`; prints the token once.
- Procedures in `application/procedures/{init,projects,tokens}/`, commands in `adapters/cli/{init,project,token}.command.ts`, wired in `cli.ts`.
- CLI contracts `contracts/projects.contract.ts` and `contracts/tokens.contract.ts` mirror the server; both added to the drift test.
- Supervisor token lookup unchanged: `FACTORY_TOKEN`, then `.factory-local/supervisor.token`, then `~/.config/factory/token`; existing test covers it.
- Tests: unit init, project, token, templates, project id; blackbox `init-project-token` against a recording HTTP server. Factory package: 333 passed.
- Checks: check-types, lint, format:check green for factory.
- Limit: no live factory server here, so `sf cell start` was not run against generated lines; `todos import --dry-run` accepts the generated config.
