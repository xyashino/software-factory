---
scope: factory/cell-server
summary: Add cell-server package with SQLite schema and health endpoint
why: Per-PC cell daemon needs DB, procedure harness and health before any feature lands
date: 2026-11-20
tags: [cell-server, db, http, foundation]
---

- `apps/cell-server` (`@repo/cell-server`): Bun + Hono + Drizzle `bun:sqlite` + Zod, layering mirrors `factory-server`, enforced by ESLint DAG rules.
- `createDb(path)`: WAL, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, file mode `0600`, embedded migration `0000_init`.
- `immediateTx(db, fn)` = `BEGIN IMMEDIATE`: second writer gets BUSY, throw inside rolls back.
- Tables:
  - `factories`: partial unique index `WHERE is_default = 1`.
  - `cells`: PK `slot_id`, nullable `cell_id`, unique `(repo_root, name)`, partial unique `(factory_id, cell_id) WHERE cell_id IS NOT NULL`.
  - `settings`: key + JSON value.
- Domain (pure): branded `FactoryId`/`SlotId`, epoch time helpers, `desired_state` (running, stopped), `runtime_status` (starting, running, stopping, stopped, failed), factory URL and machine settings validation.
- Harness: `publicProcedure` only (no auth yet), `honoAdapter`, error handlers for 400/404/413/500, `payloadLimit` checks declared and streamed bytes.
- `GET /api/v1/health`: 200 with `pid`, `defaultFactory`, `cells.total`, `cells.byRuntimeStatus`.
- Ports `supervisor` and `factory-client` are type-only; `event-bus` has an in-memory adapter.
- Open choices: `cells` PK is `slot_id`, not `cell_id`; 400/413 black-box tests use test-only probe routes.
- Blocker: `apps/cell-server/docs/PLAN.md` and `BE_RULES.md` are missing; `apps/factory-server/docs/BE_RULES.md` used as reference.
