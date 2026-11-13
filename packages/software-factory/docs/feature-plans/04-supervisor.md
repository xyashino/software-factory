# Feature: Supervisor

Implemented design spec. The imperative shell around the engine: `software-factory run`.

## Scope

- Picking the next todo.
- The run loop.
- Executing each action through ports.
- Restart reconciliation.

## Files

```
src/supervisor/
  run.ts           the loop
  pick-todo.ts     next ready todo
  execute.ts       action -> port calls -> events
  observe.ts       Herdr state -> Observation
  reconcile.ts     startup recovery
  ports.ts         SupervisorPorts = { store, herdr, git, system, runners, github, clock, templates }
```

## Picking work

- Only when no task is in `running`, `waiting` or `delivering` (one task at a time).
- Candidates: `todos/*.md` with `status: todo`, all `depends_on` delivered, sorted by `priority` (`high` > `medium` > `low`) then file name. Port `todo/list-todos` and `todo/dependency` from `packages/factory`.
- Workflow: the todo's `workflow:` frontmatter, default `feature`. Must exist in definitions; otherwise the todo is skipped with a logged error.
- Review work: a delivered task whose PR has unresolved threads gets a new task run with workflow `review`.
- Creates the task row, appends `task_created`.

## Loop

```
loop:
  reconcile()                      # once at startup
  every tick (or when woken):
    task = active task, or pick one
    if none: sleep 30s
    state  = reduce(workflow, store.events(task))
    action = nextAction(workflow, state)
    execute(action)
    store.setTaskStatus(task, reduce(...).status)
```

`execute` for `watch` blocks on `herdr agent wait --timeout 2000` and then returns, so a tick is at most about 2 seconds and no CPU is spent between ticks. New in-pane events are picked up on the next tick.

A fatal error in `execute` (a port throws something that is not a typed, expected failure) is recorded as `blocked { reason: 'infra' }` for the task, then the loop continues. The supervisor process exits only on SIGINT/SIGTERM.

## Executing actions

| Action | Intent event | Port calls | Outcome event |
| :--- | :--- | :--- | :--- |
| `setup` | `setup_started` | git: create worktree and branch; system: run `workflow.setup.exec` | `setup_finished` |
| `start_attempt` (agent) | `attempt_started` | git: snapshot (and restore if `restoreSnapshot`); herdr: tab + start + prompt | `agent_ready` or `attempt_failed start_failed` |
| `start_attempt` (commands) | `attempt_started` | git: snapshot; gate runner | `gate_finished` |
| `watch` | – | herdr: wait, read; engine `watch` | `reminder_sent` / `attempt_failed` / `blocked` / nothing |
| `deliver` | `delivery_started` | git: commit, push; github: create or update PR | `delivered` or `delivery_failed` |
| `block` | – | herdr: leave the pane open for a human | `blocked` |

When an attempt reaches a terminal event, the supervisor closes its tab on the next tick. A blocked attempt's tab stays open.

## Reconciliation

Runs once on startup, before the first tick, for the active task:

| Found | Action |
| :--- | :--- |
| `setup_started` without `setup_finished` | remove the half-made worktree, then let the engine run `setup` again |
| Agent attempt running, pane alive in Herdr | re-adopt: keep watching; the timeout counts from `attempt_started.at` |
| Agent attempt running, pane gone | append `attempt_failed crashed` |
| Command attempt without `gate_finished` | append `attempt_failed crashed`; the engine restarts it (gates are idempotent) |
| `delivery_started` without outcome | look for the remote branch and the PR before doing anything; record `delivered` if the PR exists |

## Tests

All with in-memory port fakes and a fake clock:
- `feature` runs to `delivered` with scripted fake agents that call `done` / `verdict`.
- Killing the loop at every event boundary and restarting it ends in the same final event log (minus restart events).
- A port throwing an unexpected error blocks the task and the loop keeps running.
- No todo ready → no task created; dependencies respected.
