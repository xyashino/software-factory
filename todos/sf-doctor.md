---
status: queued
priority: medium
line: standard
type: feat
---

# sf-doctor: preflight check before anything starts

## Objective

`sf doctor` reports what is missing or broken on this machine before server, Cell or jobs fail late.

## Context

Setup failures surface one at a time: wrong install path, port in use, wrong token, runner CLI not installed. Lines pin runners (`claude`, `antigravity`). `RunnerCatalogPort.isInstalled(name)` already exists. See `docs/onboarding-plan.md`.

## Scope

- **Target**: `apps/sf` (new command, procedure, adapters)
- **Classification**: `Integration`
- **Out of scope**: installing anything, logging in for the user, fixing problems.

## Verify first

- Which checks belong to `sf` vs repo: read `domain/line/parse-line.ts` to list runners and `headless` flags of `.factory/lines/*.yml`.
- Whether `gh` and `herdr` presence can be probed through existing ports.

## Implementation Plan

1. **Files**: `adapters/cli/doctor.command.ts`, `application/procedures/doctor/doctor.procedure.ts`, tests.
2. **Behavior**: print one `ok:` or `missing:`/`warn:` line per check, exit non-zero if any required check fails. Checks:
   - `git`; `gh auth status` (never print token or account data).
   - Each runner used by `.factory/lines/*.yml` via `isInstalled`.
   - `herdr`, required only when a line has `headless: false`.
   - Server url answers; token accepted (no token printed); data dir and DB path writable.
   - Port owner is the sf server (reuse server-start-verify logic if landed).
   - Project registered and id equals `.factory/config.json`.
3. **Integration**: `--json` output; later reused by `sf setup`.

## Acceptance Criteria

- [ ] Each failing check has its own line and a one-line fix hint.
- [ ] Missing runner reported with the line that needs it.
- [ ] No token or credential in any output.
- [ ] Tests: black box with fake ports, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
