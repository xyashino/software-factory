---
scope: docs
summary: Retire root docs, update README and skills to sf
why: root docs and skills described deleted apps/cli, apps/cell and packages/factory-*
date: 2026-11-20
tags: [cleanup, docs]
---

- Deleted root `docs/*.md` (legacy cell/cli/server design); per-app `apps/*/docs/` kept.
- `README.md`: package table lists active apps and packages; legacy `pnpm factory*` usage removed; design links point to `apps/factory/docs/PLAN.md` and `apps/factory-server/docs/PLAN.md`.
- `boss-factory` skill rewritten around `sf` (todos import, queue, order, incident, watch).
- `create-todo` skill: runner/model override now points at `.factory/lines/*.yml`; removed `packages/factory` models.json reference.
- `setup-factory` and `vps-gon-stack` already replaced by `factory-install`.
