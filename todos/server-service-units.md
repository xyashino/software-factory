---
status: queued
priority: low
line: standard
type: feat
depends_on: server-start-verify-own-process
---

# server-service-units: server and Cell survive logout

## Objective

`sf service install` writes systemd user units for the server and chosen Cells, so they start on boot and survive logout.

## Context

`sf server start` spawns a detached process; `sf cell start` runs in the foreground. On a VPS both stop when the session ends unless run under `tmux`. See `docs/onboarding-plan.md`.

## Scope

- **Target**: `apps/sf` (new `service` command, unit templates)
- **Classification**: `Infrastructure`
- **Out of scope**: macOS launchd, Windows services, system-wide units.

## Verify first

- systemd wants a foreground process: confirm how `serverArgs` runs the server (`IS_COMPILED`) and whether a foreground `sf server run` exists or is needed.
- Where tokens for Cells live and how a unit gets `FACTORY_JOIN_TOKEN` without writing it to a world-readable file.

## Implementation Plan

1. **Files**: `adapters/cli/service.command.ts`, templates under `domain/`, tests.
2. **Behavior**: `service install [--cell <name>]` writes `~/.config/systemd/user/sf-server.service` (and `sf-cell-<name>.service`) with `Restart=on-failure`, then prints `systemctl --user enable --now ...` and the `loginctl enable-linger` hint. `service uninstall` removes them. Never run `systemctl` itself without a flag.
3. **Integration**: secrets in a `0600` env file under the data dir.

## Acceptance Criteria

- [ ] Generated unit text matches a snapshot test.
- [ ] Secret env file mode is `0600`.
- [ ] Uninstall removes only files install created.
- [ ] Tests: black box, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
