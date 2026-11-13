# Feature: Board and Log

Implemented design spec. Read-only views for humans.

## Scope

- `software-factory status`: live board.
- `software-factory log <taskId>`: event trail.

## `software-factory status`

Reads the store; never talks to Herdr. With `--watch`, redraws every second (clear screen + draw, no diffing in the MVP).

```
login-form   feature   build   14m
  plan          planner        claude/opus          done     4m
  plan-review   plan-reviewer  codex/gpt-5.6-codex  pass     2m
  build         worker         claude/sonnet        running  5m   attempt 2, gate retry 1/3
  quality-gate  -              -                    failed   1m   check-types, lint
  audit         doctor         claude/sonnet        -
```

- One block per task in `running`, `waiting`, `blocked` or `delivering`, plus the last 5 delivered as one line each with their PR URL.
- Each step row shows the latest attempt of that step.
- Blocked tasks show the reason and, for questions, the question text and the `software-factory answer` command to run.
- Colors via `picocolors`; disabled when stdout is not a TTY.

## `software-factory log <taskId>`

One line per event, oldest first:

```
14:02:11  attempt_started   build-2  feedback from quality-gate-1
14:02:15  agent_ready       build-2  pane w3:p2
14:09:40  completed         build-2
14:09:41  attempt_started   quality-gate-2
14:11:02  gate_finished     quality-gate-2  failed: pnpm lint (exit 1)
```

`--json` prints the raw events, for the Operator and for debugging.

## Tests

- Snapshot tests of both views from fixed event logs, colors off.
