---
status: queued
priority: medium
line: fast
type: docs
depends_on: docs-remove-dead-sections
---

# docs-dedupe-style-rules: stop restating nitpick rules in app docs

## 🎯 Objective

App RULES files keep only app-specific rules. Shared style rules link to `.nitpick`.

---

## 🌐 Context & Problem Statement

`BE_RULES.md` §3 and operator `IMPLEMENTATION_RULES.md` §3 repeat no-barrel, export order, strict types, minimal comments. `.nitpick/rules` is source of truth; copies drift. Arrow-functions-only is in both docs but not in the CLAUDE.md rule list.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/docs/BE_RULES.md` (operator rules file is deleted by `operator-retire-app-and-protocol`), `.nitpick/rules/` (only if adding a rule)
- **Classification**: `Universal Tooling`
- **Dependencies**: none
- Out: moving files; edits to generated `.agents/`, `AGENTS.md`, `CLAUDE.md`.

---

## 🛠️ Implementation Plan

1. Map each style item in both docs to a `.nitpick/rules/*` rule (`coding-no-barrel-export`, `coding-export-order`, `coding-minimal-comments`, `ts-strict`, `ts-exhaustive`, `ts-unknown-as`). Table in ADR.
2. Replace matching items with one link line to the rule.
3. Unmatched items (arrow-only, `function` ban, operator minimal CLI output): decide per item. Repo-wide: add `.nitpick` rule, run `pnpm nitpick:sync`, `pnpm nitpick:check`. App-only: keep in the doc.
4. Optional, decide and record: layering rule ("domain -> db -> contracts -> application -> adapters -> bootstrap") as `.nitpick` rule scoped to `apps/factory`.
5. Never hand-edit generated files.

---

## ✅ Acceptance Criteria

- [ ] No style rule text duplicated between app docs and `.nitpick`.
- [ ] Every removed item has a link or a new nitpick rule.
- [ ] `pnpm nitpick:check` passes if `.nitpick/` changed.
- [ ] One new ADR in `decisions/`.
- [ ] Passes verification gate (`pnpm ci:verify`).
