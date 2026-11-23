# `sf operator` — plan

Terms: [glossary](./README.md#glossary). Source of truth for the endpoint, the verbs' effects and the server rules:
[`factory.md` §11](./factory.md) and [`engineering.md`](./engineering.md). This file describes
only the client. Wire shapes: `apps/sf/src/contracts/operator.contract.ts`.

## Client rules

- Thin client: parse, read named files, send one request, print the reply. No Line rules.
- Localhost only: talks only to `$FACTORY_OPERATOR_URL`.
- Never write the token to disk or logs; never print it.
- One request per invocation, no retry. The agent decides whether to send again.

## 1. Role

`operator` is a thin client. An agent runs it from its shell to report back to its Cell.

It does three things:

1. Parse the verb and its options.
2. Read any file an option names (`--feedback`, `--handover`, `--report`). `-` reads stdin.
3. Send one request to `$FACTORY_OPERATOR_URL` with the token from `$FACTORY_CYCLE_TOKEN`, and print the reply.

It never decides what happens next. The Cell checks local facts, and the server decides every state
change ([`factory.md`](./factory.md) §11.3).

## 2. Callers

| Role | Runs for | Verbs |
| :--- | :------- | :---- |
| Operator | A station job | `done`, `verdict pass`, `verdict fail`, `block`, `context` (open, §8) |
| Mechanic | A `mechanic` job for an incident | `read`, `incident`; `answer` is open (§8) |

## 3. Commands

### 3.1 Operator

| Command | Options | Meaning |
| :------ | :------ | :------ |
| `done` | none | Station finished |
| `verdict pass` | none | Review station passes |
| `verdict fail` | `--feedback <file>` (`-` reads stdin) | Review station fails; the file is the feedback |
| `block` | `--reason "<why>"`, `--handover <file>` | Stop; opens an `operator_blocked` incident |
| `context` | none | Print the job's inputs and outputs (read-only) |

### 3.2 Mechanic

| Command | Options | Meaning |
| :------ | :------ | :------ |
| `read` | none | Print the incident, step states, `.cell/` files and logs (read-only) |
| `incident` | `--action <retry_step\|restart_from_step\|restart_from_scratch\|escalate\|cancel>`, `--step <step-id>`, `--diagnosis "<what happened>"`, `--outcome "<what he tried>"`, `--report <file>` | Record and apply the resolution |

`--step` is required for `restart_from_step`. `--report` is required for every `incident`, including
`escalate`. `escalate` is the way a Mechanic says it cannot fix the incident in time: the Work order
goes to `blocked` and the Supervisor takes over.

The report file has three sections, written by the agent: `## What happened`, `## What he tried`,
`## Potential fix`.

## 4. Exit codes

| Code | Meaning |
| :--- | :------ |
| `0` | Server replied `200`. Prints `ok: true` |
| `1` | Refused: `400`, `401`, `409`, `500`. Prints `code: message` from the reply |
| `2` | Bad arguments, a missing environment variable, or an unreadable file. Sends nothing |
| `3` | Endpoint unreachable, or the reply cannot be read |

## 5. What the CLI checks, and what it leaves to others

| Check | CLI | Cell | Server |
| :---- | :-- | :--- | :----- |
| Verb name is known | yes | | |
| Required flag is present (`--reason`, `--feedback`, `--report`, `--action`, `--step` for `restart_from_step`) | yes | | |
| `--action` is one of the five values | yes | | |
| File named by an option can be read | yes | | |
| Token matches the job; verb allowed for the role | | yes | |
| Required files and git state | | yes | |
| Verb allowed for the job's state, step kind, incident reason | | | yes |
| Report is non-empty | | | yes |
| `--step` names a real step | | | yes |

The CLI checks syntax. Anything that needs the Line, the job state or the epoch is the server's job.

## 6. Request

One `POST /` per invocation with JSON `{ verb, ...fields, token }`.

File contents go in the request body as UTF-8 text. The CLI never sends a file path.

## 7. Not in the CLI

- `answer` for the Supervisor. The Supervisor uses `sf answer`, if that exists ([`factory.md`](./factory.md) §11.6).
- `ask` and `tell`. Not in the current design (§8).
- `--change`. The Mechanic does not edit files or config (decision `20261113-230000`).
- `resume`, `nudge`, `repair`. Not in the new core.
- A separate `escalate` command. It is `incident --action escalate`.

## 8. Open

These are decided in [`factory.md`](./factory.md) §11.6. The CLI follows that decision.

1. `answer` (Mechanic): no question exists in the new core. Included only if a question entity is added.
2. `context` (Operator): keep or drop.
3. `tell`: keep or drop.
4. Transport: loopback TCP or a Unix socket.
5. Environment names `FACTORY_OPERATOR_URL` and `FACTORY_CYCLE_TOKEN`.

## 9. Name

The command is `sf operator`. Renaming `FACTORY_CYCLE_TOKEN` / `FACTORY_OPERATOR_URL` is a separate change.
