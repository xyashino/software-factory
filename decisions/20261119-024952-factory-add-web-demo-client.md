---
scope: factory
summary: Add typed factory-server client with Zod-validated replies
why: Pages must not call fetch directly; one client keeps the bearer header, error mapping and reply checks in one place.
date: 2026-11-19
tags: [factory, web-demo, client, zod, msw]
---

- New `src/lib/factory-schemas.ts`: Zod replies `cellsReply`, `workOrdersReply`, `workOrderDetailReply`, `incidentsReply`, `projectsReply`, `transitionReply`; `code` literal `200` where the server sends one; unknown keys allowed.
- New `src/lib/factory-client.ts`: `createFactoryClient({ baseUrl, getToken })` with `listCells`, `listWorkOrders(filter)`, `getWorkOrder(id)`, `listIncidents(filter)`, `transitionWorkOrder(id, action)`.
- Every request sends `authorization: Bearer <getToken()>`; JSON body and `content-type` only on writes; transition body is exactly `{ "action" }`.
- Reads and writes time out after 5 s; no retry, no cache.
- New `src/lib/factory-error.ts`: `FactoryUnavailable` with `status` and optional `code` (server error `type`); message is fixed text, token never stored.
- Network error or timeout gives `status: 0`; non-2xx gives the HTTP status; reply that fails Zod gives `status: 502`.
- Adds `msw` `3.0.3` to `pnpm-workspace.yaml` catalog and `@repo/factory-web-demo` devDependencies; version published 2026-10-10, at least two weeks old at pin time.
- Tests in `test/unit/factory-client.test.ts` use msw as the backend and cover the public client only.
- No factory-server code imported; no barrel files; no `any`.
