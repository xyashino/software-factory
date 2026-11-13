# Feature: Definitions (Roles, Workflows, `software-factory check`)

Implemented design spec. Parses `roles/*.md` and `workflows/*.yml` into typed, validated objects. Everything else consumes these types and never re-parses files.

## Scope

- Role parser: markdown frontmatter + prompt body.
- Workflow parser: YAML.
- Cross-file validation.
- `software-factory check` command.
- The first roles and workflows.

## Files

```
roles/planner.md  plan-reviewer.md  worker.md  worker-review.md  doctor.md  doctor-review.md
workflows/feature.yml  review.yml
src/definitions/
  duration.ts        "20m" -> ms
  role.ts            role schema + parser
  workflow.ts        workflow schema + parser
  validate.ts        cross-file rules
  load.ts            loadDefinitions(root) -> Definitions | DefinitionErrors
  types.ts           Role, Workflow, Step, AgentDef, InputRef, OnFail
src/cli/commands/check.ts
```

## Types

```ts
interface Role {
  id: string;
  label: string;
  verdict: boolean;                       // judging role
  artifacts: Record<string, string>;      // key -> file name in the attempt dir
  template: string;                       // prompt body
  source: string;                         // absolute file path, for errors
}

interface AgentDef { role: string; runner: string; model: string; timeoutMs: number }

type InputRef =
  | { kind: 'artifact'; step: string; key: string }   // "plan.plan"
  | { kind: 'task'; key: 'reviewThreads' };           // "task.reviewThreads"

interface OnFail { retry: string; max: number }

interface AgentStep {
  id: string; type: 'agent'; agent: string;
  inputs: InputRef[]; onFail?: OnFail;
}

interface CommandsStep {
  id: string; type: 'commands';
  exec: string[]; timeoutMs: number; onFail?: OnFail;
}

type Step = AgentStep | CommandsStep;

interface Workflow {
  name: string;
  description: string;
  setup: { exec: string[]; timeoutMs: number };   // run once when the worktree is created
  agents: Record<string, AgentDef>;
  steps: Step[];
  deliver: { commit: InputRef; report: InputRef; to: 'new-pr' | 'open-pr' };
  source: string;
}

interface Definitions { roles: Map<string, Role>; workflows: Map<string, Workflow> }
```

`setup` is the one addition to the workflow YAML from PLAN: the worktree needs `pnpm install --frozen-lockfile` before any gate can run, and that command is repo-specific.

```yaml
setup:
  timeout: 10m
  exec: [pnpm install --frozen-lockfile]
```

## Role rules

- Frontmatter keys: `id`, `label`, `verdict` (default `false`), `artifacts`. Unknown keys are errors (`.strict()`).
- `id` equals the file name without `.md`.
- Artifact keys match `^[a-z][a-zA-Z0-9]*$` (they become `<key>Path` variables). File names are plain names, no `/`.
- A judging role must declare a `feedback` artifact.
- A non-judging role must declare at least one artifact.
- Variables allowed in the template: the standard set (`taskId`, `attemptId`, `artifactDir`, `evidenceDir`, `todoBody`, `context`), one `<key>Path` per artifact. Anything else is an error.

## Workflow rules

All of PLAN's load-time rules, plus:

- `name` equals the file name without `.yml`.
- `steps` is a non-empty list; ids match `^[a-z][a-z0-9-]*$` and are unique; `task` is reserved.
- Durations match `^\d+(s|m|h)$`; zero is an error.
- `max` is an integer from 1 to 5.
- Every pool agent is used by at least one step (unused agents are almost always a mistake).
- `runner` names one of the runner adapters. Validation only checks the name against a constant list; the adapters live in `src/adapters/runners/`.
- `deliver.commit` and `deliver.report` reference artifacts of agent steps, never `task.*`.

## Error format

Every problem is collected; loading never stops at the first one.

```
workflows/feature.yml  steps[3].onFail.retry  "quality-gate" is a commands step; retry must target an agent step
roles/doctor.md        template              unknown variable {{evidenceDr}}
```

`software-factory check` prints all errors and exits 1, or prints `ok: 5 roles, 2 workflows` and exits 0. YAML syntax errors include the line and column from the `yaml` parser.

## First roles

Port the prompt bodies from `packages/factory/src/templates/agents/*.md`, adapting:
- completion: "write the artifacts, then run `software-factory done`",
- judges: "run `software-factory verdict pass` or write `{{feedbackPath}}` and run `software-factory verdict fail`",
- no Boss references.

| Role | Artifacts | Verdict |
| :--- | :--- | :---: |
| `planner` | `plan: plan.md` | no |
| `plan-reviewer` | `feedback: feedback.md` | yes |
| `worker` | `report: report.md`, `commit: commit.txt` | no |
| `worker-review` | `report: report.md`, `commit: commit.txt` | no |
| `doctor` | `feedback: feedback.md` | yes |
| `doctor-review` | `feedback: feedback.md` | yes |

## Tests

- One valid fixture tree loads with no errors.
- One fixture per rule above, each producing exactly the expected error.
- The real `roles/` and `workflows/` pass `software-factory check` (keeps shipped definitions valid in CI).

## Out of scope

Rendering prompts (feature 09), runner adapters (feature 05).
