---
scope: factory
summary: Untrack and ignore local .claude and .cursor directories
why: they hold machine-local generated links and config, not repo source
date: 2026-11-21
tags: [git, cleanup]
---

- `.gitignore`: add `.claude/` and `.cursor/`.
- Untrack `.claude/skills`, `.claude/settings.json`, `.cursor/rules/agents.mdc`; files stay on disk.
