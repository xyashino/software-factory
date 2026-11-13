# Feature: Herdr Adapter and Runners

Implemented design spec. Everything that touches a terminal.

## Scope

- `HerdrPort` and its CLI adapter.
- Runner adapters (claude, codex, cursor, antigravity, opencode).
- Starting an attempt end to end.

## Files

```
src/ports/herdr.port.ts
src/ports/runner.port.ts
src/adapters/herdr/herdr.adapter.ts      ported from packages/factory/src/adapters/herdr
src/adapters/runners/{claude,codex,cursor,antigravity,opencode}.ts   ported from adapters/agents
src/adapters/runners/registry.ts         runner name -> adapter (the only switch on runner names)
src/testing/fake-herdr.ts
```

## `HerdrPort`

```ts
interface HerdrPort {
  createWorkspace(label: string, cwd: string): Promise<{ workspaceId: string }>;
  closeWorkspace(workspaceId: string): Promise<'closed' | 'absent'>;
  createTab(input: { workspaceId: string; label: string; cwd: string; env: Record<string, string> }):
    Promise<{ tabId: string; paneId: string }>;
  closeTab(tabId: string): Promise<'closed' | 'absent'>;
  startAgent(input: { name: string; kind: string; paneId: string; args: string[]; timeoutMs: number }): Promise<void>;
  prompt(name: string, text: string): Promise<'accepted' | 'blocked'>;
  wait(name: string, timeoutMs: number): Promise<'idle' | 'working' | 'blocked' | 'done' | 'unknown' | 'timeout'>;
  read(name: string, lines: number): Promise<string>;
  exists(name: string): Promise<boolean>;
}
```

Errors are a typed `HerdrError` with the command, exit code and stderr. Every call has a timeout (RULES 4.4).

### CLI mapping (verified against the installed `herdr`)

| Port method | Command |
| :--- | :--- |
| `createWorkspace` | `herdr workspace create --cwd <cwd> --label <label> --no-focus` |
| `createTab` | `herdr tab create --workspace <id> --cwd <cwd> --label <label> --env K=V ...` |
| `startAgent` | `herdr agent start <name> --kind <kind> --pane <paneId> --timeout <ms> -- <args>` |
| `prompt` | `herdr agent prompt <name> <text>` |
| `wait` | `herdr agent wait <name> --until idle --until done --until blocked --timeout <ms>` |
| `read` | `herdr agent read <name> --lines <n> --source recent` |
| `closeTab` / `closeWorkspace` | `herdr tab close <id>` / `herdr workspace close <id>` |

Ids are parsed from JSON output, not regexes over text. Check the output of `tab create` for the pane id when porting.

Agent name: `<taskId>.<attemptId>`. It is unique and lets reconciliation find the pane by name.

## Runner adapters

```ts
interface RunnerAdapter {
  name: string;              // workflow `runner:` value
  kind: string;              // Herdr --kind
  args(input: { model: string }): string[];   // model flag + unattended permission flags
}
```

| Runner | Herdr kind |
| :--- | :--- |
| `claude` | `claude` |
| `codex` | `codex` |
| `cursor` | `cursor` |
| `antigravity` | `agy` |
| `opencode` | `opencode` |

Take the model and permission flags from the existing `packages/factory/src/adapters/agents/*.ts`; do not re-derive them.

## Starting an attempt

1. `createWorkspace` once per task (stored in the `setup_finished` payload).
2. `createTab` with label `<stepId>#<n>`, cwd the worktree, env:
   - `FACTORY_ROOT`, `FACTORY_TASK`, `FACTORY_ATTEMPT`
   - `PATH=<package>/bin:<current PATH>` so `software-factory` resolves in the pane.
3. `startAgent` with the runner's kind and args.
4. `prompt` with the rendered prompt (feature 09). `blocked` → `attempt_failed start_failed`.
5. Append `agent_ready` with pane and tab ids.

`bin/software-factory` is a small shell launcher: `exec bun "<package>/src/cli.ts" "$@"`.

## Observation

`observe.ts` maps `wait` and `read` to the engine's `Observation`:
- `exists = false` → `gone`.
- `wait` result → `working` / `idle` / `blocked` (`done` counts as `idle`: the agent stopped but did not call `software-factory done`).
- `lastOutputAt`: hash of the last 100 lines; when it changes, it is now, otherwise the previous value. Kept in memory and rebuilt as "now" after a restart (a restart grants a fresh silence window, which is safe).

## Tests

- Adapter: each method against recorded `herdr` stdout/stderr fixtures, including failures.
- Registry: every runner named in shipped workflows has an adapter.
- Manual smoke script `scripts/smoke-herdr.ts`: opens a workspace, starts `claude`, prompts "run `echo ok`", reads, closes. Not in CI.
