---
scope: docs
summary: Split docs into architecture, features, apps, and plans folders
why: Flat docs directory mixed 57KB specs with plans and lacked a cross-app feature map and explicit app business boundaries
date: 2026-11-26
tags: [docs, architecture, boundaries, features]
---

- Reorganized `docs/` into four subdirectories: `architecture/`, `features/`, `apps/`, and `plans/`.
  - `docs/architecture/boundaries.md` defines the Owns / Never Owns / Talks To / Auth matrix across `apps/hq`, `apps/sf` (Factory, Cell, Operator, Supervisor CLI), `apps/web`, and `apps/web-demo`.
  - `docs/features/README.md` adds a cross-app capability matrix and end-to-end Mermaid flow linking `work-orders.md`, `cells-and-factory.md`, and `incidents.md`.
  - `docs/apps/` separates `hq.md`, `sf.md`, `operator.md`, and `web.md` (documenting both `apps/web` 5-layer RxJS EDA SPA and `apps/web-demo`).
- Updated doc references in root `README.md`, `apps/*/README.md`, and `apps/sf/test/unit/contracts/drift.test.ts`.
