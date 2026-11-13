---
scope: factory
summary: Factory rules and skills point at .nitpick
why: Prompts and sf check read .nitpick, the authored source; .agents is only a generated sync copy
date: 2026-11-13
tags: [factory, nitpick]
---

- Prompt `## Rules` and `## Skills` blocks list `.nitpick/config.ts` and `.nitpick/skills/<id>/SKILL.md`
- `sf check` validates rule ids against the `.nitpick/config.ts` rules tree and skills against `.nitpick/skills/`
- Shipped roles and `docs/DEFINITIONS.md` name `.nitpick/` as the source of truth
- No `.agents` path remains in `packages/software-factory` except a negative test assertion
