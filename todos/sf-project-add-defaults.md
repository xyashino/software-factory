---
status: queued
priority: medium
line: fast
type: feat
---

# sf-project-add-defaults: project add reads repo config and git remote

## Objective

Inside a repo, `sf project add` needs no arguments: id from `.factory/config.json`, repo url from `git remote get-url origin`.

## Context

`sf project add <id> --repo <url>` requires both (`apps/sf/src/adapters/cli/project.command.ts`). `.factory/config.json` already holds `project`; `sf todos import` resolves the project from it, so a mistyped id breaks import later. `defaultProjectId(remote, dirName)` exists in `apps/sf/src/domain/init/project-id.ts`. See `docs/onboarding-plan.md`.

## Scope

- **Target**: `apps/sf/src/adapters/cli/project.command.ts`, project procedure inputs
- **Classification**: `Integration`
- **Out of scope**: `sf setup`, changing the server contract.

## Implementation Plan

1. **Files**: `project.command.ts`, a small resolver reusing `readProjectId` (`application/core/repo-access.ts`) and the git port.
2. **Behavior**:
   - `id` optional: default from `.factory/config.json`, else `defaultProjectId`.
   - `--repo` optional: default `origin` url.
   - Explicit id that differs from the config: print a warning, still register.
   - Not in a repo and no args: argument error, exit code 2.
3. **Integration**: help text shows the defaults.

## Acceptance Criteria

- [ ] `sf project add` in a repo registers `<config id>` with the origin url.
- [ ] Explicit args still win; id mismatch warns.
- [ ] Outside a repo without args: exit 2 with a clear message.
- [ ] Tests: black box, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
