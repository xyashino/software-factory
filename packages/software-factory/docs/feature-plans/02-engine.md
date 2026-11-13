# Feature: Engine

Implemented design spec. The core of the package. Pure functions that turn a workflow plus a task's event history into the next thing to do.

## Scope

- Event and action types.
- `reduce`: events -> `TaskState`.
- `nextAction`: state -> one action.
- `watch`: decides reminders, nudges, stalls and timeouts for a running attempt.

## Files

```
src/engine/
  events.ts        FactoryEvent union + zod schemas
  actions.ts       SupervisorAction union
  state.ts         TaskState, AttemptState
  reduce.ts        reduce(workflow, events) -> TaskState
  next-action.ts   nextAction(workflow, state) -> SupervisorAction
  watch.ts         watch(attempt, observation, now, policy) -> WatchDecision
  context.ts       which inputs and feedback an attempt receives
```

No file here imports anything outside `src/engine/` and `src/definitions/types.ts` (RULES 1.2).

## Events

Every event has `seq` (store order), `at` (ms), `taskId`.

```ts
type FactoryEvent =
  | { type: 'task_created'; workflow: string; todoPath: string; branch: string }
  | { type: 'setup_started' } | { type: 'setup_finished'; ok: boolean; log: string }
  | { type: 'attempt_started'; attemptId: string; stepId: string; n: number;
      restartOf?: string; feedbackFrom?: string; snapshotRef: string;
      artifacts: Record<string, string> }                 // absolute paths, for the in-pane CLI
  | { type: 'agent_ready'; attemptId: string; pane: string; tab: string }
  | { type: 'completed'; attemptId: string }
  | { type: 'verdict'; attemptId: string; pass: boolean; feedbackPath?: string }
  | { type: 'gate_finished'; attemptId: string; passed: boolean; failures: GateFailure[] }
  | { type: 'attempt_failed'; attemptId: string;
      reason: 'timed_out' | 'crashed' | 'stalled' | 'start_failed'; detail: string }
  | { type: 'reminder_sent'; attemptId: string; kind: 'idle' | 'silent' }
  | { type: 'question_asked'; attemptId: string; questionId: string; to: 'operator' | 'human'; text: string }
  | { type: 'answered'; questionId: string; by: string; text: string }
  | { type: 'note'; attemptId: string; to: string; text: string }
  | { type: 'blocked'; reason: BlockReason; detail: string }
  | { type: 'unblocked'; by: string }
  | { type: 'delivery_started'; to: 'new-pr' | 'open-pr' | 'blocked-pr' }
  | { type: 'delivered'; prUrl: string }
  | { type: 'delivery_failed'; detail: string };

interface GateFailure { command: string; exitCode: number | null; timedOut: boolean; tail: string; logPath: string }
type BlockReason = 'retries_exhausted' | 'no_retry' | 'infra' | 'setup_failed'
                 | 'runner_prompt' | 'question' | 'delivery_failed';
```

`attemptId` is `<stepId>-<n>`; `n` counts every attempt of that step in the task, starting at 1.

## State

```ts
interface AttemptState {
  attemptId: string; stepId: string; n: number;
  status: 'starting' | 'running' | 'completed' | 'passed' | 'failed';
  outcome?: 'done' | 'verdict_pass' | 'verdict_fail' | 'gate_pass' | 'gate_fail'
          | 'timed_out' | 'crashed' | 'stalled' | 'start_failed';
  startedAt: number; lastOutputAt?: number;
  reminders: { idle: number; silent: number };
  restartOf?: string; feedbackFrom?: string;
}

interface TaskState {
  status: 'setting_up' | 'running' | 'waiting' | 'blocked' | 'delivering' | 'delivered';
  cursor: number;                          // index into workflow.steps
  current?: AttemptState;                  // the attempt in flight, if any
  attempts: AttemptState[];
  retriesUsed: Record<string, number>;     // by failing step id, lifetime, never reset
  pendingFeedback?: { forStep: string; fromAttempt: string };
  lastPassed: Record<string, string>;      // stepId -> attemptId whose artifacts are current
  openQuestion?: { questionId: string; to: 'operator' | 'human' };
  block?: { reason: BlockReason; detail: string };
}
```

`reduce` is a left fold. It ignores events for an attempt that is no longer current (a late `completed` after a timeout), so they can never move the task.

## Actions

```ts
type SupervisorAction =
  | { type: 'setup' }
  | { type: 'start_attempt'; stepId: string; n: number; restartOf?: string;
      feedbackFrom?: string; restoreSnapshot?: string }
  | { type: 'watch'; attemptId: string }
  | { type: 'deliver'; to: 'new-pr' | 'open-pr' }
  | { type: 'block'; reason: BlockReason; detail: string }
  | { type: 'idle' };   // blocked or waiting for an answer: nothing to do
```

## `nextAction` decision table

Evaluated top to bottom; the first matching row wins.

| State | Action |
| :--- | :--- |
| `delivered` or `blocked` | `idle` |
| No `setup_finished` | `setup` |
| `setup_finished.ok = false` | `block setup_failed` |
| Open question | `idle` |
| `current.status` is `starting` or `running` | `watch` |
| Current attempt: `done`, `verdict_pass`, `gate_pass` | advance cursor; past the last step → `deliver`, else `start_attempt` of the next step |
| Current attempt: `verdict_fail` or `gate_fail`, step has `onFail`, `retriesUsed[step] < max` | `start_attempt` of `onFail.retry`, `feedbackFrom` = this attempt, cursor moves back to it |
| Same, retries exhausted | `block retries_exhausted` |
| Same, no `onFail` | `block no_retry` |
| Current attempt: `timed_out`, `crashed`, `stalled`, `start_failed`, and it is not itself a restart | `start_attempt` of the same step, `restartOf` set, `restoreSnapshot` = its snapshot ref, same `feedbackFrom` |
| Same, and it is a restart | `block infra` |
| No current attempt | `start_attempt` of `steps[cursor]` |

Notes:
- A judge's or gate's failure increments `retriesUsed[<failing step>]`, never the retried step's.
- An infrastructure restart keeps the original's `feedbackFrom`, so a worker restarted after a crash still sees the gate failure it was fixing.
- Retrying jumps the cursor back, so every step after the retry target runs again in order.

## `watch`

```ts
interface Observation {
  agent: 'working' | 'idle' | 'blocked' | 'gone' | 'unknown';
  lastOutputAt: number;
}
interface WatchPolicy { idleReminders: 2; silentMs: 300_000; silentNudges: 1 }

type WatchDecision =
  | { type: 'none' }
  | { type: 'remind'; kind: 'idle' | 'silent' }
  | { type: 'fail'; reason: 'timed_out' | 'crashed' | 'stalled' }
  | { type: 'block'; reason: 'runner_prompt' };
```

Order: timeout (`now - startedAt >= step timeout`) → `gone` → `blocked` → idle without completion (remind until 2, then fail stalled) → working but silent for `silentMs` (nudge once, then fail stalled) → `none`.

The supervisor records the decision as an event (`reminder_sent`, `attempt_failed`, `blocked`), so `watch` stays pure and its counters come from state.

## Context for an attempt

`context.ts` computes, for a `start_attempt`:
- the artifact path for each `inputs` ref, from `lastPassed[step]`;
- the feedback: the failing attempt's feedback artifact (judge) or its `GateFailure[]` (gate).

Rendering into text happens in feature 09; the engine only says what goes in.

## Tests

Table-driven: each test is a workflow fixture, a list of events and the expected action.

- `feature` happy path, every step.
- Plan review fails twice, passes third → continues; fails three times → `block retries_exhausted`.
- Gate fails → build retried with gate feedback → gate passes → audit.
- Audit fails → build → gate runs again → audit.
- Lifetime counting: gate fails 3 times across two audit rounds → block on the 4th.
- Crash → restart with snapshot; second crash → `block infra`; restart keeps `feedbackFrom`.
- Late `completed` after `attempt_failed` is ignored.
- `watch`: each row of the order above, with boundary times.
- Property test: for random event sequences built from valid actions, the number of build attempts in `feature` never exceeds 6 plus restarts.
