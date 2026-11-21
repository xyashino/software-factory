# cell runner plan

## Goal

One agent per step, always. Stopping or aborting a Cell never leaves a live agent, never starts a second one in the same worktree.

## Incident (VPS, 2026-11-21)

Work order `operator-retire-app-and-protocol`, Cell `software-factory:factory-vps`, pid 2068452 (`sf cell start --name factory-vps`, started 15:29:22, parent pid 1).

Cell log (`.factory-local/cells/factory-vps.log`):

- 15:29:54 claim job-8d811d78 epoch=1, runner claude, worktree create, pane w5J:p2.
- 15:31:27 claim job-c753eb24 epoch=3, runner claude, worktree reuse, pane w5J:p3.

Same process, two jobs for one order, 93 s apart, second runner in the reused worktree. Log has no abort, exit, leave or drain line.

Agent in a herdr tab: `sf operator done` failed 3 times, exit 3, "cannot reach the Cell at http://127.0.0.1:46703/". Work (report, commit message, ADR) left staged, uncommitted.

Later `sf cell list`: Cell offline, last heartbeat 15:37:08, job-c753eb24 still active. `sf cell stop <id>` x2 and `--force` all printed "draining". At 15:38 no `claude` process was alive; herdr server (pid 1891) and Cell (2068452, idle) were.

## Verified in code

- `run-job.procedure.ts` ~1044-1075: on abort signal, drain-force, timeout: `void ports.runner.abort(handle)` (not awaited). Outcome `aborted` returns `null`; `finally` stops heartbeat and closes the operator endpoint (`ports.operator.close()`).
- `herdr.ts` `abort` = mark run aborted + `herdr tab close <tab>`. No process kill, no wait for exit. `start` also closes the previous tab and opens a new one.
- Operator endpoint (loopback, random port) and `FACTORY_CYCLE_TOKEN` (random) are per run; both die with the run or the Cell.
- `claimLoop` claims the next job right after `runJob` returns. Nothing checks the previous runner is dead.
- `cell.command.ts:108-110`: SIGINT/SIGTERM only `controller.abort()`. `runtime.signal` is read only in `claimLoop`'s loop condition, never inside `runJob`. A Cell mid-job ignores SIGTERM until the job ends; `local-stop` then fails "did not exit after SIGTERM".
- Server `hello` resumes a `claimed`/`running` job with unexpired lease (epoch+1, new lease). Client `startCell` ignores `resumedJob`, sends `localWorktrees: []`, calls `claimLoop(runtime, null)`.
- Server `drain.procedure.ts`: if cell status is already `draining`, returns early with stored `drainForce`. A later `--force` is ignored. Drain on an `offline` Cell succeeds; no heartbeat will ever deliver it.
- Lease reaper runs lazily in `list`, `heartbeat`, `claims` (`reapExpiredLeases`). Lost job requeues the order (epoch+1) and releases the Cell.

## Not verified

- Why job-8d811d78 was lost between 15:29:54 and 15:31:27 (stop command, heartbeat abort, other).
- Whether `herdr tab close` kills the agent process. Evidence: agent kept working after its endpoint died.
- Which of the two tabs printed the exit-3 error.
- Why heartbeats stopped at 15:37:08.
- Earlier theory (restart + dropped `resumedJob`) does not match the log: same process claimed both jobs. `resumedJob` handling is still a gap, kept out of scope here.

## Todos

| Todo | What | Parent |
| --- | --- | --- |
| `cell-runner-confirm-exit` | Abort kills the agent and waits for exit | none |
| `cell-single-runner-lock` | Lock refuses a second runner per step | cell-runner-confirm-exit |
| `cell-sigterm-during-job` | SIGINT/SIGTERM aborts and hands over the job | cell-single-runner-lock |
| `cell-run-outcome-logging` | Log every run outcome and abort | none |
| `drain-force-and-offline-stop` | Force upgrades a pending drain; stop warns on offline Cell | none |

Replaces `cell-kill-job-process-tree`.

## Out of scope

- Reattaching a restarted Cell to a live pane (persist endpoint port, token, pane ids). Follow-up if killing in-flight work proves too costly.
- Using `resumedJob` from `hello`.

## Verify

`pnpm ci:verify` per todo. Each todo reproduces the failure with a fake runner before fixing.
