# Feature: Prompts and Templates

Implemented design spec. Turns roles, inputs and feedback into the text sent to an agent.

## Scope

- `renderTemplate`.
- Supervisor templates: reminders, nudges, feedback blocks, CLI guide.
- Building the prompt for an attempt.

PR bodies are templates in `templates/pr/`: `body.md` (delivered task), `blocked.md` (blocked task) and `report.md` (the worker report `<details>` block). They use the same `renderTemplate` and the same load-and-validate path as the prompts, against `PR_TEMPLATE_VARS` in `src/prompts/templates.ts`. Code computes the variables in `src/supervisor/format-pr-body.ts` and `src/supervisor/deliver.ts`; the markdown layout lives in the templates.

## Files

```
templates/prompts/
  cli-guide.md          appended to every attempt prompt
  context-input.md      one inlined input artifact
  context-input-path.md one input artifact too large to inline
  review-feedback.md    a judge's failing feedback, injected into the retried step
  gate-feedback.md      one GateFailure, injected into the retried step
  reminder-idle.md      agent went idle without `software-factory done`
  nudge-silent.md       no output for 5 minutes
  answer.md             an answer to the agent's question
src/prompts/
  render.ts             renderTemplate, ported from packages/factory/src/render-template.ts
  templates.ts          loads and validates templates/prompts/* and templates/pr/*
  build-prompt.ts       role + attempt -> prompt text
```

## `renderTemplate`

Port the existing function unchanged: `{{name}}` replaced by a string or number; a missing value throws. Templates are read from disk relative to the package (`new URL('../../templates/prompts/', import.meta.url)`).

## Template variables

Each supervisor template has a fixed set of variables declared in `templates.ts`:

```ts
const TEMPLATE_VARS = {
  'cli-guide':          ['commands'],
  'context-input':      ['ref', 'content'],
  'context-input-path': ['ref', 'path', 'size'],
  'review-feedback':    ['step', 'retry', 'max', 'feedback'],
  'gate-feedback':      ['command', 'exitCode', 'tail', 'logPath', 'retry', 'max'],
  'reminder-idle':      ['missing', 'count', 'limit'],
  'nudge-silent':       ['minutes'],
  'answer':             ['question', 'answer'],
} as const;
```

`software-factory check` loads every template and fails if a template uses a variable not in its list, or a listed template file is missing.

## Building an attempt prompt

```
role template rendered with:
  taskId, attemptId, artifactDir, evidenceDir, todoBody
  <key>Path for each role artifact
  context =
    for each input:     context-input (≤ 12,000 chars) or context-input-path
    if feedbackFrom:    review-feedback, or one gate-feedback per GateFailure
    if notes: each note addressed to this step
+ "\n\n" + cli-guide
```

The prompt is saved to `.evidences/<taskId>/<attemptId>/prompt.md` before it is sent, so every attempt's exact input is auditable.

`retry` and `max` in feedback templates are the failing step's `retriesUsed` and `onFail.max`, rendered as "Gate retry 1/3".

## Starting text

`gate-feedback.md`:

```markdown
## Quality gate failed: `{{command}}` (exit {{exitCode}}), gate retry {{retry}}/{{max}}

{{tail}}

Full log: {{logPath}}
```

`reminder-idle.md`:

```markdown
You stopped without finishing ({{count}}/{{limit}}). Missing:
{{missing}}
Write them, then run `software-factory done`.
```

## Tests

- Every shipped template renders with its declared variables.
- A template using an undeclared variable fails `software-factory check`.
- Input exactly 12,000 characters is inlined; 12,001 is not.
- `build-prompt` snapshot tests for: first plan attempt, plan retry after review, build retry after gate failure with two failures, audit with two inputs.
