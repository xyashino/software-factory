---
scope: factory
summary: Repo lines, operators, templates move to .factory/
why: Server keeps tasks and state only; each repo owns its .factory/ definitions
date: 2026-11-15
tags: [definitions, factory-dir, layout]
---

- `lines/`, `operators/`, `templates/prompts/` and `templates/pr/` move from `packages/factory-definitions/` to `.factory/` at the repository root, next to `.nitpick/`.
  - `templates/runtime/` and `schemas/` stay in `packages/factory-definitions/`.
- `loadRepoDefinitions(repoRoot)` reads `<repo>/.factory/`; it validates declared rules and skills against `.nitpick/` when present.
- `readDefinitions` and `loadDefinitions` take the `.factory/` directory; runtime prompts still come from the package.
- `factory check` and the server's startup definitions point at this checkout's `.factory/`.
- Not yet done: the server still loads definitions at startup, and the task API (`createOrder`, `createPlan`, `recordPrState`) and Cell-side rendering are later slices of passive-server-03.
