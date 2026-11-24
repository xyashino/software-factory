---
scope: factory
summary: Extract Factory daemon into apps/factory package
why: Factory daemon lived inside apps/sf; a standalone package with no sf imports is dispatched from sf like apps/hq
date: 2026-11-24
tags: [factory, daemon, refactor, sf]
---

- `apps/sf/src/factory/*` moved to `apps/factory/src/` as `@repo/factory` (private, `type: module`); unit tests moved to `apps/factory/test/unit/`.
- Zero imports from `apps/sf` source. Narrow ports in `src/ports.ts`; adapters in `src/adapters/` (clock, process, HQ link client, credential read, pid file read/remove, repo config); `src/bootstrap.ts` is the only file importing adapters.
- Local `errors.ts` (`Refused`, `ArgumentError`, `Unreachable`) and `cell-name.ts`; path constants in `src/config.ts` duplicate sf values (`factory.json`, `factory.pid`, port 7072, XDG rules).
- `apps/sf` dispatches `__factory-daemon` to `../../../factory/src/index`; `FACTORY_DAEMON_ENTRY` points to `apps/factory/src/index.ts`. Compiled `sf` binary carries the daemon.
- Cell launcher still points at `apps/sf/src/cli.ts` by path (no import) for non-compiled runs.
- Dropped unused `@repo/hq-contracts` dep. Behavior of `sf factory start|status|stop` and `sf cell scale` unchanged.
- Tests: `hq-link`, `scaler`, `supervisor` kept; mocks shrink to narrow ports; `supervisor` test now passes `projectId`, typechecked for the first time.
- Docs: `architecture.md`, `README.md`, `cell.md`, `hq-factory-cell-plan.md` point to `apps/factory`.
