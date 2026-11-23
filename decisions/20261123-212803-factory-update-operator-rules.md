---
scope: factory
summary: Align operator rule lists and drop broken line schema comments
why: Builder and doctor declared mixed rule ids, so builder skipped groups and doctor audited less than builder follows
date: 2026-11-23
tags: [factory, operators, lines, rules]
---

- `builder.md`, `doctor.md`: `rules:` lists the six always-apply `CLAUDE.md` groups `[coding, general, git, security, testing, typescript]`.
- `fast.yml`, `feature.yml`: removed `# yaml-language-server: $schema=../schemas/line.schema.json`; `.factory/schemas/` does not exist.
- `standard.yml`: no change, had no schema header.
