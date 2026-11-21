---
status: queued
priority: low
line: fast
type: fix
---

# error-hint-token-rejected: 401 message that helps

## Objective

A 401 explains that the server rejected the token and gives a fix that matches the token source.

## Context

`unauthorizedMessage` (`apps/sf/src/bootstrap/run.ts`) always prints `fix: <recoveryCommandOf(url)>`. For loopback urls that is `sf server token create --save --global` (`connection-config.ts:155`), even when the token came from `repo:.factory-local/supervisor.token`. A new global token likely does not replace a repo token (precedence not verified). See `docs/onboarding-plan.md`.

## Scope

- **Target**: `apps/sf/src/bootstrap/run.ts`, `apps/sf/src/domain/connection/connection-config.ts`
- **Classification**: `Integration`
- **Out of scope**: server-side changes, port ownership checks.

## Verify first

- Token resolution order (repo file, env, global config) in `connection-config.ts`.

## Implementation Plan

1. **Files**: the two files above, `apps/sf/test/blackbox/cli-errors.test.ts`.
2. **Behavior**: message line "server at <url> rejected the token". Fix by source: repo file -> `rm <path>` then `sf server token create --save`; global -> `sf server token create --save --global`; env -> check the variable. Add "another server may own this port (check what listens on it)".
3. **Integration**: keep target and token-source lines.

## Acceptance Criteria

- [ ] Each token source produces its own fix line.
- [ ] Tests assert message text per source.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
