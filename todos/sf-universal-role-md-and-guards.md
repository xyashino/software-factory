---
status: queued
priority: high
line: feature
type: feat
plan: universal-engine
depends_on: sf-repo-agnostic-lines-and-init-detect
---

# sf-universal-role-md-and-guards: add repo-agnostic ROLE.md built-ins and live operator guards

## Objective

Ship universal, repo-agnostic `ROLE.md` profiles (`planner`, `builder`, `doctor`, `mechanic`) inside `apps/sf`, enforce `ROLE.md` frontmatter contracts (`mode`, `outputs`, `guards`) live inside `sf operator done`, move runner quirks into runner adapters, and inject optional repo `lessons.md`.

## Context

Verified current behavior:

- `apps/sf/src/domain/line/operator-prompt.ts` parses minimal frontmatter (`rules`, `skills`, `artifacts`) and renders `{{placeholders}}`, with `CLAUDE.md` and `.agents/skills/` hardcoded in `renderOperatorPrompt`.
- `.factory/operators/builder.md` mixes repo specifics (`bun run nitpick:check`, `decisions/`) and Claude-specific quirks (heredoc approval block) inside the role prompt.
- `apps/sf/src/application/procedures/operator/done.procedure.ts` sends `{ verb: 'done' }` to Cell loopback; Cell validates `requiredFiles` existence only (`run-job.procedure.ts`).

## Scope

- **Target**: `apps/sf`
- **Classification**: `Domain Core`, `Feature`
- **Dependencies**: none
- **Out of scope**: Automatic Kaizen lesson generation from historical incidents (manual `.factory/lessons/<role>.md` injection only in this todo), MCP server generation per runner.

## Implementation Plan

1. **`ROLE.md` Schema & Built-in Roles (`apps/sf/src/domain/line/operator-prompt.ts`, `builtin-roles.ts`)**:
   - Extend frontmatter schema:
     - `mode: 'read' | 'write'`
     - `outputs`: map of artifact key -> `{ file: string; requiredHeadings?: string[]; format?: 'conventional' }`
     - `guards`: `{ requireDiff?: boolean; forbidPaths?: string[]; requireCleanWorktree?: boolean }`
   - Embed 100% repo-agnostic built-in `ROLE.md` for `planner`, `builder`, `doctor`, `mechanic` referencing `{{checks}}`, `{{rules}}`, `{{conventions}}`, `{{lessons}}`, `{{operatorCommand}}`.
   - Resolution order: repo `.factory/roles/<id>/ROLE.md` (or legacy `.factory/operators/<id>.md`) -> user `$XDG_CONFIG_HOME/sf/roles/<id>/ROLE.md` -> built-in engine `ROLE.md`.
   - Append optional repo `.factory/roles/<id>/append.md` and `.factory/lessons/<id>.md` (capped to safe char limit) when present.
2. **Live Guard Enforcement on `sf operator done` (`apps/sf/src/application/procedures/cell/`)**:
   - Validate `outputs` (file exists, `requiredHeadings` present, `conventional` commit title check when configured).
   - Validate `guards` (`requireDiff` checks non-empty git diff against base, `forbidPaths` rejects touched paths matching globs, `mode: 'read'` / `requireCleanWorktree` verifies clean `git status --porcelain`).
   - On violation, return non-zero `precondition` reply with exact actionable error list so the live agent fixes issues in the same session.
3. **Runner-Specific Quirk Injection (`apps/sf/src/adapters/runners/`)**:
   - Add optional runner prompt appendix / read-only permission flags inside runner adapters (e.g. Claude heredoc guidance in `claude.ts`) instead of role prompts.
4. **Tests**:
   - Unit tests for `ROLE.md` frontmatter parsing, resolution precedence, `append.md` / `lessons.md` composition, and guard validators.
   - Black-box tests verifying `sf operator done` rejects missing report headings, empty diff on `builder`, forbidden path edits, and dirty worktree on read-only `doctor`, then accepts once fixed.

## Acceptance Criteria

- [ ] Built-in repo-agnostic `ROLE.md` profiles (`planner`, `builder`, `doctor`, `mechanic`) work with zero `.factory/operators/` files in target repo.
- [ ] `sf operator done` enforces `outputs` and `guards` live and returns actionable error details while agent session remains active.
- [ ] Optional `.factory/roles/<id>/append.md` and `.factory/lessons/<id>.md` inject cleanly; runner quirks live in runner adapters.
- [ ] Existing `.factory/operators/*.md` files remain backwards compatible.
- [ ] Tests follow `testing` rules: black box, Arrange/Act/Assert, story-style names, public behavior only.
- [ ] One new ADR in `decisions/` (`decision-log` rule).
- [ ] Strict TypeScript, no `any`, no loose assertions.
- [ ] `bun run ci:verify` passes. Package-scoped `bun --filter <pkg> test|lint|check-types` allowed while working.
