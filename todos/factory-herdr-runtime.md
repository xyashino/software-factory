---
status: todo
priority: high
plan: factory-herdr-panes
depends_on: []
---

# Todo: Cell workspace in Herdr with one tab per Operator step

## 🎯 Objective

Make the v2 Cell (`apps/factory`) run every Operator step in a Herdr tab inside one workspace that belongs to the Cell, the same tab model as the legacy workflow, and keep the headless `claude -p` run as the fallback when Herdr is not reachable.

---

## 🌐 Context & Problem Statement

Today the v2 Cell only runs headless. `bootstrap/context.ts` wires `createHeadlessRunner`, so every Operator step is a background `claude -p` process with nothing visible in Herdr. Line files already declare `headless: false` for operators (`.factory/lines/*.yml`). The parser reads the flag (uncommitted, `domain/line/parse-line.ts`), and `run-job.procedure.ts:247` picks the TUI only when `!station.headless` and `interactiveAvailable()` is true. Nothing implements `interactiveAvailable() === true` yet, so the pane path is dead code.

Agreed model:
- **One workspace per Cell**, label `factory:<cellName>`. A Cell runs one job at a time (`claimLoop` is sequential, `cells.active_job_id` is a single value), so one workspace is enough.
- **One tab per Operator step** in that workspace, the same way the legacy workflow had one tab per Operator. When a new step starts, the previous step's tab is closed first. Mechanic tabs follow the same rule and are specified in `factory-mechanic-tab`.
- **The tab holds Cell information, not the workdir.** The worktree and cwd are job state. Pane metadata shows the Cell name, Cell id, job and step.
- **Logs are not changed by this todo.** The existing per-step log (`<worktree>/.cell/<stepId>/step.log`, `headless` `spec.logPath`) stays as it is. No logs tab and no new log layout here.
- **Workflow unchanged.** Verdicts still come from the Operator verbs on the operator endpoint. Headless keeps the exit-code contract.

The legacy pane driver (`apps/cell/src/runners/herdr-pane.ts`) creates a workspace per task, one tab per Operator lane (`tab create --workspace ... --label <name> --no-focus`), closes the earlier tab of the same lane, and drives the TUI with `herdr agent start|prompt|get|read|send-keys`. Port the agent commands, the lane-close rule and the trust handling. Do not port the per-task workspace or the `logs` tab.

Work already in the working tree that this todo replaces or reuses:
- `apps/factory/src/adapters/runners/herdr.ts` (untracked): creates a tab per run with `tab create`, runs a launcher script and waits on an exit file. This is close to the target model. Keep the tab-per-step part, replace the single `previousTabId` with the Cell workspace, and move the workspace id to Cell state.
- `apps/factory/src/adapters/runners/claude.ts`, `catalog.ts`, `runner.ts`, `runner-catalog.port.ts`: `buildInteractive` and `RunSpec.interactive` are added. Keep them.
- `.factory/config.json` keys `herdr.tabPerRun` and `herdr.closePreviousOperatorTabs` become obsolete. Remove them with this change.

Herdr CLI on this machine is 0.9.5. Check the exact flags with `herdr agent --help`, `herdr tab --help` and `herdr pane --help` before writing the wrapper.

---

## 📦 Specification / Scope

- **Target**:
  - `apps/factory/src/adapters/herdr/` (new): CLI wrapper, Cell workspace and the runner.
  - `apps/factory/src/adapters/runners/herdr.ts`: reworked into the Cell-workspace runner, or moved to `adapters/herdr/`.
  - `apps/factory/src/bootstrap/context.ts`: picks the runner once at startup.
  - `apps/factory/src/application/procedures/cell/start.procedure.ts`: ensures the Cell workspace on `cell start`.
  - `apps/factory/src/application/procedures/cell/stop.procedure.ts`, `revoke.procedure.ts`: close the workspace on drain / revoke.
  - `apps/factory/src/adapters/fs/cell-state.ts`: store the workspace id with the Cell session.
  - `.factory/config.json`: drop the two obsolete `herdr` keys.
- **Classification**: Infrastructure
- **Dependencies**:
  - `citty: catalog:`, `zod: catalog:` (already in `apps/factory`)
  - No new packages. Herdr is an external CLI called through `ProcessPort`.

---

## 🛠️ Implementation Plan

1. **Initialize File Structure**:
   - `apps/factory/src/adapters/herdr/herdr-cli.ts`: `runHerdr(processPort, args, cwd)` returns the parsed JSON or a typed error. One function per command used: `workspaceList`, `workspaceCreate`, `workspaceClose`, `tabCreate`, `tabClose`, `paneRun`, `paneReportMetadata`, `agentStart`, `agentPrompt`, `agentSendKeys`, `agentGet`, `agentStop`, `status`.
   - `apps/factory/src/adapters/herdr/cell-workspace.ts`: `ensureCellWorkspace(cellName)` returns `{ workspaceId }`. Finds the workspace by label `factory:<cellName>` first, creates it only when missing.
   - `apps/factory/src/adapters/herdr/herdr-runner.ts`: implements `RunnerPort` (`start`, `wait`, `abort`, `interactiveAvailable`) on top of the Cell workspace.
   - `apps/factory/src/adapters/herdr/trust.ts`: Claude trust-dialog handling, called only from this adapter. Reuses `adapters/runners/claude-trust.ts`.
   - Tests: `apps/factory/test/unit/adapters/herdr/herdr-cli.test.ts`, `herdr-runner.test.ts`, `cell-workspace.test.ts`, with a fake `ProcessPort`.
2. **Cell workspace lifecycle**:
   - `cell start`: `ensureCellWorkspace`. Store `workspaceId` in the Cell session (`cell-state.ts`), so a restart reuses it without a second workspace.
   - `cell stop` (drain) and `cell revoke`: close the workspace. `cell stop --force` aborts the running agent first.
   - If `herdr status server` fails at `cell start`, the Cell starts with `interactiveAvailable() === false` and runs headless. It does not refuse to start.
3. **Running one step (`RunnerPort.start`)**:
   - Tab name = `<stepId>`. Before creating it, close the previous step's tab (`tabClose`), so at most one step tab is open per Cell.
   - `tab create --workspace <workspaceId> --cwd <spec.cwd> --label <stepId> --no-focus`. The tab opens in the job's worktree. The worktree is job state, not metadata.
   - Set pane metadata (`pane report-metadata`): `cell`, `cellId`, `job`, `step`, `state`. Never the worktree path or cwd.
   - Start the agent TUI with `agent start <name> --kind <binary> --pane <paneId>`. Name = `<cellName>-<stepId>`. Handle the trust screen the same way the legacy adapter does: on `blocked during startup`, confirm, wait, continue.
   - Send the prompt with `agent prompt --wait --until working --until blocked`, then `agent send-keys Enter`.
   - Keep the existing per-step log path (`spec.logPath`) as the runner's output target. Do not add a logs tab or change log paths.
4. **Waiting (`RunnerPort.wait`)**:
   - Poll `agent get <name>` every second. The run ends when the operator verb arrives on the operator endpoint (verdict or block), when the agent exits or disappears (`gone`), or when the line's step `timeout` is reached.
   - Exit code: 0 on verdict pass, non-zero on block or timeout. Same contract as the headless `wait`.
   - Question hold: `blocked` with a question keeps the job on its step. The line's `timeout` still applies.
5. **Signals**:
   - `factory cell stop` (drain) lets the current step finish, then the Cell leaves through the existing `leave` path.
   - `factory cell stop --force` calls `RunnerPort.abort`: `agent send-keys C-c`, then `agent stop`, then the existing handover path.
6. **Fallback**:
   - `interactiveAvailable()` is true only when `herdr status server` succeeds and the Cell workspace exists or can be created. Otherwise the step runs headless and the job records `mode: headless` and the reason.
   - A Herdr error during a step does not fail the job. Abort the tab run and fall back once for the same step, recording the reason.
7. **Exports & Integration**:
   - Export only `createHerdrRunner` and `ensureCellWorkspace`. No barrel files.
   - `run-job.procedure.ts` changes only where it selects the runner (around line 247). Verdict handling stays as is.

---

## ✅ Acceptance Criteria

- [ ] `cell start` creates one workspace `factory:<cellName>`. Running it again adopts the same workspace and does not create a second one.
- [ ] A `headless: false` Operator step opens a tab in that workspace, in the job's worktree, and the agent output is visible there.
- [ ] A second step closes the first step's tab before its own tab opens. At most one step tab is open per Cell.
- [ ] Pane metadata contains the Cell and job/step state and does not contain the worktree path.
- [ ] `herdr.tabPerRun` and `herdr.closePreviousOperatorTabs` are gone from `.factory/config.json`.
- [ ] Without Herdr (`herdr status server` fails), the same line runs headless and the job records the fallback reason.
- [ ] `factory cell stop` lets the running step finish and then the Cell leaves. `--force` aborts the agent and hands the job over.
- [ ] A question from the agent keeps the job on its step until the line's `timeout`.
- [ ] Lines without `headless` behave as before.
- [ ] Log paths and the step log content are unchanged.
- [ ] Strict TypeScript typings without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Manual proof per the `evidence` skill: screenshot of the Cell workspace with one Operator step tab open.

---

## ❓ Open Points

- Confirm `agent start` works on a tab created with `tab create --cwd`. If it does not, use `pane run` with `cd <cwd>` first.
- Confirm the command that stops an agent on 0.9.5: `agent stop` or `pane close`.
