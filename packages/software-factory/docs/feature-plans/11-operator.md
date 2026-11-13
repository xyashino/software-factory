# Feature: On-Call Operator

Implemented design spec. An LLM that tries to unblock a task before a human is needed.

## Scope

- When the Operator is invoked.
- The `operator` role.
- Its limits.

## When

The engine returns `start_operator` for a task that is blocked with reason:
- `retries_exhausted` (only while the one extra retry has not been granted), `infra`, `runner_prompt`;
- or has an open `question_asked` with `to: 'operator'`.

Never for:
- `question_asked` with `to: 'human'`;
- `setup_failed`, `delivery_failed`, `no_retry` (environment problems or a workflow without a retry; a human fixes them);
- a block that the Operator itself caused (no Operator for the Operator);
- a workflow without an `operator:` entry.

## One Operator per incident (D1)

An incident starts at the first `blocked`, or at a `question_asked`. It ends at `unblocked` or at the next `question_asked`.
- `operatorRan` is set by the operator's `attempt_started`.
- Only `unblocked` and `question_asked` reset it. A repeated `blocked` (an escalation recorded as a block, or the operator's own `blocked infra` after it changed the worktree) stays in the same incident, so no second Operator starts.
- An Operator that fails (timeout, crash, stall, start failure) leaves the task waiting for a human.
- A new incident after an `unblock` may start the Operator again. Only the extra retry is capped per task (D10: repeated `runner_prompt` incidents are not capped).

## How

- The Operator is an attempt with `stepId: 'operator'`, not a workflow step. `reduce` keeps it in `state.operator`; it never moves `current` or `cursor`, and late events of the blocked worker still apply.
- It runs in its own tab (`operator#<n>`) in the task's workspace, with the worktree as cwd, while the blocked agent's pane stays open.
- Runner and model: the top-level `operator:` agent in `workflows/<name>.yml`, same shape as a pool entry. The role is `roles/operator.md` (not a judging role; artifact `report`).
- Input (`templates/prompts/incident.md`): the block reason and detail, the last 50 lines of the blocked pane (`runner_prompt` only), the latest judge or gate feedback. The prompt names `sf log <taskId>`; it is not inlined.

## Allowed actions (D3, D8)

| Command | Effect |
| :--- | :--- |
| `sf answer <taskId> "<text>"` | Answers the open question; the waiting agent is prompted with `templates/prompts/answer.md`. Refused for a question addressed to a human. |
| `sf unblock <taskId> [--nudge "<text>"]` | The block decides. `retries_exhausted`: one extra retry per task (refused the second time). `runner_prompt`: `--nudge` text is typed into the blocked pane. `infra`, `no_retry`, `setup_failed`, `delivery_failed`: refused; use `answer` or `escalate`. |
| `sf escalate <taskId> "<text>"` | Appends `escalated`. The engine returns one final `block` with the text; the supervisor records `blocked` and publishes the draft `[BLOCKED]` PR once. |
| `sf done` | Finishes the operator attempt. |

It has no `ask`, `tell` or `verdict`, and no command to restore, reset or edit the worktree.

## Worktree guard (D5, D9)

The prompt forbids editing files (RULES 5.6). Enforcement is a post-check: when the operator attempt ends, the supervisor compares the worktree with the operator's snapshot (`GitPort.differsFromSnapshot`) and records `operator_checked`. A change records `blocked infra "operator changed worktree"`, publishes the draft PR, and never reverts. The runner may still write before the check; the check is the enforcement.

An operator that ended with the incident open (block or question still set, no escalation) is escalated by the supervisor.

## Engine changes

- Events: `unblocked { by, nudge?, extraRetry? }`, `escalated { text }`, `prompt_delivered { attemptId, kind }`, `operator_checked { attemptId, changed }`.
- State: `openQuestion { questionId, to, attemptId, text, askedAt }`, `notes`, `operator`, `operatorRan`, `operatorChecked`, `extraRetry`, `pendingPrompts`, `escalation`; `AttemptState.pausedMs`/`pausedSince`.
- Actions: `start_operator`, `deliver_prompt`.
- The extra retry adds one to the failing step's `onFail.max` (D2); a second exhaustion goes to a human.

## Tests

- Exhausted gate retries → Operator starts → `unblock` grants one retry → build runs again; a second exhaustion goes straight to a human.
- `ask human`, setup failures and delivery failures never start the Operator.
- Operator escalates → block re-recorded → no second Operator (F1).
- Operator changed the worktree → `blocked infra` → no second Operator (F2).
- Operator fails → task stays blocked for a human.
- Happy path of `feature`, `review`, `standard` and `fast`: zero operator attempts.
