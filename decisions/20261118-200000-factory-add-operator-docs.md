---
scope: factory/operator
summary: Add operator CLI docs with role split, commands and rules boundary
why: The operator CLI had no written boundary; rules were leaking into the CLI and Mechanic actions were unclear.
date: 2026-11-18
tags: [factory, operator, docs, mechanic]
---

- New `apps/operator/docs/README.md` (index, glossary) and `apps/operator/docs/PLAN.md` (roles, commands, request flow, rules boundary).
- Operator commands: `done`, `verdict pass|fail`, `block`; `context` left open.
- Mechanic commands: `read`, `answer`, `incident`. `ask` and `tell` removed from the plan (`tell` open). `escalate` is `incident --action escalate`, which sets the Work order to `blocked`.
- `incident --action` uses the new core names: `retry_step`, `restart_from_step` (needs `--step`), `restart_from_scratch`, `escalate`, `cancel`.
- `answer` and `incident` require `--report` (what happened, what he tried, potential fix).
- `--change`, `resume`, `nudge`, `repair` removed.
- Rule: the CLI parses and reads files; the Cell checks local facts; the server enforces every Line rule.
- Code in `apps/operator-cli` is not changed. Its old shape is listed in PLAN §8 as the migration gap.
- Binary rename (`factory-operator` to `operator`) is out of scope.
