---
status: queued
priority: medium
line: standard
type: docs
depends_on: docs-dedupe-style-rules
---

# docs-restructure-root: one topic-based `docs/`

## 🎯 Objective

Move app docs into root `docs/` by topic, one glossary, one index. Apps keep a short pointer README.

---

## 🌐 Context & Problem Statement

Docs scattered per app, names differ (`PLAN`, `README`, `*_RULES`), no single entry. Layout in `docs/docs-plan.md`. Confirm layout with user before starting (plan assumes root topic-based).

---

## 📦 Specification / Scope

- **Target**: `docs/`, `apps/*/docs`, `apps/*/README.md`, root `README.md`
- **Classification**: `Universal Tooling`
- **Dependencies**: none
- Out: new cell content (`docs-write-cell-doc`), link-check script.

---

## 🛠️ Implementation Plan

1. Create `docs/README.md` (index + glossary from `apps/sf/docs/OPERATOR.md`: Factory, Line, Station, Operator, Mechanic, Cell, Job, Incident), `docs/architecture.md` (app table from root README, who calls whom, one diagram).
2. `git mv` with history: factory `PLAN.md` to `docs/factory.md`; sf `PLAN.md` to `docs/sf.md`; `apps/sf/docs/OPERATOR.md` (moved there by `operator-retire-app-and-protocol`) to `docs/operator.md`; web-demo `PLAN.md` to `docs/web-demo.md`. Existing `docs/*-plan.md` to `docs/plans/`.
3. Merge remaining `BE_RULES.md` content (operator rules file is already gone) (layering, dependency direction, SQLite, testing) into `docs/engineering.md`, grouped by topic. Section "factory" / "operator" only where rules differ.
4. Delete emptied `apps/*/docs/`. Each app `README.md` (create if missing): 3 lines, links to its doc.
5. Update inbound references: root `README.md` design-docs links, operator/sf cross links, `decisions/` entries that link docs (leave ADR text, fix only live links), todos referencing docs.
6. Compress prose to caveman style per `general-caveman-markdown`.

---

## ✅ Acceptance Criteria

- [ ] `apps/*/docs/` gone; `docs/` matches layout.
- [ ] Single glossary, defined once.
- [ ] No relative link to a moved or removed path anywhere in repo (grep old paths).
- [ ] Moves done with `git mv` (history kept).
- [ ] One new ADR in `decisions/`.
- [ ] Passes verification gate (`pnpm ci:verify`).
