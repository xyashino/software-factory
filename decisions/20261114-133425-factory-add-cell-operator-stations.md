---
scope: factory/cell
summary: Cell runs Operator stations over a private socket
why: Operators must run on a Cell and reach the runtime only through a 0600 socket, with checkpoints fenced at dry run.
date: 2026-11-14
tags: [v2, cell, operator, checkpoint, socket, cycle]
---

- Cycle policy: `factory-core/cycle/watch.ts` is v1 `watch` moved out of the Work order domain; `policy.ts` holds the question hold (30 min), the handover grace (5 min) and the v1 reminder timing.
- Operator socket: `node:net` unix socket per Cycle, mode `0600` after bind, umask guarded; one JSON line in, one reply out.
  - The token is 24 random bytes per Cycle, compared in constant time before the verb schema.
  - The verb schema is `contracts/operator.ts`, strict, so the CLI and the Cell share one wire.
- Checkpoint (PROTOCOL §8.2): validate outputs, upload, commit with the five trailers, dry run, fetch and `--force-with-lease` push (3 tries), then the real send. `stale_epoch` at the dry run stops before any push.
- Every outcome commits (`passed`, `failed`, `blocked`, `handed_over`); a block or a handover does not require all declared outputs.
- Read-only station: commits nothing; a dirty tree fails the Cycle as `crashed`.
- Workspace: a bare mirror per project, its fetch writes `refs/remotes/origin/*` so it never writes a branch a worktree holds; `.cell/` is excluded through the mirror's `info/exclude`.
- Runners: headless first (stdin takes typed signals, stdout log is the activity clock); Herdr pane through a `PaneDriver` over the v1 `tab`/`agent` calls; a pane is observed through its reported status and the time its tail last changed.
- Workspace: `sync` then `setup` run in the worktree through `sh -c` with the Job's timeout; a `.cell/prepared` marker holds the base they last ran at, so an unchanged base skips them.
- Runtime blocks (`runner_prompt`, `question_timeout`) go through the checkpoint as `blocked`, like an Operator's block.
- Usage: a runner that reports usage gets a `RecordUsage` after the Cycle ends, read from its stdout log.
- Leave: `leaveCell` asks each live station for a Handover; a station that does not comply is released after 5 min.
  - `cell.ts` wires it to `RunningCell.leave` (invoked on `SIGTERM` in `main.ts`), while `runJob` dispatches `run_operator_station` on the shared heartbeat.
- Operator CLI: `factory-operator` reads its socket and token from the environment, imports contract types only, and exits 0/1/2/3 (ok, refused, usage, unreachable).
  - Startup median about 17 ms in the test, the stub socket in its own process; the 100 ms bound is the test's assertion.
- Test seams: the e2e tests boot a real `factory-server` runtime on a temp socket and drive a scripted runner that calls the real CLI; the Cell's eslint rule exempts only `src/__tests__/e2e`.
- Runtime finding, not changed here: a nudge sent before the Cycle starts answers 503 `unavailable` instead of a refusal.
