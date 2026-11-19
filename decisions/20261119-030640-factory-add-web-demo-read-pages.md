---
scope: factory
summary: Add read-only overview, cells, work order and incident pages
why: Supervisor needs to see factory state in the web demo before write actions land; pages stay thin, logic lives in pure helpers.
date: 2026-11-19
tags: [factory, web-demo, astro, ssr, msw, read-pages]
---

- New `src/lib/view-model.ts` (pure): `WORK_ORDER_STATE_LIST`, `isWorkOrderState`, `countByState`, `findCell`, `formatLease`, `formatTimestamp`.
- New `src/lib/session.ts`: `createSessionClient(env)` builds the factory client and project id from `loadConfig`; token from `FACTORY_TOKEN` until session auth lands.
- New `src/lib/page-error.ts`: `failureResponse` maps `FactoryUnavailable` to plain `503` (`factory-server unreachable`), server `404` to `404`; non-factory errors rethrow. `textResponse` for plain-text status bodies.
- Pages:
  - `/`: connected cell count, work orders by state, open incidents.
  - `/cells`: table, rows link to detail.
  - `/cells/[cellId]`: all fields, pinned and active work orders; unknown id gives `404`.
  - `/work-orders`: `?state=` validated before any server call, invalid gives `400`.
  - `/work-orders/[id]`: state, step index, branch, steps, jobs, incidents.
  - `/incidents`: open incidents.
- Read pages have no `<form>` and no client `<script>`; token never rendered.
- Tests: `test/unit/view-model.test.ts`; `test/blackbox/read-pages.test.ts` builds the app, runs the built server in-process with msw as factory-server, checks `200`/`404`/`400`/`503`, no-form/no-script, and token absence.
- `turbo.json`: `test` task also depends on the package's own `build`, so the black-box build does not race the `build` task.
