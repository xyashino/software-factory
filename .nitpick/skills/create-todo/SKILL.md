---
name: create-todo
description: "Generates todos/<slug>.md work orders that the factory queue importer accepts: correct frontmatter, one parent, verified facts, self-contained agent prompt. ONLY activate when explicitly requested by the user (e.g., 'use create-todo skill', 'run create-todo', 'create a todo spec file for...'). Never activate automatically."
---

# Create Todo

## Activation

Explicit only. Run when the user asks for `todos/<slug>.md` specs or names this skill. Never during normal implementation, planning chat or code questions.

## What a todo is

One work order. The factory imports `todos/<slug>.md` (`sf todos import`, `POST /api/v1/queue/import`). Everything after the heading becomes the description sent to an LLM builder on a Line. So: the file must stand alone. No "as discussed", no reference to the chat.

## Format (matches `apps/factory/src/domain/queue/todo-markdown.ts`)

Frontmatter, then heading `# <slug>: <title>`, then body.

| Key | Rule |
| --- | --- |
| `status` | `queued` (default), `paused`, `cancelled`. `todo` = alias of `queued`. |
| `priority` | `high`, `medium` (default), `low`. |
| `line` | Required. Lowercase slug of a file in `.factory/lines/`. |
| `type` | `feat`, `fix`, `refactor`, `chore`, `docs`, `test`. Default `feat`: set it explicitly. |
| `plan` | Optional lowercase slug. Root todo of a stack. Branch `feat/<plan>`. |
| `depends_on` | Optional. AT MOST ONE slug (string or one-item list). Must be another todo. No cycles. |

- File name `<slug>.md`, slug matches `^[a-z0-9][a-z0-9-]*$`. Heading slug must equal file slug.
- Unknown keys are ignored. Do not add `model` or `runner`: pick the `line`.

## Pick the line

| Line | Use for |
| --- | --- |
| `fast` | chores, docs, style. Builder + quality gate, direct delivery. |
| `standard` | clear scope. Builder + quality gate + doctor audit. No planning. |
| `feature` | unclear design. Plan, plan review, build, quality gate, audit. |

Read `.factory/lines/*.yml` descriptions again if lines changed. Named model or runner not in a line file: say so, never invent.

## Split and chain

- One todo = one reviewable change, one ADR. Split package creation from app adoption. Split when a change rewrites about 30+ files or mixes behavior change with mechanical moves.
- Dependencies form a forest: each todo has one parent. Fan-out is fine. Fan-in is not: linearize (`a` then `b` then `c`) or merge.
- Epic of several todos: optional `docs/<name>-plan.md` with verified facts, decisions, order table, risks. Todos link to it.

## Discovery

- Read what is needed to state facts. Targeted `grep`, `diff`, `ls`, `package.json`, the files being moved. No whole-repo scans, no unrelated packages.
- Verified fact goes in as fact, with paths. Unverified claim goes under "Verify first". Never guess.
- Versions: root `package.json` `workspaces.catalog`. Workspace deps `workspace:*` (declare every consumer).
- Read ADRs in `decisions/` only if the change alters a recorded decision.

## Template

Copy `references/todo.md`. Sections: Objective, Context, Scope (target, classification, dependencies, out of scope), Verify first, Open decisions, Implementation Plan, Acceptance Criteria. Drop Verify first / Open decisions when empty.

## Acceptance defaults

Every todo ends with:

- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
- [ ] `bun run nitpick:check` passes when `.nitpick/` changed.

## Style

Markdown follows `general-caveman-markdown` and `general-prefer-ascii`: short, plain ASCII, no emoji, no filler.

## Validate before finishing

Run `bun run todo:lint`. It parses every `todos/*.md` with the factory importer parser and also checks the line file exists, `depends_on` names a todo in `todos/`, and the chain has no cycle. Fix every reported `file: message` line, then run it again.

- [ ] `bun run todo:lint` passes.
- [ ] Every path and number in the body was verified, or sits under "Verify first". The script cannot check this.

## Guardrails

- Do not implement. The todo defines the plan and contracts, not code dumps.
- Do not run tests or builds while drafting.
- Edit this skill only in `.nitpick/skills/create-todo/`, then `bun run nitpick:sync`. `.claude/` and `.agents/` are generated.
