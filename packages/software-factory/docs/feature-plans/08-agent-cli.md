# Feature: Agent CLI

Implemented design spec. The commands agents run inside their pane.

## Scope

- Caller identification.
- `software-factory done`, `software-factory verdict`.
- `software-factory ask`, `tell`, `answer`, `escalate`.
- The CLI guide appended to every prompt.

## Files

```
src/cli/main.ts                  citty root, lazy subcommands
src/cli/commands/{done,verdict,ask,tell,answer,escalate}.ts
src/cli/caller.ts                env -> { root, taskId, attemptId } or error
```

## Caller

`FACTORY_ROOT`, `FACTORY_TASK` and `FACTORY_ATTEMPT` must all be set and the attempt must be running (feature 03, `runningAttempt`). Otherwise exit 1:

```
software-factory: this command only works inside a software-factory agent pane
factory: attempt build-2 is no longer running; stop working on it
```

These commands open the store directly and read only `events`. They never load roles or workflows (RULES 7.3).

## Commands

### `software-factory done`

1. For each artifact in `attempt_started.artifacts`: the file must exist and be non-empty.
2. Missing → exit 1, listing every missing path:
   ```
   factory: not done, missing artifacts:
     /…/.evidences/login-form/build-2/commit.txt
   ```
3. Judging attempt → exit 1, "use `software-factory verdict pass` or `software-factory verdict fail`".
4. Otherwise append `completed`, print "done; you can stop now", exit 0.

### `software-factory verdict pass|fail`

- Only for judging attempts.
- `fail` requires the `feedback` artifact to exist and be non-empty.
- Appends `verdict { pass, feedbackPath }`.

### `software-factory ask operator|human "<question>"`

In-pane. Refused for an empty question, a target other than `operator`/`human`, a second question while one is open, `operator` when the workflow has none, and from the operator pane. Appends `question_asked`, prints that the agent must stop and wait, exits 0. The attempt timeout is paused until `answered`; the answer arrives as a prompt in the same pane. `human` never starts the Operator.

### `software-factory tell <to> "<note>"`

In-pane. Appends `note`. Does not block. `<to>` is `human` or a step id of the caller's workflow; notes to a step are added to the context of its next attempts. Refused for an empty note and from the operator pane.

### `software-factory answer <taskId> "<text>"`

Any shell, no `FACTORY_*` needed. Requires an open question and a non-empty text; appends `answered`. The operator may not answer a question addressed to a human. `software-factory status` prints the exact command under the open question.

### `software-factory escalate <taskId> "<text>"`

Any shell. Requires a blocked task or an open question. Appends `escalated`; the engine then returns one final `block` carrying the text.

### `software-factory unblock <taskId> [--nudge "<text>"]`

Any shell. The action follows the block reason (no flag picks it):

| Block | Action |
| :--- | :--- |
| `retries_exhausted` | `unblocked { extraRetry: true }`; refused the second time in the task's life. |
| `runner_prompt` | `unblocked { nudge }`; `--nudge` text required; typed into the blocked pane. |
| `infra`, `no_retry`, `setup_failed`, `delivery_failed` | Refused: use `answer` or `escalate`. |

## Concurrency

Each command is a single `append`. Two `done` calls for the same attempt are harmless: `reduce` uses the first terminal event and ignores the rest.

## CLI guide

Generated per attempt from `templates/prompts/cli-guide.md` (feature 09), listing only the commands that attempt may use:
- worker: `done`, `ask`, `tell`;
- judge: `verdict pass`, `verdict fail`, `ask`, `tell`;
- operator: `done`, `answer`, `unblock`, `escalate`.

## Tests

- Each rejection message, with a fake store.
- `done` with all artifacts → `completed` appended.
- A judge calling `done`, a worker calling `verdict` → rejected.
- Startup time: `software-factory done` with lazy imports under 100 ms on CI (a guard against a lazy-import regression, not a benchmark).
