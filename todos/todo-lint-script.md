---
status: queued
priority: low
line: standard
type: feat
---

# todo-lint-script: validate todos with the real parser

## Objective

Root script `pnpm todo:lint` rejects todo files the factory importer would reject.

## Context

`create-todo` skill validates by hand. Importer rules live in `apps/factory/src/domain/queue/todo-markdown.ts`: one `depends_on` parent, valid `type`/`status`/`priority`, `line` required, heading `# <slug>: <title>` matching file name. `apps/sf/src/domain/todo/parse-todo.ts` is a second, frontmatter-only parser (duplicate concern).

## Scope

- **Target**: `scripts/`, root `package.json`, `turbo.json`
- **Classification**: `Universal Tooling`
- **Dependencies**: none new
- **Out of scope**: changing importer rules, merging sf and factory parsers.

## Verify first

- How scripts in `scripts/` run (bun or node) and whether a root script may import `apps/factory/src/domain/queue/todo-markdown.ts` directly.
- Whether the parse function is exported (the draft shows `parseTodo` unexported).

## Implementation Plan

1. `scripts/lint-todos.ts`: for each `todos/*.md`, run factory's todo parse. Export it if needed, without changing behavior.
2. Extra checks: `.factory/lines/<line>.yml` exists; `depends_on` target exists in `todos/`; chain has no cycle; `plan` slug shape.
3. Print `file: message` per error, exit 1 on any.
4. Root script `todo:lint`; add `//#todo:lint` to turbo and `ci:verify`.
5. Update `.nitpick/skills/create-todo/SKILL.md` "Validate" section to call `pnpm todo:lint`, then `pnpm nitpick:sync`.

## Acceptance Criteria

- [ ] Fails on: two parents, bad type, missing line file, unknown parent, cycle, heading/file mismatch.
- [ ] Passes on all current valid `todos/`.
- [ ] Tests: black box on temp todo dirs, Arrange/Act/Assert.
- [ ] One new ADR in `decisions/`.
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `pnpm ci:verify` passes.
