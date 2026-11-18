---
status: todo
factory: v2
plan: web-demo
depends_on: [web-demo-02-factory-client]
priority: medium
line: feature
type: feat
---

# Todo: `web-demo-03-read-pages` — Overview, Cells Preview, Work Orders, Incidents

## 🎯 Objective

Render the read-only pages: overview counts, the cells list with a per-cell preview, work order list and detail, and open incidents. No write forms yet.

---

## 🌐 Context & Problem Statement

- Read routes are in PLAN §1 of [`apps/factory-web-demo/docs/PLAN.md`](../apps/factory-web-demo/docs/PLAN.md).
- `GET /api/v1/cells` already returns `activeJobId` and `leaseExpiresAt`. The cell preview is a filter over that list because no `GET /cells/{id}` exists.
- Pages read the session through the client from task 02. Until task 05 lands, the token comes from `FACTORY_TOKEN`.

---

## 📦 Specification / Scope

- **Target**: `apps/factory-web-demo/src/pages/`, `src/lib/view-model.ts`.
- **Classification**: `Web UI`, `Domain Core` (pure view helpers).
- **Files**:
  - `src/lib/view-model.ts`: `countByState(orders)`, `findCell(cells, cellId)`, `formatLease(epochMs | null, now)` (pure).
  - `src/pages/index.astro`: connected Cell count, Work orders by state, open Incidents, links to sections.
  - `src/pages/cells/index.astro`: table: name, status, allowed lines, active job, lease expiry. Rows link to detail.
  - `src/pages/cells/[cellId].astro`: all fields of one Cell; links to pinned and active Work orders. Unknown id shows `404`.
  - `src/pages/work-orders/index.astro`: table: slug, line, state, pinned Cell. `?state=` filter, validated against the server's state list.
  - `src/pages/work-orders/[id].astro`: state, step index, branch, steps, jobs, incidents. No forms in this task.
  - `src/pages/incidents.astro`: open incidents table.

---

## 🛠️ Implementation Plan

1. View helpers first (pure, tested).
2. Each page calls the client in its frontmatter, passes plain data to markup. No logic in markup beyond loops.
3. `FactoryUnavailable` anywhere in a page renders `503` with "factory-server unreachable". No stack, no token.
4. Unknown `cellId` or work order `id` renders `404` (server `404` passes through).
5. Tests (`test/unit/view-model.test.ts`): `countByState` counts every state present and omits none; `findCell` returns `undefined` for unknown id; `formatLease` returns `null` for null input.
6. Black-box (`test/blackbox/read-pages.test.ts`): build, start on random port with msw-mocked factory-server, GET each page, expect `200`; `/cells/unknown` expect `404`; factory-server mocked `500` expect `503`; no body contains the token value.

---

## ✅ Acceptance Criteria

- [ ] `/`, `/cells`, `/cells/<id>`, `/work-orders`, `/work-orders/<id>`, `/incidents` return `200` against a running factory-server with data.
- [ ] `/cells` lists every Cell from the server; a busy Cell shows `activeJobId` and its lease expiry.
- [ ] `/work-orders?state=bogus` returns `400`, not a server call.
- [ ] Factory-server down or `500`: pages return `503` with plain text.
- [ ] No `<form>` on read pages; no client `<script>`.
- [ ] Token value does not appear in any response body.
- [ ] No barrel `index.ts`; no `any`; arrow functions only; declaration order per file.
- [ ] `pnpm ci:verify` passes.
- [ ] One ADR entry in `decisions/` (scope `factory`).
- [ ] Evidence per [evidence](.agents/skills/evidence/SKILL.md): `curl -i` for `/cells` and `/cells/<id>`.
