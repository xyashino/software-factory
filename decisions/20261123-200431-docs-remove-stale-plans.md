---
scope: docs
summary: Remove finished plans, fix stale CLI and Cell facts in docs
why: Plans for landed work described removed apps/cell, old sf server commands and cell_join. Readers followed dead facts.
date: 2026-11-23
tags: [docs, cleanup]
---

- Deleted landed plans: `docs/cell-runner-plan.md`, `docs/plans/contracts-plan.md`, `docs/plans/bun-sqlite-kit-plan.md`, `docs/plans/docs-plan.md`. `docs/plans/` gone.
- `docs/onboarding-plan.md` cut to its one open todo, `onboarding-smoke-test`.
- `docs/hq-factory-cell-plan.md`: dropped "Today vs plan" and "Order" tables, removed "Today" clauses. Added "Gaps": 4 items still open vs plan.
- `docs/sf.md`: `sf hq ...` is the main command tree, `sf server` only in the deprecated table. `sf cell list` maps to `GET /scale`. Factory no longer "planned".
- `docs/web-demo.md`: removed `cell_join` references.
- `apps/factory PLAN §n` pointers now link `factory.md` §n in `sf.md`, `operator.md`, `engineering.md`.
- `README.md`: Factory built. VPS section uses `sf service install`. Installer-path troubleshooting row removed. Cell start via `sf cell scale N`.
- `.nitpick/skills/factory-install`: setup via `sf hq`, `sf factory connect`, `sf factory start`, `sf cell scale N`. Join token is `--kind factory_join`, not `cell_join`.
- `docs/README.md` index: `plans/` line replaced with the two open plans. `apps/cell` note removed.
- No code or behaviour change. `decisions/` history untouched.
