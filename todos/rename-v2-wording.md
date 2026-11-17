---
status: todo
priority: low
depends_on: []
line: feature
type: docs
---

# Todo: Remove the "v2" wording from docs and comments

## 🎯 Objective

Describe the factory as the factory, not as "v2", in the docs and in the code comments that name a version.

---

## 🌐 Context & Problem Statement

Docs and comments say "v2" everywhere: "v2 design docs", "v2 packages", "schema v2", "v2-15" milestone ids, "v1 PR format" provenance. With v1 removed, these describe a split that no longer exists. This is the largest of the cleanup items, so it comes last and touches no behaviour.

---

## 📦 Specification / Scope

- **Target**: `docs/`, `README.md`, `.nitpick/skills/setup-factory/SKILL.md`, and comments in `packages/*/src` and `apps/*/src`. Leave `decisions/` alone, since those entries are history.
- **Classification**: `Documentation`
- **Dependencies**: `todos/remove-software-factory-v1-package.md` and `todos/remove-schema-version-from-lines.md` should land first, so the wording matches the code.

---

## 🛠️ Implementation Plan

1. Rewrite "v2" and "v1" references in `docs/` and `README.md` as plain descriptions of the factory.
2. Rewrite "(v1 ...)" provenance and "schema v2" in code comments, or delete the comment if it adds nothing.
3. Keep `/v1/...` HTTP route paths. They are the wire API version, not the product generation.
4. Keep event-envelope `schemaVersion` and the `decisions/` history.

---

## ✅ Acceptance Criteria

- [ ] No "v2" product wording remains in `docs/`, `README.md` or setup docs.
- [ ] No "(v1 ...)" provenance remains in code comments.
- [ ] `/v1/` route paths and event `schemaVersion` are unchanged.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
- [ ] Exactly one new `decisions/` entry for this change.
