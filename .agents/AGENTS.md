# Software Factory Agent Instructions

## English Language Feedback
- The user is working on improving their English.
- If the user makes a noticeable or major English mistake in their prompt, provide brief, friendly feedback at the very top of your response (1–2 bullet points or sentences).
- Keep the feedback concise and unobtrusive, then proceed with the normal task response.

## Software Factory Workflow
This repository follows an autonomous Software Factory workflow. The `todos/` backlog runs through `pnpm factory` ([factory](agents/factory.md)): execute and review per task, each role on its own agent CLI and model, one PR per task for dev acceptance. Interactive work goes to [worker](agents/worker.md), verified by [doctor](agents/doctor.md).
Proof of work is recorded under `.evidences/<task-id>/` using [evidence](skills/evidence/SKILL.md).
Every completed change requires exactly one ADR entry in `decisions/`.

## Rule files

| Tag | Meaning                                     |
| --- | ------------------------------------------- |
| `A` | always — apply every task                   |
| `O` | optional — use when helpful                 |
| `D` | when directly mentioned — only if user asks |
| `I` | infer during task — apply when context fits |

- [rules/git.md](rules/git.md)
- [rules/testing.md](rules/testing.md)
- [rules/general.md](rules/general.md)
- [rules/accessibility.md](rules/accessibility.md)
- [rules/architecture.md](rules/architecture.md)
- [rules/astro.md](rules/astro.md)
- [rules/coding.md](rules/coding.md)
- [rules/frontend.md](rules/frontend.md)
- [rules/react.md](rules/react.md)
- [rules/security.md](rules/security.md)
- [rules/styling.md](rules/styling.md)
- [rules/typescript.md](rules/typescript.md)
- [rules/ui.md](rules/ui.md)
- [rules/ux.md](rules/ux.md)

## Reference files

- [references/aodi-framework.md](references/aodi-framework.md)
- [references/frontend-architecture.md](references/frontend-architecture.md)
