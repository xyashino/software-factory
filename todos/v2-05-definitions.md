---
status: todo
priority: high
depends_on: [v2-02-core-events-state]
workflow: feature
---

# v2-05: Definitions — Operator profiles, Lines v2, templates, todo parsing

## Objective

Build `factory-definitions`: the v1 roles, workflows and templates copied in and moved to the Line
schema v2, with a loader/validator, a stable snapshot + hash, runtime prompt templates and todo
frontmatter parsing.

## Read first

- `docs/STRUCTURE.md` §1–2 and §6 (carry-over rows for definitions, roles, workflows, templates,
  `pick-todo.ts`), `docs/CORE.md` §2, §4.4, §8 (dependency policy), `docs/RULES.md` §5
- `docs/PROTOCOL.md` §4 (`Job.workspace`, `runtimePrompts`)
- `decisions/20261113-083516-software-factory-clarify-missing-dependency-rule.md`
- v1: `packages/software-factory/src/definitions/*`, `roles/`, `workflows/`, `templates/`,
  `schemas/`, `src/supervisor/pick-todo.ts`

## Scope (ROADMAP items)

`factory-m2-definitions-port`, `factory-m2-line-v2`, `factory-m2-todo-parse`.

## Deliverables

1. `operators/` from v1 `roles/` (`worker.md` → `builder.md`; `operator.md` stays behind until M10),
   `lines/` from v1 `workflows/`, `templates/` from v1 `templates/`.
2. Line schema v2 (`schemas/line.schema.json` + zod):
   - `sync` / `setup` are per-job workspace preparation, not a phase;
   - Stations: `operator` or `inspection`, `requires` capability tags, `onFail { retry, max }`,
     `maxRestarts` (default 1), `maxLostRestarts` (default 3);
   - no top-level `operator:` block (that was v1's on-call role).
3. Runtime prompt templates: `answer`, `nudge`, `idleReminder`, `silentReminder`, `handoverRequest`.
4. `src/`: load + validate with file and field in every error; normalise into a `LineSnapshot`
   (`snapshotVersion`); `hashLine` (sha256 of canonical JSON).
5. Todo parsing: frontmatter (`status`, `priority`, `depends_on`, `workflow`/`line`, `factory`),
   `OrderId = <projectId>:<todoId>`, diagnostics (unparseable, unknown Line, reused id), the
   missing-dependency rule.
6. A `check()` function returning all definition errors (the future `factory check`).

## Out of scope

Prompt rendering (v2-09), intake I/O (v2-10).

## Acceptance criteria

- `check()` passes on the shipped definitions and reports file + field on fixtures of each error.
- Snapshot hash fixture test: same bytes on any machine (no paths, sorted keys).
- Todo parsing tests ported from v1 `pick-todo` tests, plus the new diagnostics.
- `pnpm turbo check-types lint test` green.
