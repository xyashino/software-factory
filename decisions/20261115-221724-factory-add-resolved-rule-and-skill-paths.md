---
scope: factory
summary: Resolve rule and skill paths into the operator prompt
why: Operators need the repo-relative file of each declared rule and skill, not bare ids
date: 2026-11-15
tags: [prompts, nitpick, operator, rules, skills]
---

- `nitpickCatalog` resolves `rulePaths` and `skillPaths` from `.nitpick/config.ts`, using the first `output` path (default `.agents`).
  - A standalone rule (object `doc`) maps to `<output>/rules/<id>.md`; a group key or inline rule maps to `<output>/rules/<group>.md`.
  - A skill listed in `config.skills` maps to `<output>/skills/<id>/SKILL.md`; other skills map to `.nitpick/skills/<id>/SKILL.md`. Only paths that exist on disk are kept.
  - An output path that is absolute or escapes the repo publishes no paths.
- `Definitions` carries both maps, empty without `.nitpick/`.
- `buildPrompt` renders each declared unit as `id: path`, or the bare `id` when no path resolves. Prompts still hold no absolute host path.
- `renderOperatorPrompt` passes the resolved paths of the profile's rules and skills.
