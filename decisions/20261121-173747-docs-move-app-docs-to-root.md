---
scope: docs
summary: Move app docs into root docs by topic
why: One entry point and one glossary; apps keep pointer READMEs
date: 2026-11-21
---

- `apps/*/docs/` removed; moves via `git mv` keep history.
- `docs/README.md`: index and the only glossary (Factory, Line, Station, Operator, Mechanic, Cell, Job, Incident, Work order, Supervisor).
- `docs/architecture.md`: app table, who calls whom, one mermaid diagram.
- `docs/factory.md`, `docs/sf.md`, `docs/operator.md`, `docs/web-demo.md`: moved from app `PLAN.md` and `OPERATOR.md`.
- `docs/engineering.md`: former factory `BE_RULES.md`, style links to `.nitpick/rules/`.
- `docs/plans/`: existing `*-plan.md` files moved here.
- `apps/factory`, `apps/sf`, `apps/web-demo` each get a 2-line `README.md` pointer.
- Operator glossary removed from `docs/operator.md`; it links to the index glossary.
- Live links fixed: root `README.md`, `docs/*`, `todos/*`, `.nitpick/skills/factory-install`, `apps/sf` drift test path.
- Not changed: ADR text in `decisions/`, historic plan prose in `docs/plans/docs-plan.md`.
- Not done: caveman rewrite of moved prose; `docs/cell.md` and link-check script (separate todos).
