---
scope: factory
summary: Strip hidden control and bidi characters from untrusted text
why: Bidi or control characters in todos and incidents can hide prompt-injection text from reviewers
date: 2026-11-24
tags: [security, prompt]
---

- Added `sanitizeUntrustedText` in `@repo/prompt/sanitize`: strips `\p{Cc}` and `\p{Cf}` except tab, LF and CR.
- Normal ASCII, Polish text, markdown and newlines pass through unchanged.
- `renderPrompt` strips control and format characters from every string input before filling the template.
- HQ todo parsing strips them from the heading title and body description.
- SF operator prompt strips them from the rendered context (incident JSON and handover text).
- `apps/hq` and `apps/sf` now depend on `@repo/prompt` (workspace link, `bun.lock` updated).
- Tests: bidi override, null and zero-width cases, preserved text, and one per boundary (prompt, hq todo, sf operator prompt).
