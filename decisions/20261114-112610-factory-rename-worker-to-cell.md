---
scope: factory
summary: Rename Worker to Cell across v2 packages, apps and todos
why: Worker term drifted from docs and the SQL schema; Cell is the spec name before the runtime milestones
date: 2026-11-14
---

- Retire `Worker` / `worker` in v2 code and unstarted todos; use `Cell` / `cell` per decisions 20261113-120000 and 20261113-230000
  - `WorkerId` -> `CellId`, `WorkerView` -> `CellView`, `lastWorkerId` -> `lastCellId`, `avoidWorkers` -> `avoidCells`
  - Wire literals: holder and actor kind `'cell'`, `job_lost` reason `'cell_left'`, `/cells` routes, `.cell/` paths
- `factory-db` orders table maps `lastCellId` and `avoidCells` directly; the WorkerId translation shim is removed
- `apps/worker` moved to `apps/cell` (`@repo/factory-cell`, bin `factory-cell`); root script `factory-cell`
- Files renamed: core `contracts/cell.ts` and `ports/cells.ts`, runtime `cells.ts`, db `cells-table.ts`, todos v2-11/12/13 slugs
- Pure rename, no behavior change; no migration (SQL schema already uses `cells`)
- Out of scope: `packages/software-factory` (v1), historical decisions, `.nitpick/agents/worker.md`
