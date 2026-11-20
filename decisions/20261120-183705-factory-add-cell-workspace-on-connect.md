---
scope: factory
summary: Add the Cell workspace and logs tab on connect
why: The Cell workspace was only created on the first interactive run, so a connected Cell showed no Herdr workspace
date: 2026-11-20
tags: [v2, cell, herdr, runner]
---

- `apps/factory/src/application/ports/runner.port.ts`: `RunnerPort` gets `prepare(): Promise<void>`.
- `apps/factory/src/application/procedures/cell/start.procedure.ts`: `startCell` awaits `ports.runner.prepare()` after `helloCell`, before `claimLoop`.
- `apps/factory/src/adapters/runners/herdr.ts`: `prepare` opens the `factory:<cell>` workspace and its `logs` tab. Errors are swallowed so connect never fails on Herdr; the memo resets on reject, so the first run retries.
- `apps/factory/src/adapters/runners/headless.ts`: `prepare` is a no-op, so headless-only Cells never call Herdr.
- `apps/factory/src/adapters/runners/routing.ts`: `prepare` forwards to the interactive runner.
- Tests: `herdr-runner.test.ts` covers prepare opening the workspace and logs tab with no tab create, and prepare resolving while Herdr is down with a retry on the first run.
- Test fakes (`fake-ports.ts`, `cell-lifecycle.test.ts`, `cell-stop.test.ts`) get a no-op `prepare`.
