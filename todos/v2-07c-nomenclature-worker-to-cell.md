---
status: todo
priority: high
depends_on: [v2-07b-storage-drizzle]
workflow: feature
---

# v2-07c: Nomenclature — retire `Worker` in favor of `Cell` across v2 code and todos

## 🎯 Objective

Replace the retired `Worker` / `worker` domain term with `Cell` / `cell` across all v2 packages,
apps, definitions, and unstarted `todos/`, aligning the codebase with `docs/` and
`decisions/20261113-230000-factory-mechanic-andon-triage.md`.

---

## 🌐 Context & Problem Statement

`decisions/20261113-120000-factory-nomenclature.md` and
`decisions/20261113-230000-factory-mechanic-andon-triage.md` retired the word `Worker` in favor of
**Cell** (`factory-cell`, `apps/cell`, `CellId`). While `docs/` and the SQL schema
(`packages/factory-db/migrations/0001_init.sql`: `cells`, `last_cell_id`, `avoid_cells`) already
use `Cell`, the v2 TypeScript code implemented earlier (`v2-01` through `v2-07`) still uses
`WorkerId`, `WorkerView`, `lastWorkerId`, `avoidWorkers`, `holder: 'worker'`, `worker_left`, and
`apps/worker` (`@repo/factory-worker`). That drift already forces field-renaming workarounds in
`packages/factory-db/src/orders-table.ts` and contradicts the specification before `v2-08` and the
Cell runtime milestones (`v2-11`–`v2-13`) begin.

## Read first

- `decisions/20261113-120000-factory-nomenclature.md`
- `decisions/20261113-230000-factory-mechanic-andon-triage.md` (§"Naming")
- `decisions/20261113-233255-factory-add-sqlite-event-store.md` (column drift note)
- `docs/STRUCTURE.md` §1–3 (`apps/cell`, `factory-cell`)
- `docs/CORE.md`, `docs/PROTOCOL.md`, `docs/STORAGE.md`

---

## 📦 Specification / Scope

- **Target**:
  - `packages/factory-core`
  - `packages/factory-db`
  - `packages/factory-definitions`
  - `apps/worker` → `apps/cell` (`@repo/factory-cell`)
  - `package.json` (root scripts)
  - `apps/server/eslint.config.mjs` (comments)
  - `todos/` (remaining unstarted `v2-*` todo specs)
- **Classification**: `Domain Core` / `Infrastructure`
- **Dependencies**:
  - `@repo/factory-core: workspace:*`
- **Out of scope**:
  - `packages/software-factory` (v1 legacy package; RULES §4.4)
  - Historical `decisions/*.md` entries (older decision records keep their original wording)
  - Repo-level nitpick agent files (`.nitpick/agents/worker.md` is not a factory v2 domain term)
  - Running or already-active todo files (`v2-09-factory-http-command-loop.md` if already active; do not edit in-flight tasks)

---

## 🛠️ Implementation Plan

1. **Rename `Worker` → `Cell` in `packages/factory-core`**:
   - `src/ids.ts`: `workerIdSchema` → `cellIdSchema`, `WorkerId` → `CellId`.
   - `src/ports/lease-store.ts`: `workerId: WorkerId` → `cellId: CellId` (and JSDoc `Worker` → `Cell`).
   - `src/order/events.ts`: actor `{ kind: 'cell', cellId }`, `job_claimed.cellId`, `job_lost.reason` `'worker_left'` → `'cell_left'`.
   - `src/order/status.ts`, `state.ts`, `commands.ts`, `context.ts`, `evolve*.ts`, `decide*.ts`: `holder.kind = 'cell'`, `cellId`, `workspaceFailures` entries `{ cellId, jobId, at }`.
   - `src/order/projection.ts`: `lastWorkerId` → `lastCellId`, `avoidWorkers` → `avoidCells` (`{ cellId: CellId; until: number }[]`).
   - `src/queue/types.ts` & `src/queue/select.ts`: `WorkerView` → `CellView`, `workerId` → `cellId`, `lastWorkerId` → `lastCellId`, `avoidWorkers` → `avoidCells`.
   - Update `src/testing/*` (`event-builders.ts`, `harness.ts`, `runner.ts`, `steps.ts`, `scenario-fixtures.ts`) and all `factory-core` tests.

2. **Remove Translation Drift in `packages/factory-db`**:
   - `src/orders-table.ts` (and Drizzle schema/tests): map `projection.lastCellId` ↔ `orders.lastCellId` (`last_cell_id`) and `projection.avoidCells` ↔ `orders.avoidCells` (`avoid_cells`) directly using `CellId`, removing the `WorkerId` translation shim.

3. **Rename `apps/worker` → `apps/cell`**:
   - Rename directory `apps/worker` → `apps/cell`.
   - Update `apps/cell/package.json` (`name: "@repo/factory-cell"`, `bin: { "factory-cell": "./src/main.ts" }`).
   - Update `apps/cell/eslint.config.mjs` (error messages & comments `apps/cell`), `apps/cell/src/usage.ts`, and `apps/cell/src/__tests__/{boundaries,smoke}.test.ts`.
   - Update root `package.json` script `"factory-worker"` → `"factory-cell": "bun apps/cell/src/main.ts"`.
   - Update `apps/server/eslint.config.mjs` comments referencing `Worker-side`.

4. **Update `packages/factory-definitions` & Remaining Unstarted `todos/`**:
   - `packages/factory-definitions/templates/runtime/handover-request.md`: `Worker` → `Cell`, `.worker/handover.md` → `.cell/handover.md`.
   - `packages/factory-definitions/src/line-schema.ts`: comments `Worker` → `Cell`.
   - Update remaining unstarted `todos/` (`v2-10`, `v2-11`–`v2-16`, `v2-18`) to use `Cell`, `apps/cell`, `factory-cell`, `.cell/`, and `cells` CLI subcommands (and rename `v2-11-worker-*`, `v2-12-worker-*`, `v2-13-worker-*` or update their `depends_on` references consistently if renamed).

---

## ✅ Acceptance Criteria

- [ ] No `WorkerId`, `WorkerView`, `lastWorkerId`, `avoidWorkers`, `'worker_left'`, `holder: 'worker'`, `@repo/factory-worker`, or `apps/worker` remains in v2 packages/apps (`packages/factory-*`, `apps/*`).
- [ ] `apps/cell` (`@repo/factory-cell`, `factory-cell`) builds, passes lint boundary rules, and passes its tests.
- [ ] `packages/factory-core`, `packages/factory-db`, and `packages/factory-definitions` tests and fixtures pass with `Cell` terminology.
- [ ] Strict TypeScript typing without `any` or loose assertions.
- [ ] Passes verification gate (`pnpm ci:verify`).
