---
scope: factory/sf
summary: Align sf init starter lines and profiles with .factory
why: sf init lacked the feature line, mechanic block, planner and mechanic profiles that .factory ships; new repos could not plan or triage.
date: 2026-11-23
tags: [factory, sf, init, templates]
---

- `LINE_FAST`, `LINE_STANDARD`: add top-level `mechanic` block (`claude`, `sonnet`, `20m`, `permission: read`).
- New `LINE_FEATURE` (`apps/sf/src/domain/init/templates.ts`): stations `plan`, `build`, `quality-gate`, `audit`, `deliver`; operators `planner`, `builder`, `doctor`; same portable `claude`/`sonnet` defaults and lint/check-types/test gate.
- New `PLANNER_PROFILE` and `MECHANIC_PROFILE`: mirror `.factory/operators/`, placeholders `{{rules}}`, `{{skills}}`, `{{path}}`, `factory-operator done` / `factory-operator incident`.
- `BUILDER_PROFILE`: inline finish step replaced by `## Finish` running `factory-operator done`.
- `init.procedure.ts` writes `lines/feature.yml`, `operators/planner.md`, `operators/mechanic.md`.
- Tests: feature line stations, mechanic parsed on all three starter lines, init written list.
- Unchanged: `.factory/` in this repo, `runner`/`model` defaults, `DELIVER`, `DOCTOR_PROFILE`.
