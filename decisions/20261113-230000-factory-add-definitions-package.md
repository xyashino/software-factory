---
scope: factory/definitions
summary: Add factory-definitions with Line v2, operators and todo parsing
why: Definitions are data; a pure loader and a hashed snapshot let core and runtime pin one Line
date: 2026-11-13
tags: [v2, definitions, factory]
---

- v1 `roles/` copied to `operators/`, `worker.md` renamed to `builder.md`; `operator.md` stays behind until M10
- v1 `workflows/` copied to `lines/` as schema v2: `workspace` (sync, setup) replaces the phase; `agents` becomes `operators`; `steps` become `stations`
- Station `agent` maps to `kind: operator`, `commands` to `kind: inspection`; a top-level `operator:` block is rejected with a clear message
- Stations default to `requires: []`, `maxRestarts` 1 and `maxLostRestarts` 3; `onFail.max` stays 1..5
- Runtime prompts (answer, nudge, idle and silent reminders, handover request) live in `templates/runtime/`, text seeded from v1
- Operator config (runner, model, timeout, headless, permission) and workspace stay in the Line; core Station has no such fields, so the pinned snapshot does not carry them yet
- Station `runner` tag is its operator's runner; `verdict` and `artifacts` come from the operator profile, artifact keys sorted
- Line hash is sha256 of canonical JSON (sorted keys, no whitespace), the `hash` field excluded; golden hashes pinned in tests
- v1 `task.*` inputs and runner capability checks (headless, read-only) dropped: they need adapters, which are Worker code
- Todo `factory` is the optional literal `v2` (ROADMAP M9); intake filtering stays in v2-10
- Todo diagnostics: unparseable, unknown_line, reused_id, line_conflict; an unparseable dependency never counts as satisfied
- `check()` returns every definition and todo error with file and field; `schemas/line.schema.json` mirrors zod, key sets compared in a test
