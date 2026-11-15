---
scope: factory
summary: Repos own .factory/, the Cell renders prompts and PR bodies
why: The server keeps tasks and state; a repo's definitions render on the Cell from its worktree
date: 2026-11-15
tags: [definitions, factory-dir, task-api, cell-render]
---

- `lines/`, `operators/`, `templates/prompts/` and `templates/pr/` live in each repo's `.factory/` at the root, next to `.nitpick/`. `templates/runtime/` and `schemas/` stay in `packages/factory-definitions/`.
  - `loadRepoDefinitions(repoRoot)` reads `<repo>/.factory/` and validates declared rules and skills against `.nitpick/` when present.
- The server holds tasks and state only: the task API creates and records them with a pinned `LineSnapshot` in the request.
  - Routes: `POST /v1/orders`, `POST /v1/plans`, `POST /v1/orders/:id/pr-state`, `POST /v1/plans/:id/pr-state`. No `lines`, `operators` or template tables.
  - Idempotent by `commandId`. The recorded actor is `factory`, as intake and PR polling record theirs.
- `LineSnapshot` carries the Operator pools, the workspace setup and the deliver artifacts, so a job is built from the pin alone. A pin without them is refused, never guessed.
- Jobs carry structured inputs, not rendered text: `station.prompt` (task id, spec body, Cycle context, budget), deliver refs and verification, `mechanic.incident`.
  - `removeTodo` is gone: the Cell removes `todos/<taskId>.md` only when that file exists.
- The Cell renders the Operator prompt, the Mechanic prompt and the PR body from the worktree's `.factory/`; a repo that cannot render a job fails it with a diagnostic.
  - `apps/cell/src/jobs/render.ts` is the one Cell module allowed to import definitions and the prompt builders (the Cell's import rule is narrowed for it).
- Not yet: intake still reads `lines/` on the server to turn todo files into Work orders, and the Operator profile and templates are not pinned.
