---
scope: factory/web-demo
summary: web-demo reply schemas derive from factory-contracts
why: web-demo kept a third hand copy of factory reply shapes, drift had no compile error
date: 2026-11-22
tags: [contracts, factory, web-demo]
---

- `apps/web-demo/src/lib/factory-schemas.ts` now imports `@repo/factory-contracts/{cells,incidents,work-orders}.contract`. No hand-written `z.object` left for factory wire data.
- Full match, reused as is: cells reply (`listCellsContract.out[200]`), work-order `steps` and `incidents` in the detail reply (`getWorkOrderContract`).
- Intentional subset, `.pick()` from package schemas: work-order summary (`workOrderDto`, used by list, detail `order`, transition `order`), job summary (`epoch` dropped), incident summary (10 of 14 fields).
- Package enums now enforced by web-demo: cell status, incident reason and status, order type, priority, state. Server replies with other values now fail as 502 `FactoryUnavailable`.
- Removed `projectsReply`: no web-demo caller.
- Kept `errorBodySchema` in `factory-client.ts`: the package has no error reply contract.
- `parseReply` adoption, UI and Astro config not touched.
- `apps/web-demo` depends on `@repo/factory-contracts: workspace:*`.
- Test fixture: incident reason `tests_failed` -> `step_retries_exhausted` (not a package reason; page output unchanged).
- Web-demo check-types, lint, format and 65 tests pass; msw tests unchanged in assertions.
