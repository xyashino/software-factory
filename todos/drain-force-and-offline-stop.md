---
status: queued
priority: medium
line: fast
type: fix
---

# drain-force-and-offline-stop: stop tells the truth

## Objective

`--force` upgrades a drain already pending, and `sf cell stop` says plainly when nothing can receive the drain.

## Context

`apps/factory/.../drain.procedure.ts` returns early with the stored `drainForce` when the Cell is already `draining`, so a later `--force` is ignored. Draining an `offline` Cell succeeds; the drain only reaches a Cell through a heartbeat reply, so it never arrives. `sf cell stop` prints just "draining". See `docs/cell-runner-plan.md`.

## Scope

- **Target**: `apps/factory/src/application/procedures/cells/drain.procedure.ts`, `apps/sf/src/application/procedures/cell/stop.procedure.ts`, `apps/sf/src/adapters/cli/cell.command.ts`
- **Classification**: `Integration`
- **Out of scope**: lease timing, reaper triggers.

## Verify first

- Whether `command-replay` (`commandId`) interacts with a second request that only changes `force`.
- Cell statuses at which a drain can still be delivered (`online`, `busy`).

## Implementation Plan

1. **Files**: the three files above, factory blackbox test, sf CLI tests.
2. **Behavior**:
   - Already draining and request has `force: true` while stored is false: set `drainForce` true and return it.
   - Cell `offline`: still record the drain, but reply with a flag so the CLI warns "Cell is offline, no heartbeat will deliver this; check the process or `sf cell revoke`".
   - CLI text: "draining: leaves after the current station; use --force to abort it now" (without force), "draining (force): current station is aborted at the next heartbeat" (with force).
3. **Integration**: add the flag to the drain reply contract (`cells.contract.ts` in factory and sf copies).

## Acceptance Criteria

- [ ] Test: drain then drain with force sets force true.
- [ ] Test: drain on an offline Cell returns the warning flag; CLI prints the warning.
- [ ] CLI text matches the two forms above.
- [ ] Tests: black box, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] `pnpm ci:verify` passes.
