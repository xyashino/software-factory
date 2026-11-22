---
scope: docs
summary: Add HQ, Factory, Cell workflow plan and todos
why: Edges, cleanup and resume rules were scattered across chat; one doc fixes them before code changes
date: 2026-11-22
tags: [docs, hq, factory, cell]
---

- New `docs/hq-factory-cell-plan.md`: names, edges, setup, repo gate, Cell lifecycle, cleanup, resume, scale, todo order.
- 12 self-contained todo specs in `todos/` (forest, one parent each); `bun run todo:lint` passes.
- Rechecked against code. Gaps listed in "Today vs plan" and "Open".
- Rules fixed: builder-only commit, random Cell id not stored in HQ, Cell only inside a repo, no `revoked` status.
- Design only. No code changed. Nomenclature ADR `20261113-120000` to be superseded when renames land.
