---
scope: docs
summary: Remove duplicated nitpick style rules from factory BE_RULES
why: Style copies in app docs drift from .nitpick, the source of truth; link instead
date: 2026-11-21
tags: [docs, factory]
---

- Factory `BE_RULES.md` §3 keeps no restated nitpick rules; one link line to `.nitpick/rules/`.
- Removed as duplicate: no barrel, export order, strict TS (`any`, `as unknown as`, exhaustive switch), minimal comments.
- Mapping: `coding-no-barrel-export`, `coding-export-order`, `coding-minimal-comments`, `ts-strict`, `ts-exhaustive`, `ts-unknown-as`.
- Kept app-only: arrow functions only (no `.nitpick` rule; not in CLAUDE.md list).
- Kept app-only: barrel exception for package root `src/index.ts`.
- Not added: arrow-functions `.nitpick` rule, avoids generated-file sync for one doc.
- Not added: layering rule as `.nitpick` rule (optional §4 of task), layering stays in BE_RULES §2.
- Operator `IMPLEMENTATION_RULES.md` already deleted; nothing to change there.
- No generated file (`.agents/`, `AGENTS.md`, `CLAUDE.md`) touched. `pnpm ci:verify` exit 0.
