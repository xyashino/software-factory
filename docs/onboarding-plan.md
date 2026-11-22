# onboarding plan

## Goal

Fresh machine (VPS) to a running factory in few commands, with clear errors. Today first run needs 7 manual steps and hit 4 avoidable failures.

## Verified facts

- `scripts/install.mjs:19` `DEFAULT_SOURCE` pointed at a stale dist dir after the dirs rename. Fixed to `apps/sf/dist`, where `build:sf` writes the binary and `scripts/install.sh` already reads it.
- `pr-ci.yml` runs `turbo run ... build`: package `build` scripts only, not `build:sf` compiled binary. `apps/sf/test/blackbox/standalone-external-repo.test.ts` needs `apps/sf/dist/sf` + web build, is skipped without them, and installs via `install.sh`. So CI never runs `install.mjs` or the quickstart.
- `startServer` already waits up to 10 s for `ctx.server.probe()` and already auto-mints and saves a global supervisor token when no local target exists. Probe accepts ANY listener on the port, so a stale server answers for the one that just died. Pid file then holds a dead pid. `stopServer` trusts only the pid file.
- Incident on the VPS: leaked `bun src/index.ts` (up 2d 11h) from an agent e2e run in a `web-demo-05-auto-register` worktree held port 7070 with a throwaway DB. Result: 401 on every call.
- 401 hint: `recoveryCommandOf(url)` returns `sf server token create --save --global` for loopback urls, ignoring token source. With a repo token shown as source, hint likely does not help (precedence not verified).
- `sf project add <id> --repo <url>`: both required. `defaultProjectId(remote, dirName)` exists in `apps/sf/src/domain/init/project-id.ts`.
- `sf todos import --dry-run` exists.
- `RunnerCatalogPort.isInstalled(name)` exists (`apps/sf/src/adapters/runners/catalog.ts`).
- Lines use runners `claude` and `antigravity` (`.factory/lines/*.yml`). Nothing checks they are installed before a job.
- Runner abort and duplicate-agent bug: see `docs/cell-runner-plan.md` (replaces the former `cell-kill-job-process-tree` todo).
- No release workflow; only `pr-ci.yml`. Install needs Node, Bun and a build from source.
- Corrections to earlier advice: start already waits for the server; dry-run already exists.

## Decisions

- Fix bugs first, features after. Each todo = one reviewable change + one ADR.
- Doctor before setup: setup runs doctor.
- Never print tokens in any new command.
- Forest of todos (one parent each), see order table.

## Order

| Todo | What | Parent |
| --- | --- | --- |
| `install-fix-source-path` | One-line path fix | none |
| `onboarding-smoke-test` | CI runs install + quickstart in clean env | install-fix-source-path |
| `server-start-verify-own-process` | Start/stop detect foreign listener | none |
| `error-hint-token-rejected` | Correct 401 message and hint | none |
| `sf-project-add-defaults` | id and repo from repo config + git remote | none |
| `sf-doctor` | Preflight check command | none |
| `sf-setup` | One-command setup | sf-doctor |
| `server-service-units` | systemd user units | server-start-verify-own-process |
| `release-binary` | Prebuilt `sf` release + one-line install | none |
| `todos-import-paused` | Optional `--paused` import | none |
| `docs-vps-quickstart` | VPS section + troubleshooting | sf-setup |

Suggested pick order: install-fix, server-start-verify, error-hint, smoke-test, doctor, project-add-defaults, setup, service-units, docs, release, import-paused. Cell runner fixes: `docs/cell-runner-plan.md`.

## Open decisions

- `sf setup` vs `sf quickstart`; whether it starts a Cell by default (see `todos/sf-setup.md`).
- Repo visibility decides release asset access (`release-binary`).
- Keep `todos-import-paused` at all, since dry-run exists.

## Risks

- `sf setup` overlaps `sf init` and the #188 local-cell commands: reuse, do not fork logic.
- Port-owner lookup differs per OS: do not shell out to `ss`.
- `docs-vps-quickstart` location depends on `docs-restructure-root` (docs plan): verify layout first.

## Verify

`bun run ci:verify` per todo.
