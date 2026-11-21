---
status: queued
priority: medium
line: fast
type: docs
depends_on: docs-fix-stale-facts
---

# docs-remove-dead-sections: delete stale and duplicated doc sections

## 🎯 Objective

Remove content that is dead, stale or a copy of code. Keep design only.

---

## 🌐 Context & Problem Statement

19 dead links to finished todos. Factory PLAN is 911 lines; DB schema §7 duplicates drizzle schema, endpoint index §9 duplicates contracts, roadmap §10 stale. Copies drift and cost tokens.

---

## 📦 Specification / Scope

- **Target**: `apps/factory/docs`, `apps/web-demo/docs`, `apps/sf/docs`
- **Classification**: `Universal Tooling`
- **Dependencies**: none
- Out: moving files, style-rule sections (separate todo).

---

## 🛠️ Implementation Plan

1. **Dead links**: remove task tables and `todos/...` links: factory `README.md` (table + mermaid), factory `PLAN.md` §10 and `todo/` links, web-demo `PLAN.md` §6, operator README todo row. Factory `README.md` may reduce to a pointer.
2. **Schema dump**: replace factory PLAN §7 with 1 short paragraph pointing to `apps/factory/src/db/schema`. Keep the design rationale of the SQLite exclusivity indexes (1 Cell per WorkOrder) as a few lines.
3. **Endpoint index**: replace §9 with pointer to `apps/factory/src/contracts` (repoint to contracts package when it lands).
4. **Keep**: abstract flow, principles, state storage, cell behavior, incidents, queue format, topology, tokens design, agent reporting.
5. Re-run link scan; fix inbound refs to removed headings.

---

## ✅ Acceptance Criteria

- [ ] No relative link in `apps/*/docs/*.md` or root `README.md` points to a missing file.
- [ ] Factory PLAN has no table/field list copied from schema or contracts.
- [ ] Design sections listed in step 4 unchanged in meaning.
- [ ] One new ADR in `decisions/`.
- [ ] Passes verification gate (`pnpm ci:verify`).
