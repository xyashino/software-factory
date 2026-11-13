# Feature: Quality Gates

Implemented design spec. Runs `type: commands` steps and turns failures into feedback.

## Scope

- Gate runner.
- Log capture and cleaning.
- The `GateFailure` records the engine stores.

## Port

```ts
interface SystemPort {
  run(input: { command: string; cwd: string; timeoutMs: number; logPath: string }):
    Promise<{ exitCode: number | null; timedOut: boolean; durationMs: number }>;
}
```

The adapter uses `Bun.spawn(['bash', '-lc', command])`, writes stdout and stderr interleaved to `logPath`, and kills the process group on timeout.

## Behaviour

For a commands step with `exec: [a, b, c]` and `timeout: 15m`:

1. Run `a`, `b`, `c` in order in the worktree. A failure does not stop the others.
2. The step timeout is shared: each command gets the time that is left. When it runs out, the running command is killed and the rest are recorded as `timedOut` without running.
3. Logs go to `.evidences/<taskId>/<attemptId>/<n>-<slug>.log`, where `slug` is the command with non-alphanumerics replaced by `-`.
4. For each failing command build a `GateFailure`:
   - `tail`: the log, `stripVTControlCharacters`, the last 12,000 characters, cut at a line boundary.
   - `logPath`: absolute path to the full log.
5. Append `gate_finished { passed, failures }`.

The gate never reads or writes the store directly; the supervisor records its result.

## Environment

Commands get the supervisor's environment plus `CI=1` and `FORCE_COLOR=0` (fewer escape codes, no interactive prompts). `FACTORY_*` variables are not set, so a test cannot call the in-pane CLI.

## Tests

- All pass → `passed: true`, no failures.
- Second of three fails → three commands ran, one failure.
- Timeout during the first command → it is killed, the other two are `timedOut`.
- ANSI codes and long output are cleaned and cut at a line boundary.
- A command that spawns a child process: the child is killed on timeout too.
