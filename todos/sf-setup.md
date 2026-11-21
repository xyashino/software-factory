---
status: queued
priority: medium
line: feature
type: feat
depends_on: sf-doctor
---

# sf-setup: one command from clean repo to running factory

## Objective

`sf setup` in a repo runs doctor, starts the server, registers the project, and optionally starts a first local Cell. Idempotent.

## Context

Today: `init`, `server start`, token, `project add`, join token, `cell start`, `todos import` by hand. `startServer` already saves a global supervisor token when none exists. `sf cell` has local-cell procedures from #188 (`local-create`, `local-list`, `local-stop`, `local-rm`). Project id and url come from `sf-project-add-defaults`. See `docs/onboarding-plan.md`.

## Scope

- **Target**: `apps/sf` (new command and procedure composing existing procedures)
- **Classification**: `Integration`
- **Out of scope**: importing todos, installing runners, systemd units.

## Verify first

- What `sf init` does when `.factory/` already exists (this repo commits it).
- How `local-create` starts a Cell and injects the join token.

## Open decisions

- Name: `sf setup` (default) vs `sf quickstart`.
- Default: do not start a Cell unless `--cell <name>`. Confirm.

## Implementation Plan

1. **Files**: `adapters/cli/setup.command.ts`, `application/procedures/setup/setup.procedure.ts`, tests.
2. **Behavior**: steps, each skipped if already done: doctor (stop on required failures); init only if `.factory/` missing; server start if not answering; project add with defaults; with `--cell`, mint join token internally and start Cell. Print one line per step and a final hint: `sf todos import --dry-run`.
3. **Integration**: reuse existing procedures, no new server endpoints; never print tokens.

## Acceptance Criteria

- [ ] Fresh repo reaches "server up, project registered" with one command.
- [ ] Second run changes nothing and exits 0.
- [ ] Doctor failure stops before any side effect.
- [ ] Tests: black box with fake ports, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
