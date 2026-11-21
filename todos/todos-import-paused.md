---
status: queued
priority: low
line: fast
type: feat
---

# todos-import-paused: import without starting work

## Objective

`sf todos import --paused` queues every todo as paused so nothing runs until you unpause.

## Context

`sf todos import --dry-run` already exists. Import otherwise queues every `todos/*.md` as written; on a first run that can start many jobs. The factory accepts `status: paused` in files. See `docs/onboarding-plan.md`. Skip this todo if dry-run plus editing `status` is enough.

## Scope

- **Target**: `apps/sf/src/adapters/cli/todos.command.ts`, `application/procedures/todos/import.procedure.ts`
- **Classification**: `Integration`
- **Out of scope**: server import rules.

## Verify first

- Where `status` is read and sent in `import.procedure.ts`; the flag must override the sent status only, never rewrite files on disk.

## Implementation Plan

1. **Files**: the two files, tests.
2. **Behavior**: `--paused` sets status `paused` on every sent todo except `cancelled`. Output states how many were paused.
3. **Integration**: help text; works with `--dry-run`.

## Acceptance Criteria

- [ ] Imported work orders are paused; files unchanged.
- [ ] `cancelled` stays cancelled.
- [ ] Tests: black box, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
