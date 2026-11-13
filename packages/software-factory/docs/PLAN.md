# SoftwareFactory: Architecture & Implementation Plan

> **Implemented.** This file is the architecture overview; where a feature spec is more specific, the spec wins.

**Docs map**

- [RULES.md](RULES.md): hard implementation rules.
- [STACK.md](STACK.md): runtime and dependencies.
- [STRUCTURE.md](STRUCTURE.md): package source tree, definitions location, runtime data layout.
- [DEFINITIONS.md](DEFINITIONS.md): how roles, workflows and templates are written and stored.
- [feature-plans/](feature-plans/): implemented design specs, one per feature (01 definitions … 12 board and log): contracts and state machines.

This file is the overview. Where a feature spec is more specific, the feature spec wins.

---

## Goal

A software factory: an AI harness that turns a todo into a verified, high-quality Pull Request by running agents on an assembly line, the way a factory runs specialized workstations.

The core of the package is the **engine**: a pure, deterministic state machine that decides what happens next. Everything else (Herdr, git, GitHub, the CLI) is an adapter around it.

1. **Deterministic Engine:** The supervisor is code. No LLM decides what runs next on the happy path.
2. **Declarative Lines:** Adding a workstation role requires one markdown file (`roles/<id>.md`). Adding a workflow requires one YAML file (`workflows/<name>.yml`). No TypeScript is needed for either. Adding a new _runner_ does need a small TypeScript adapter (model and permission flags differ per CLI).
3. **Runner-Agnostic:** Claude Code, OpenAI Codex, Cursor, Antigravity, or OpenCode can fill any workstation. Herdr runs them all in interactive panes.
4. **Structured & Auditable:** Handoffs occur only via stored artifacts. Completion, verdicts, questions and answers pass through `factory` CLI commands and are persisted as an event stream.
5. **First-Class Quality Gates:** Command gates (`check-types`, `lint`, `test`) run between agent steps and feed their cleaned output back to the worker.

---

## Principles

| Principle                                                            | Meaning                                                                                                                                                                                                                                    |
| :------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The engine is pure**                                               | `nextAction` takes the workflow and the task's event history and returns one action. It performs no I/O. The supervisor executes the action through ports and records the outcome as an event.                                             |
| **Agents reach the harness only through the `software-factory` CLI** | Every runner has a shell. `software-factory done`, `verdict`, `ask`, `tell` work identically across runners, without runner-specific plugins.                                                                                              |
| **Only Herdr touches terminals**                                     | Starting, prompting, reading, and stopping agents is always done via Herdr. Liveness and status come from Herdr, never from runner internals.                                                                                              |
| **Everything is an event**                                           | Attempts, completions, verdicts, gate runs, nudges and messages are recorded in SQLite (`.evidences/software-factory.db`). The board and every engine decision read from this store, so a restarted supervisor continues where it stopped. |
| **The workflow decides topology and cost**                           | Agents (role, runner, model, timeout) are declared in an `agents:` pool. Sequence, gates and retry limits are declared in `steps:`.                                                                                                        |
| **One thing at a time**                                              | The MVP runs one task at a time, and one agent at a time inside that task's worktree (`.worktrees/<taskId>`). No concurrency conflicts, no lockfile races.                                                                                 |
| **Port, do not rewrite**                                             | Working adapters and procedures from `packages/factory` are carried over (see [Reuse](#reuse-from-packagesfactory)). Only the engine, the definitions and the store schema are new.                                                        |

---

## Parts

```
todos/ ──▶ supervisor ──▶ Herdr ──▶ agents (any runner)
           │  ▲                        │
  engine ◀─┘  │                        │
 (pure)       └── store (events) ◀─────┘  via `software-factory` CLI
                    ▲
                    └── board: `software-factory status`
```

- **Engine**: `nextAction(workflow, task, events)`. Pure function, no I/O, fully unit-tested.
- **Supervisor**: A long-running process (`software-factory run`). Loop: observe → record events → ask the engine → execute the action through ports.
- **Store**: SQLite in `.evidences/software-factory.db` (WAL mode). An append-only `events` table plus a `tasks` listing cache. Attempts and messages are projections of events; artifacts are files under `.evidences/<taskId>/<attemptId>/`.
- **Herdr**: Terminal workspace manager. Maps `task -> workspace`, `attempt -> tab`, `agent -> pane`.
- **`software-factory` CLI inside a pane**: How an agent reports completion or asks questions. Tab environment variables (`FACTORY_ROOT`, `FACTORY_TASK`, `FACTORY_ATTEMPT`) identify the caller.

### Source Layout

```
roles/ workflows/ templates/   definitions, read from disk
src/
  definitions/   parsing, zod schemas, load-time validation
  engine/        pure: events, state, reduce, nextAction, watch
  prompts/       rendering roles and templates
  ports/         interfaces: store, herdr, runner, git, system, github, clock
  adapters/      real implementations of the ports
  supervisor/    the run loop, execution, reconciliation, gates
  cli/           citty commands
  testing/       port fakes for tests
```

Full tree, import rules and runtime paths: [STRUCTURE.md](STRUCTURE.md).

### Todo Selection

- `software-factory run` picks the next ready todo from `todos/` by `priority`, honoring `depends_on`.
- A todo selects its workflow with `workflow: <name>` in its frontmatter; the default is `feature`. Choose `standard` for routine features and refactors (worker builds from the todo, doctor audits), `fast` for chores, docs and style (worker builds, gate only).

---

## Role: `roles/<id>.md`

A role specifies what an agent is and what artifacts it must produce. A role never names a runner or a model.

```markdown
---
id: planner # must match the file name: roles/planner.md
label: Architecture Planner
artifacts: # key -> file the agent writes into its attempt dir
  plan: plan.md
---

Plan {{taskId}}. {{todoBody}}{{context}} Write {{planPath}}, then run `software-factory done`.
```

### Completion

Completion is an explicit event, not a file that happens to appear:

- **`software-factory done`**: checks that every artifact declared by the role exists and is non-empty in the attempt directory. If one is missing it exits non-zero and names the missing files, so the agent corrects itself immediately. On success it records the `completed` event.
- An agent that goes idle without calling it is handled by the watch loop (reminder, then failure).

### Judging Roles

A judging role sets `verdict: true`. It finishes with a verdict instead of `software-factory done`:

```markdown
---
id: plan-reviewer
label: Plan Reviewer
verdict: true
artifacts:
  feedback: feedback.md
---

Review the plan for {{taskId}} against requirements:
{{context}}

If the plan is good, run `software-factory verdict pass`.
Otherwise explain why in {{feedbackPath}} and run `software-factory verdict fail`.
```

- `software-factory verdict pass` records a passing verdict; the `feedback` artifact is optional.
- `software-factory verdict fail` requires the `feedback` artifact and is rejected without it.

### Prompt Variables

- Standard: `taskId`, `attemptId`, `artifactDir`, `evidenceDir`, `todoBody`, `context`, `<artifactKey>Path`.
- `context`: Injected artifacts from the step's `inputs`, plus feedback from a failed review or gate.
- Input size limit: An input artifact over 12,000 characters is not inlined; the prompt provides the absolute file path instead.
- Validation: Any unmapped `{{name}}` in the template produces a load-time error.
- Standard Guide: The supervisor appends a concise list of allowed `software-factory` CLI commands to every prompt.

### Supervisor Templates

Text the supervisor itself sends (reminders, nudges, gate and review feedback, the CLI guide, answers) lives in `templates/prompts/*.md`, read from disk and rendered with the same `renderTemplate`. Each template has a fixed variable list checked by `software-factory check`. PR bodies are markdown templates in `templates/pr/` (`body.md`, `blocked.md`, `report.md`), loaded with the same reader and checked by `software-factory check` against `PR_TEMPLATE_VARS`. Code only prepares the variables (`format-pr-body.ts`, `deliver.ts`). Details: [feature-plans/09-prompts-and-templates.md](feature-plans/09-prompts-and-templates.md).

### First Roles

`planner`, `plan-reviewer`, `worker`, `doctor`. The `operator` role handles incident triage.

---

## Workflow: `workflows/<name>.yml`

Workflows declare:

1. A **`setup:` block**: commands run once when the task's worktree is created (`pnpm install --frozen-lockfile`), with a timeout.
2. An **`agents:` pool**: reusable agent configurations (role, runner, model, timeout).
3. A **`steps:` list**: ordered pipeline steps. Order in the list is the execution order.
4. A **`deliver:` block**: what is committed and where it goes.
5. An optional **`operator:`** agent, same shape as a pool entry. Without it, blocked tasks go straight to a human.

Every successful step advances to the next one. Reaching the end of the list means every gate and every judge passed, so the task is delivered.

### Standard Workflow (`workflows/standard.yml`)

Bypasses planning: `build` (worker, from the todo body) -> `quality-gate` (retry `build`, max 3) -> `audit` (doctor, input `build.report`, retry `build`, max 2). Delivers `build.commit` and `build.report` to a new PR.

### Fast Workflow (`workflows/fast.yml`)

Bypasses planning and audit: `build` (worker, 40m) -> `quality-gate` (retry `build`, max 3). Delivers `build.commit` and `build.report` to a new PR. For chores, docs and style fixes.

### Feature Workflow (`workflows/feature.yml`)

```yaml
name: feature
description: Plan, review the plan, build with automated quality gate, and audit

setup:
  timeout: 10m
  exec: [pnpm install --frozen-lockfile]

agents:
  planner: { role: planner, runner: claude, model: opus, timeout: 20m }
  plan-reviewer:
    { role: plan-reviewer, runner: codex, model: gpt-5.6-codex, timeout: 10m }
  worker: { role: worker, runner: claude, model: sonnet, timeout: 60m }
  doctor: { role: doctor, runner: claude, model: sonnet, timeout: 20m }

steps:
  - id: plan
    type: agent
    agent: planner

  - id: plan-review
    type: agent
    agent: plan-reviewer
    inputs: [plan.plan]
    onFail: { retry: plan, max: 2 }

  - id: build
    type: agent
    agent: worker
    inputs: [plan.plan]

  - id: quality-gate
    type: commands
    timeout: 15m
    exec:
      - pnpm check-types
      - pnpm lint
      - pnpm test
    onFail: { retry: build, max: 3 }

  - id: audit
    type: agent
    agent: doctor
    inputs: [plan.plan, build.report]
    onFail: { retry: build, max: 2 }

deliver:
  commit: build.commit
  report: build.report
  to: new-pr
```

### Step Types

1. **Agent Step (`type: agent`):**
   - `agent`: a key in the top-level `agents:` pool. Whether the step judges is decided by the role (`verdict: true`), not by the step.
   - `inputs`: artifact references (`<stepId>.<artifactKey>`).
   - `onFail`: `{ retry: <stepId>, max: <count> }`. Applies to a failing verdict.

2. **Commands Step (`type: commands`):**
   - `exec`: shell commands run in `.worktrees/<taskId>`.
   - `timeout`: required; bounds the whole step.
   - `onFail`: `{ retry: <stepId>, max: <count> }`. Applies to any non-zero exit or the timeout.

### Retry Semantics

- **What a retry does:** the engine jumps back to the `retry` step and runs forward from there. After `audit` fails, `build` reruns and `quality-gate` runs again before `audit` sees the result.
- **What `max` counts:** the number of retries _this step_ may trigger over the task's whole lifetime. The counter never resets. `plan-review` with `max: 2` allows at most 3 plans. In `feature`, the gate (3) and the audit (2) together allow at most 6 builds.
- **Exhausted:** when a step fails with no retries left, the task blocks.
- **No `onFail`:** a failing step without `onFail` blocks the task immediately.
- **Fresh session per attempt:** every attempt starts a new agent in a new tab. Nothing carries over in the agent's memory; context comes only from `inputs` plus the feedback of the failure that caused the retry. The worktree is kept, so the retry fixes forward.
- **Infrastructure failures are separate:** a crash, a stall or a step timeout does not consume `onFail.max`. Each attempt gets one automatic restart; a second infrastructure failure blocks the task.

### Load-Time Validation Rules

`software-factory check` (also run on supervisor startup) rejects invalid configurations:

- Step `id`s are unique; the file name matches the workflow `name`.
- `setup.exec` is non-empty and `setup.timeout` is set.
- Every step `agent` exists in the `agents:` pool; every pool `role` exists in `roles/<role>.md`; every `runner` has an adapter.
- `inputs` reference artifacts produced by an earlier step or a supported `task.*` source.
- `onFail.retry` points to an earlier step of `type: agent`.
- An agent step may declare `onFail` only if its role is judging.
- `commands` steps declare `timeout`.
- `deliver.commit` and `deliver.report` point to artifacts produced by a step.

---

## Engine

```ts
nextAction(workflow: Workflow, task: Task, events: FactoryEvent[]): SupervisorAction
```

The engine derives everything from the event history: the current step, attempt numbers, retry counters, and pending feedback. It holds no state of its own, so it can be tested without Herdr, git or a database, and it gives the same answer after a restart.

Actions:

- `start_agent_step`: create the attempt, open a tab, start the runner, send the prompt.
- `run_command_step`: run the gate commands in the worktree.
- `wait`: an attempt is running; keep watching.
- `restart_attempt`: restore the snapshot and start the same attempt again after an infrastructure failure.
- `deliver`: commit, push, create or update the PR.
- `deliver_blocked`: open a `[BLOCKED]` PR when the task blocks with work in the worktree.
- `block`: halt the task with a reason.

Events (inputs to the engine): `attempt_started`, `completed`, `verdict`, `gate_finished`, `attempt_timed_out`, `attempt_crashed`, `attempt_stalled`, `question_asked`, `answered`, `delivered`.

### Supervisor Loop

`software-factory run` is the only thing that moves a task forward:

1. Observe: read new events from the store (written by the `software-factory` CLI in panes) and the agent's state from Herdr.
2. Record observations as events (timeout, crash, stall).
3. Ask the engine for the next action.
4. Execute it through the ports and record the outcome.

While an attempt runs, the supervisor waits on `herdr agent wait` with a short timeout and re-checks the store on every wake, instead of busy polling.

| Observed State                                          | Supervisor Reaction                                                        |
| :------------------------------------------------------ | :------------------------------------------------------------------------- |
| **`completed` or `verdict` event**                      | Stores artifacts, closes the tab, advances.                                |
| **Agent idle, no completion event**                     | Sends a reminder. After 2 unheeded reminders the attempt fails as stalled. |
| **No terminal output for 5m while working**             | Sends one nudge; if still silent, the attempt fails as stalled.            |
| **Step `timeout` reached**                              | Closes the tab; the attempt fails as timed out.                            |
| **Pane or runner process disappeared**                  | The attempt fails as crashed.                                              |
| **Agent blocked on a runner prompt (auth, permission)** | Task blocks with the terminal context attached.                            |

Stalled, timed-out and crashed attempts follow the infrastructure-failure rule above.

### Restart Reconciliation

The supervisor may be stopped at any point. On startup, for every attempt recorded as running:

- **Pane still alive in Herdr:** re-adopt it. The step timeout is measured from the stored start time.
- **Pane gone:** record `attempt_crashed` and let the engine decide.
- **Command step was running:** run it again; gates are idempotent.
- **Delivery was in progress:** check for the pushed branch and the PR before creating either.

### Quality Gates

Command steps run inside `.worktrees/<taskId>`:

1. Every command in `exec:` runs, even after an earlier one fails. Retry rounds are the scarce budget, so the worker should see type and lint failures together.
2. If all exit `0`, the gate passes.
3. Otherwise, for each failing command the supervisor builds feedback: the command, its exit code, and its output with ANSI codes stripped, truncated to the last 12,000 characters. The full log is saved as an artifact and its path is included.
4. The feedback is recorded on the `gate_finished` event and injected into the retried step's `{{context}}`.

There is no LLM in this path.

### Worktree Snapshots

- Before every agent step and command step the supervisor creates a snapshot ref: `refs/software-factory/<taskId>/<stepId>/<attemptId>`.
- Built with a temporary git index, so the worktree's own index is untouched. Ignored files (`node_modules`) are not part of a snapshot.
- Only the supervisor restores snapshots, and only for `restart_attempt`: tracked files are reset and untracked files removed.
- Retries after a failed review or gate do not restore; they fix forward.

---

## Communication & Incident Triage

| Command                                    | Who              | Effect                                                                         |
| :----------------------------------------- | :--------------- | :----------------------------------------------------------------------------- |
| `software-factory ask operator "..."`      | Agent            | Blocks the attempt; the Operator is asked first.                               |
| `software-factory ask human "..."`         | Agent            | Blocks the attempt; goes straight to the human. The Operator never answers it. |
| `software-factory tell <name> "..."`       | Agent            | Records a note for a later step or the human. Does not block.                  |
| `software-factory answer <taskId> "..."`   | Operator / Human | Answers the open question; the task resumes.                                   |
| `software-factory escalate <taskId> "..."` | Operator         | Hands the incident to a human.                                                 |

When a task blocks on exhausted retries, a double infrastructure failure, a runner prompt, or `ask operator`, the supervisor invokes the on-call Operator once per block (never for `ask human`, setup failures or delivery failures):

- Role: `roles/operator.md`, in its own Herdr tab, runner and model from the workflow's `operator:` agent.
- Context: `software-factory log <taskId>`, the last 50 lines of the blocked pane, gate feedback, the blocking event.
- It can do exactly three things:
  - `software-factory answer <taskId> "..."`: answer the open question.
  - `software-factory unblock <taskId> --nudge "..."`: send instructions to the blocked pane, or grant exactly one extra retry with the text as feedback. Once per task.
  - `software-factory escalate <taskId> "..."`: leave the task blocked with a summary for a human.
- It cannot edit or revert the worktree. Restoring files is the supervisor's job.
- **Cost:** zero tokens on happy-path runs.

Details: [feature-plans/11-operator.md](feature-plans/11-operator.md).

Without an `operator:` agent, a blocked task simply waits for a human.

---

## Live Terminal Board

`software-factory status` renders live state from SQLite:

```
login-form   feature       build #2   14m
  plan         planner       claude/opus       done      4m
  plan-review  plan-reviewer codex/gpt-5.6     pass      2m
  build        worker        claude/sonnet     working   5m   attempt 2 (gate retry 1/3)
  quality-gate -             -                 failed    1m   check-types, lint failed
  audit        doctor        claude/sonnet     -
```

`software-factory log <taskId>` prints the chronological event trail: attempts, messages, gate runs and verdicts.

---

## Assembly Line Worker Flow

```
supervisor                   worker                        quality-gate / doctor
    │ snapshot, new tab,        │
    │ prompt + plan context     │
    ├──────────────────────────▶│ 1. reads plan & codebase
    │                           │ 2. edits code in worktree
    │                           │ 3. creates decisions/<id>.md
    │                           │ 4. writes report.md, commit.txt
    │◀── `software-factory done` ────────┤
    │ run quality-gate commands ├────────────────────────────▶ check-types, lint, test
    │                           │
    ├─ gate fails ──────────────┤
    │  cleaned output becomes   │
    │  feedback; new build      ├────────────────────────────▶ fresh worker fixes forward
    │  attempt                  │
    ├─ gate passes              │
    │  new audit tab            │
    │  prompt doctor ───────────┼────────────────────────────▶ doctor reviews diff, plan,
    │                           │                              and report.md
    │◀── `software-factory verdict` ─────┼──────────────────────────────┘
    │ deliver PR                │
```

1. **Start:** Supervisor prepares `.worktrees/<taskId>`, snapshots it, opens a tab and prompts the Worker.
2. **Implementation:** Worker writes code, records its decision in `decisions/`, writes `report.md` and `commit.txt`, and runs `software-factory done`.
3. **Quality Gate:** Supervisor runs the gate commands.
4. **Self-Correction Loop:** On failure a fresh Worker receives the cleaned gate output and fixes forward, within the gate's retry budget.
5. **Auditing:** With the gate green, the Doctor inspects the diff against the plan and the report. A failing verdict returns the task to `build` with the Doctor's feedback.
6. **Delivery:** The supervisor commits, pushes, and opens or updates the PR.

---

## Decision Log Protocol

- The Worker authors a new entry in `decisions/` recording what was implemented and why.
- The Doctor verifies that exactly one decision entry was added or updated.

---

## Herdr Integration

```
workspace  <taskId>            cwd .worktrees/<taskId>
├─ tab plan#1          planner
├─ tab plan-review#1   plan-reviewer
├─ tab build#1         worker
├─ tab build#2         worker (gate retry)
└─ tab audit#1         doctor
```

Command steps run as supervisor child processes, not in a tab.

The adapter shells out to the `herdr` CLI behind a `HerdrPort`:

| Operation               | Herdr CLI Command                                                                                         |
| :---------------------- | :-------------------------------------------------------------------------------------------------------- |
| Workspace per task      | `herdr workspace create --cwd .worktrees/<taskId> --label <taskId>`                                       |
| Tab per attempt         | `herdr tab create --workspace <id> --label <stepId>#<n> --env FACTORY_TASK=... --env FACTORY_ATTEMPT=...` |
| Start agent             | `herdr agent start <name> --kind <kind> --pane <paneId> -- <runner args>`                                 |
| Prompt agent            | `herdr agent prompt <name> <text>`                                                                        |
| Wait for a state change | `herdr agent wait <name> --until idle --until done --until blocked --timeout <ms>`                        |
| Read terminal           | `herdr agent read <name> --lines 100`                                                                     |
| Cleanup                 | `herdr tab close <tabId>`, `herdr workspace close <workspaceId>`                                          |

### Runner Adapters

Herdr starts an agent by `--kind`; everything after `--` is the runner's own arguments. A runner adapter is a small TypeScript module that maps:

- the workflow's `runner` name to the Herdr kind (`antigravity` -> `agy`),
- `model` to that CLI's model flag,
- the non-interactive permission flags that CLI needs to work unattended in a worktree.

---

## Reuse from `packages/factory`

Carried over and adapted, not redesigned:

| Area                                 | Source in `packages/factory/src`                                                            |
| :----------------------------------- | :------------------------------------------------------------------------------------------ |
| Herdr adapter and port               | `adapters/herdr`, `application/ports/herdr.port.ts`                                         |
| Git and system adapters              | `adapters/git`, `adapters/system`                                                           |
| Runner adapters                      | `adapters/agents/{claude,codex,cursor,antigravity,opencode}.ts`                             |
| PR delivery                          | `application/procedures/pr/*` (publish, blocked PR, review update, validation, body format) |
| Todo listing, dependencies, branches | `application/procedures/todo/*`                                                             |
| Their tests                          | moved with the code                                                                         |

New in this package: `definitions/`, `engine/`, the event store schema, command gates, the completion and messaging CLI.

Dropped: the Boss agent and its prompts, the hardcoded worker/doctor pipeline.

---

## Not Planned / Deferred

- **Sub-agents (`spawn:`) and parallel steps:** Deferred. One agent per step, steps in sequence.
- **Parallel tasks:** Deferred. The MVP runs one task at a time; the store schema does not prevent adding it later.
- **LLM gate-error summarizer:** Deferred. Gate feedback is produced deterministically. Add a summarizer only if truncated logs prove insufficient.
- **Model escalation on retry:** Deferred. If needed later, `onFail` gains `agent: <poolKey>`; it never takes inline runner or model overrides.
- **LLM supervisor on the happy path:** Never. The engine is deterministic TypeScript.
- **Direct Herdr socket client:** Deferred. The CLI is the stable surface; revisit only if process spawning becomes a measured cost.
