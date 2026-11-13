# Definitions: Roles, Workflows, Templates

How the declarative files are stored and written. Where they live is in [STRUCTURE.md](STRUCTURE.md); how they are parsed and validated is in [feature-plans/01-definitions.md](feature-plans/01-definitions.md).

All three kinds share these rules:
- One definition per file. The file name is its id.
- Ids are `kebab-case`: `^[a-z][a-z0-9-]*$`.
- UTF-8, LF line endings, a trailing newline.
- Unknown keys are errors. A typo never silently does nothing.
- Every change passes `software-factory check` in CI before merge.
- A definition is never edited while a task that uses it is running. The supervisor loads definitions once at start; restart it to pick up changes.

---

## 1. Roles: `roles/<id>.md`

A role is **who** works at a station and **what files** they hand over. It never says which runner or model, never names other steps, and never decides what happens next.

### File layout

```markdown
---
<frontmatter: YAML>
---

<prompt body: markdown with {{variables}}>
```

### Frontmatter

| Key | Type | Required | Meaning |
| :--- | :--- | :---: | :--- |
| `id` | string | yes | Equals the file name without `.md`. |
| `label` | string | yes | Human name, shown on the board. |
| `verdict` | boolean | no, default `false` | `true` makes it a judging role: it finishes with `software-factory verdict`. |
| `rules` | list of ids | no, default `[]` | Repo rules the role enforces. Id = a rule or group key in the `rules` tree of `.nitpick/config.ts`. |
| `skills` | list of ids | no, default `[]` | Repo skills the role relies on. Id = directory with `.nitpick/skills/<id>/SKILL.md`. |
| `artifacts` | map key → file name | yes | Files the agent must write into its attempt directory. |

Artifact keys are `camelCase` (`^[a-z][a-zA-Z0-9]*$`) because each becomes a `{{<key>Path}}` variable. File names are plain names with an extension, no directories.

Rule and skill ids are kebab-case (`^[a-z][a-z0-9-]*$`) and must not repeat. Example:

```yaml
rules: [rich-commit, decision-log, testing]
skills: [evidence]
```

`.nitpick/` is the source of truth; `.agents/` is only the copy `pnpm nitpick:sync` generates for agent CLIs, so nothing here points at it. `sf check` verifies each rule id against the `rules` tree of `.nitpick/config.ts` and each skill id against `.nitpick/skills/`. An unknown id or a missing `SKILL.md` is an error. The attempt prompt gets a `## Rules` and a `## Skills` block listing the paths (`- rich-commit: .nitpick/config.ts`, `- evidence: .nitpick/skills/evidence/SKILL.md`), placed after the role body and before the CLI guide. A role with neither list gets no block. These are not template variables.

Judging roles must declare `feedback: feedback.md`. Non-judging roles declare at least one artifact.

### Prompt body

Structure every role body in this order, using `##` headings:

1. **Identity**, one line: "You are the Worker for task {{taskId}}, attempt {{attemptId}}."
2. **Task**: `{{todoBody}}`.
3. **Context**: `{{context}}`. Always present; it is empty on a first attempt.
4. **Instructions**: numbered steps specific to the role.
5. **Deliverables**: each artifact by its path variable, with what it must contain.
6. **Finish**: exactly how to end. Non-judging: "write the files above, then run `software-factory done`". Judging: "run `software-factory verdict pass`, or write `{{feedbackPath}}` and run `software-factory verdict fail`".

Do not write the CLI guide in the body; the supervisor appends it.

### Variables available in a role

| Variable | Value |
| :--- | :--- |
| `taskId`, `attemptId` | Ids of the current task and attempt. |
| `todoBody` | The todo file body, without frontmatter. |
| `context` | Inputs and feedback, rendered from templates. |
| `artifactDir` | Absolute path of the attempt directory. |
| `evidenceDir` | Absolute path of `.evidences/<taskId>/`. |
| `<key>Path` | Absolute path of each declared artifact. |

### Rules for role content

- Judging roles **review, they do not repair**. A judge that edits code would change the tree after the quality gate passed. If something needs fixing, the judge fails with feedback and the worker fixes it.
- A role refers to repo rules by id and source (`.nitpick/config.ts`) instead of copying them.
- Repo-specific commands (`pnpm nitpick:check`) are allowed in role bodies; runner-specific instructions are not.
- Keep bodies short. The prompt is sent on every attempt, retries included.

### Example

```markdown
---
id: doctor
label: Doctor
verdict: true
artifacts:
  feedback: feedback.md
---

## Role
You are the Doctor auditing task {{taskId}}, attempt {{attemptId}}. You review; you do not edit code.

## Task
{{todoBody}}

## Context
{{context}}

## Instructions
1. Read `git diff origin/main...HEAD` in the worktree.
2. Check the change against the plan and the worker's report in the context.
3. Check the rules in the `.nitpick/config.ts` rules tree that apply to the changed files. Do not re-run the gate; its result is in the context.
4. Decision log: Exactly one new entry in decisions/ matching the `decision-log` rule in `.nitpick/config.ts`.

## Finish
- Everything holds: run `software-factory verdict pass`.
- Otherwise write each problem with file and line to {{feedbackPath}}, then run `software-factory verdict fail`.
```

---

## 2. Workflows: `workflows/<name>.yml`

A workflow is **which agents** run, **in what order**, with **which gates and retry limits**. It contains no prompt text.

### Top-level keys, in this order

| Key | Required | Meaning |
| :--- | :---: | :--- |
| `name` | yes | Equals the file name without `.yml`. |
| `description` | yes | One line, shown by `software-factory check` and the board. |
| `sync` | no | `{ timeout, exec: [...] }` run in the repo root before the worktree exists; the shipped workflows hard-reset it to `origin/main`, discarding local changes. A failure fails setup and no worktree is created. |
| `setup` | yes | `{ timeout, exec: [...] }` run once inside the new worktree after it is created. |
| `agents` | yes | Pool: `<key>: { role, runner, model, timeout, headless?, permission? }`; see [Agent keys](#agent-keys). |
| `operator` | no | `{ role: operator, runner, model, timeout }`. The on-call agent of [feature 11](feature-plans/11-operator.md); the role must exist and must not be judging. All three shipped workflows declare it. `operator` is a reserved step id. |
| `steps` | yes | Ordered list; see below. |
| `deliver` | yes | `{ commit: <ref>, report: <ref>, to: new-pr }`. |

### Agent keys

| Key | Default | Meaning |
| :--- | :---: | :--- |
| `headless` | `false` | `true` runs the agent through the runner's print mode (`claude -p`, `codex exec`, ...) in the task worktree, with no Herdr pane. |
| `permission` | `write` | `read` makes the runner itself refuse file changes, in a pane and headless. |

`headless` is opt-in per agent. A headless run is not observed: there are no reminders, no stall detection and no prompt-block handling, which pane mode uses to recover runs. Only the `timeout:` (killed by the supervisor) and a restart check (the run is failed as `crashed`) guard it. Use it for short, judgement-only agents.

A headless attempt still ends with `sf done` or `sf verdict`. The supervisor reads the runner's JSON output only to record token usage and cost (`usage_recorded`, shown by `sf status` and `sf log`), never the verdict. Its output is written to `headless-stdout.log` and `headless-stderr.log` in the attempt's evidence directory.

A headless attempt has no pane, so `sf ask` cannot deliver its answer there; do not rely on `ask` in a headless agent.

A read-only agent cannot write files, so a judge hands its feedback to `sf verdict fail --feedback -` (stdin), which writes the feedback file.

`software-factory check` fails closed: `headless: true` needs a runner with a print mode, `permission: read` needs a runner with a read-only mode. `operator` must be a pane agent with `write`.

Runner matrix (verified on claude 2.1.322, codex-cli 0.167.1, cursor-agent 2026.11.11, agy 1.5.5):

| Runner | Pane | Headless | Read-only flags | Usage parsed |
| :--- | :---: | :---: | :--- | :---: |
| `claude` | yes | `claude -p --output-format json` | `--permission-mode default --permission-prompts none --allowedTools Read,Grep,Glob,Bash(sf verdict:*),Bash(sf ask:*),Bash(sf tell:*),...` (plan mode blocks `sf verdict`, so it is not used) | yes (tokens, cost) |
| `codex` | yes | `codex exec --json` | `--sandbox read-only --ask-for-approval never` (the approval flag goes before `exec`) | yes (tokens) |
| `cursor` | yes | `cursor-agent -p --output-format json` | `--mode plan` | yes (tokens) |
| `antigravity` | yes | `agy -p --output-format json` | `--mode plan` | yes (tokens) |
| `opencode` | yes | no | none | no |

Write mode keeps the unattended flags of each runner (`--permission-mode auto`, `--dangerously-bypass-approvals-and-sandbox`, `--force`, `--mode auto`).

### Steps

Agent step:

```yaml
- id: audit                          # kebab-case, unique, not "task"
  type: agent
  agent: doctor                      # key in agents:
  inputs: [plan.plan, build.report, quality-gate.gate]  # <stepId>.<artifactKey>, <stepId>.gate or task.<source>
  onFail: { retry: build, max: 2 }   # judging roles only
```

Commands step:

```yaml
- id: quality-gate
  type: commands
  timeout: 15m                       # required
  exec:                              # one command per entry, run in the worktree
    - pnpm check-types
    - pnpm lint
    - pnpm test
  onFail: { retry: build, max: 3 }
```

### Gate input

`<stepId>.gate` names a `commands` step. It is not an artifact: it puts that gate's pass result (step, attempt, commands that exited 0) into the prompt. Give it to every judging step that follows a gate. The `doctor` judges scope, rules, decision log and proof; the `quality-gate` executes `check-types`, `lint` and `test`. A doctor never re-runs gate commands; its only command is `pnpm nitpick:check`.

### Conventions

- Pool keys are named after the station, usually the role id. Use a different key only when one workflow uses the same role twice with different runners or models (`worker-fast`, `worker-strong`).
- Use flow style (`{ role: ..., runner: ... }`) for pool entries and `onFail`; block style for steps.
- Durations: `30s`, `20m`, `1h`. Never bare numbers.
- `max` is 1–5. Higher limits mean the task is wrong, not unlucky.
- Gate commands must be repo scripts (`pnpm lint`), not inline shell pipelines, so they can be run by hand the same way.
- A new workflow starts as a copy of the closest shipped one (`feature.yml`, `standard.yml` or `fast.yml`). Remove steps rather than inventing new step types.

### How a todo picks a workflow

The todo's frontmatter `workflow: <name>`; default `feature`.

| Workflow   | Steps                                                       | Choose when                                         |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `feature`  | plan, plan-review, build, quality-gate, audit               | New features and behavior changes needing a plan    |
| `standard` | build, quality-gate, audit (no planning)                    | Routine features and refactors with a clear todo    |
| `fast`     | build, quality-gate (no planning, no audit)                 | Chores, docs, style fixes                           |

---

## 3. Supervisor templates: `templates/prompts/<id>.md` and `templates/pr/<id>.md`

Text the supervisor sends on its own: reminders, nudges, feedback blocks, the CLI guide, answers. PR bodies (`templates/pr/`) use the same format; their allowed variables are `PR_TEMPLATE_VARS`.

### File layout

Plain markdown with `{{variables}}`. **No frontmatter.** The allowed variables per template are declared in code (`TEMPLATE_VARS` in `src/prompts/templates.ts`), because the supervisor is what fills them; a template cannot add new ones.

### Adding or changing one

- Changing wording: edit the `.md` file only.
- Using another variable that is already in its `TEMPLATE_VARS` entry: edit the `.md` file only.
- A new variable or a new template: code change in `templates.ts` and in the code that renders it. This is the one place where text and code change together.

### Writing rules

- Address the agent directly and say what to do next in the last line.
- Name commands exactly as the agent must type them, in backticks.
- No runner-specific wording.
- Keep them short. Feedback templates are repeated once per failure.

---

## 4. What does not go in these folders

| Content | Where it goes instead |
| :--- | :--- |
| Runner flags, Herdr kinds | `src/adapters/runners/<runner>.ts` |
| PR title and body format | `src/adapters/github/format-pr-body.ts` |
| Repo coding rules | `.nitpick/config.ts` `rules` tree, referenced by id from roles |
| Task descriptions | `todos/<taskId>.md` |
| Timeouts for reminders and stalls | `WatchPolicy` constant in `src/engine/watch.ts` |
