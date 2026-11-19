---
status: todo
factory: v2
priority: high
plan: factory-herdr-panes
depends_on: [factory-herdr-runtime]
---

# Todo: Mechanic jobs run in their own Herdr tab with a repair dir

## 🎯 Objective

Make the v2 Cell run Mechanic jobs in a Herdr tab inside the Cell workspace, the same way the legacy workflow ran the Mechanic in its own tab, with a repair dir holding the prompt and the `factory-operator` shim. Logs are not changed.

---

## 🌐 Context & Problem Statement

The legacy Cell (`apps/cell/src/jobs/run-mechanic.ts`) runs a Mechanic job only in a Herdr pane, never headless (`run-job.ts`: "A Mechanic job runs in a Herdr pane, never headless"). It gets its own tab, and its repair scratch dir (`<dataDir>/repairs/<sha256(jobId)[:16]>/`) holds the prompt, the logs and a `bin/factory-operator` shim, so the agent can call the operator CLI from its tab.

The new Cell (`apps/factory`) does none of this yet:
- `run-job.procedure.ts` has no `mechanic` case. `factory-server` creates Mechanic jobs (`transition-job.procedure.ts`, `insertMechanicJob`), so the Cell gets jobs it cannot handle.
- There is no repair dir and no `factory-operator` shim in `apps/factory`.

Logs stay as they are: step logs keep going to `<worktree>/.cell/<stepId>/step.log` and headless output to `spec.logPath`. This todo does not add a logs tab and does not move logs.

Tab model comes from `factory-herdr-runtime`: one workspace per Cell, one tab per step, the previous step tab closed before the next one opens.

Depends on `factory-herdr-runtime`, which provides `ensureCellWorkspace` and the Herdr runner.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/factory/src/application/procedures/cell/run-job.procedure.ts`: add the `mechanic` dispatch.
  - `apps/factory/src/application/procedures/cell/run-mechanic.procedure.ts` (new).
  - `apps/factory/src/adapters/fs/repair-dir.ts` (new).
- **Classification**: Infrastructure
- **Dependencies**:
  - `citty: catalog:`, `zod: catalog:` (already in `apps/factory`)
  - No new packages.

---

## 🛠️ Implementation Plan

1. **Initialize File Structure**:
   - `apps/factory/src/application/procedures/cell/run-mechanic.procedure.ts`: `runMechanic(runtime, job)` returns the same outcome type as `runJob` for Operator steps, so `claimLoop` does not change.
   - `apps/factory/src/adapters/fs/repair-dir.ts`:
     - `repairDirOf(baseDir, jobId)` returns `<baseDir>/repairs/<sha256(jobId)[:16]>`. `baseDir` is the Cell data dir, the same place the legacy Cell used.
     - `prepareRepairDir(dir, { prompt })` writes `prompt.md` and `bin/factory-operator`. The shim is `#!/bin/sh` plus `exec <bun> <operator-cli entry> "$@"`, mode `0755`. Re-running is idempotent.
   - Tests: `apps/factory/test/unit/procedures/run-mechanic.test.ts` (fake runner and fs ports), `apps/factory/test/unit/adapters/fs/repair-dir.test.ts` (shim content, mode, re-prepare).
2. **Dispatch**:
   - In `run-job.procedure.ts`, switch on the job kind: `run_operator_station` and `mechanic` go to the runner. `run_inspection` and `deliver` keep their paths.
   - When the Herdr runner is not available for a Mechanic job, return a refusal with the reason `mechanic needs the Cell pane`. Never start it headless.
   - The Mechanic job reports `verdict`, `block` and `handover` through the operator endpoint, the same as Operator steps. The server needs no change.
3. **Running a Mechanic job**:
   - Build the prompt from the Andon the job carries (`incident` in the job payload) and the judge feed. Write it to `prompt.md` in the repair dir.
   - `prepareRepairDir` runs before the tab opens. The agent's environment has the repair `bin` directory first in `PATH`, so `factory-operator` resolves to the shim.
   - Start the agent with `RunnerPort.start` in a new step tab in the Cell workspace. `cwd` = the job's worktree. Tab label = `mechanic-<jobId>` (short form).
   - Wait with `RunnerPort.wait`. The timeout comes from a `mechanic` block in the line, or a default when the line has none. The choice is in Open Points.
4. **Errors**:
   - A Mechanic run that ends without a verdict puts the repair dir path and the existing step log path into the job's `error_detail`. Nothing else about logs changes.
5. **Exports & Integration**:
   - Export only `runMechanic` from `run-mechanic.procedure.ts`. No barrel files.

---

## ✅ Acceptance Criteria

- [ ] A Mechanic job is claimed and runs in its own tab inside the Cell workspace, in the job's worktree, and its output is visible there.
- [ ] The Mechanic tab replaces the previous step tab. At most one step tab is open per Cell.
- [ ] Without the Herdr runner, a Mechanic job is refused with `mechanic needs the Cell pane` and is not run headless.
- [ ] `<baseDir>/repairs/<hash>/` contains `prompt.md` and an executable `bin/factory-operator`. Running `factory-operator --help` through the shim works.
- [ ] A Mechanic run that ends without a verdict records the repair dir path and the existing step log path in the job's `error_detail`.
- [ ] Mechanic jobs report `verdict`, `block` and `handover` through the operator endpoint, with no server change.
- [ ] Log paths and log contents for Operator steps are unchanged.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Manual proof per the `evidence` skill: screenshot of the Cell workspace with the Mechanic tab running.

---

## ❓ Open Points

- Mechanic timeout: reuse the Operator `timeout` of the line, or add a `mechanic:` block to the line schema. Pick one before implementing.
- Base dir for repairs: `.factory-local/` next to the Cell config, or the Cell data dir the legacy Cell used. Pick one before implementing.
