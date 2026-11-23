---
scope: docs
summary: Sync docs with code after HQ renames, drop done todos
why: Docs after the HQ renames still had wrong routes, Cell-pinned orders, old layouts and missing gaps; done todos stayed in the repo
date: 2026-11-23
tags: [docs, todos, hq, factory]
---

- `cell.md`: real Factory daemon routes (`/status`, `/scale`, `/cells/:id/activity`), 409 reasons, scale-down order, duplicate `cell list` line removed.
- `hq.md`: `pinned_factory_id` per Factory, no `cells` table, builder-only commit, resume at `headCommitSha`, waiter cap, `web_join` and `web_session` tokens, contracts in `packages/hq-contracts`.
- `engineering.md`, `sf.md`: layout trees match code; invariants use `pinned_factory_id` and `unavailable_line_factories_json`.
- `architecture.md`, `README.md`: Cells reach HQ only through the Factory relay; package tables list `hq-contracts`.
- `hq-factory-cell-plan.md`: Done section; Gaps table adds `sf service --cell` unit, cancelled worktrees, unused blocked PR template, scale-down sort.
- `README.md`, `factory-install` skill: Cells via `sf factory connect --token -`, `sf factory start`, `sf cell scale N`.
- `web-demo.md`: web join is built, single-use, `web_session` kind.
- Deleted 13 done todos.
