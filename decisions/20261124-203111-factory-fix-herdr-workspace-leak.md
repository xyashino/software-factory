---
scope: factory
summary: Key Herdr Cell workspace by cell name and close it on stop
why: Each cell spawn got a random id, so every respawn created a new factory:<id> Herdr workspace that never closed
date: 2026-11-24
tags: [factory, herdr, cell, workspace, leak]
---

- The Herdr runner labels the Cell workspace `factory:<cell name>` (`createHerdrRunner` gets the name from `buildContext`), not `factory:<cellId>`.
  - `cellId` is random per daemon spawn, so a respawn used to create a new workspace each time.
  - A name is reused, so restarts find and adopt the existing workspace.
- `closeCellWorkspace(processPort, cellName, cwd)` closes `factory:<name>` if it exists; a missing workspace is a no-op.
- `ScalerDeps.onStopped` receives the `CellRecord` instead of a cell id. The daemon closes the cell's workspace there, after the process is killed, and ignores Herdr errors.
- Not in this change: closing workspaces on daemon shutdown, or a startup sweep of stale `factory:*` workspaces.
- Tests: `herdr-runner.test.ts` covers closing the named workspace and no-op when absent; `scaler.test.ts` uses the new hook signature.
