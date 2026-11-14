---
scope: factory/cell
summary: Fill reminders, name factory-operator done, workspace per task
why: Operators got raw placeholders and the v1 command sf done, and every task's tabs shared one workspace
date: 2026-11-14
tags: [v2, cell, prompts, herdr]
---

- Idle and silent reminders are filled before they are typed: count, limit, minutes (CORE §9.1, RUNTIME_PROMPT_VARS).
- v2 operator profiles and runtime templates finish with `factory-operator done`, as the runtime's CLI guide names it.
- The pane driver opens one Herdr workspace per task (v1 layout) and an Operator tab in it.
