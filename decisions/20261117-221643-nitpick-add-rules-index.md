---
scope: nitpick
summary: Root AGENTS.md and CLAUDE.md list each rule with its summary
why: Generated root docs were link lists only, so agents had to open every group file to learn the rules.
date: 2026-11-17
tags: [nitpick, docs, agents]
---

- `buildDocs` renders a `## Rules` index in the root doc: one bullet per rule with its importance, a link, and the first prose line of the rule.
- `summaryOf` skips fenced code, HTML comments, headings, tables, links and intro lines ending in `:`; list markers are stripped.
- Root docs now emit `AGENTS.md` and `CLAUDE.md` copies (`.nitpick/config.ts`); both are gitignored and generated.
- `.nitpick/entry.md` rewritten with repo layout, commands and the change workflow.
- `Output.toc.rules` (default on) hides the index when set to `false`.
- Tests cover the summary and the index; 351 pass.
