---
status: queued
priority: high
line: standard
type: fix
---

# server-start-verify-own-process: start and stop tell the truth

## Objective

`sf server start` fails when another process already answers on the port. `sf server stop` reports a foreign listener instead of only "not running".

## Context

`startServer` (`apps/sf/src/application/procedures/server/start.procedure.ts`) spawns, writes the pid file, then polls `ctx.server.probe()` up to 10 s. Any listener satisfies the probe. On the VPS a leaked server held 7070: the new process died, start printed "server started, pid N", and every call hit the old server (401). `stopServer` reads only the pid file, so it said "not running". See `docs/onboarding-plan.md`.

## Scope

- **Target**: `apps/sf/src/application/procedures/server/{start,stop}.procedure.ts`, `apps/sf/src/adapters/http/server-client.ts`, ports as needed
- **Classification**: `Integration`
- **Out of scope**: killing foreign processes, token hint text (`error-hint-token-rejected`).

## Verify first

- What `probe()` calls (`server-client.ts:115`) and whether that route needs auth.
- Cross-platform way to find a port owner without shelling out to `ss`. If none, report "something answers on <url>" without pid.

## Implementation Plan

1. **Files**: the two procedures, `server-client.ts` probe, `apps/sf/test/support/fake-ports.ts`, tests.
2. **Behavior**:
   - Start: probe BEFORE spawn. If it answers and the pid file has no live pid, refuse: "something already answers on <url>, not started by sf".
   - Start: after probe succeeds, require the spawned pid still alive; if not, read the tail of `server.log` and fail with it.
   - Stop: pid file missing or dead but probe answers: outcome `not-running` plus a warning naming the url.
3. **Integration**: CLI prints warning to stderr, exit codes unchanged for the normal path.

## Acceptance Criteria

- [ ] Start with a stale listener fails with a clear message and no pid file left behind.
- [ ] Start whose child exits early fails and shows the log tail.
- [ ] Stop warns when a foreign listener exists.
- [ ] Normal start and stop behavior unchanged.
- [ ] Tests: black box with fake ports, Arrange/Act/Assert, story-style names.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
